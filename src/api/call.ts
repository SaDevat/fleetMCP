import type { Database } from "bun:sqlite";
import type { ProxyRuntime, SubClient } from "./types.ts";
import { apiError } from "./error.ts";
import { estimateTokens, logEntry } from "../core/log.ts";
import { listAllTools } from "../cli/inspect.ts";

/**
 * Routes for the Call console. Owned by its screen's branch -- mirrors
 * traffic.ts/servers.ts: a factory over the running proxy, no module-level
 * state.
 *
 * Calls route through the same warm `clientMap` pool the /mcp endpoint uses
 * (never a fresh client), so a call made here is a real fleet call -- it gets
 * logged to proxy_logs exactly like MCP traffic, and shows up in Traffic with
 * no extra wiring. logEntry() itself lives in cli/proxy.ts and isn't exported
 * (that file is off-limits to this branch), so the insert + logBus emit are
 * reproduced here against the same schema.
 */

export interface CallToolEntry {
  name: string;
  description?: string;
  inputSchema: unknown;
  namespaced: string;
}

type ResolveResult = { sub: SubClient } | { failure: "not_found" } | { failure: "down" };

/** Looks up the alias's warm sub-client, reconnecting a dead one in place. */
async function resolveSub(rt: ProxyRuntime, alias: string): Promise<ResolveResult> {
  const sub = rt.clientMap.get(alias);
  if (!sub) return { failure: "not_found" };
  if (sub.dead && !(await rt.ensureLive(sub))) return { failure: "down" };
  return { sub };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Minimal JSON-Schema check: required-field presence and a top-level type
 * match for whatever was actually provided. ponytail: no nested properties,
 * no enum/oneOf/anyOf/$ref/format validation -- the sub-server still
 * validates on the wire, this only catches the obvious 400s before paying
 * for a round trip. Upgrade to a real validator if a tool needs it.
 */
function validateArgs(inputSchema: unknown, args: Record<string, unknown>): string | undefined {
  if (!isRecord(inputSchema)) return undefined;

  const required = Array.isArray(inputSchema["required"]) ? (inputSchema["required"] as unknown[]) : [];
  for (const key of required) {
    if (typeof key === "string" && !(key in args)) return `missing required argument "${key}"`;
  }

  const properties = inputSchema["properties"];
  if (!isRecord(properties)) return undefined;

  for (const [key, value] of Object.entries(args)) {
    const propSchema = properties[key];
    if (!isRecord(propSchema)) continue;
    const expected = propSchema["type"];
    if (typeof expected !== "string") continue;

    const matches =
      expected === "integer"
        ? typeof value === "number" && Number.isInteger(value)
        : expected === "array"
          ? Array.isArray(value)
          : expected === "null"
            ? value === null
            : Array.isArray(value)
              ? false
              : typeof value === expected;

    if (!matches) return `argument "${key}" must be of type ${expected}`;
  }

  return undefined;
}

export function callRoutes(rt: ProxyRuntime): Record<string, unknown> {
  return {
    "/api/servers/:alias/tools": {
      async GET(req: Request & { params: { alias: string } }) {
        const { alias } = req.params;
        const resolved = await resolveSub(rt, alias);
        if ("failure" in resolved) {
          return resolved.failure === "not_found"
            ? apiError(404, "not_found", `no server "${alias}"`)
            : apiError(502, "upstream_unavailable", `server "${alias}" is unreachable`);
        }

        const tools = await listAllTools(resolved.sub.client);
        const entries: CallToolEntry[] = tools.map((tool) => ({
          name: tool.name,
          ...(tool.description !== undefined ? { description: tool.description } : {}),
          inputSchema: tool.inputSchema,
          namespaced: `${alias}_${tool.name}`,
        }));

        return Response.json({ tools: entries });
      },
    },

    "/api/call": {
      async POST(req: Request) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          return apiError(400, "bad_request", "invalid JSON body");
        }
        if (!isRecord(raw)) return apiError(400, "bad_request", "body must be an object");

        const { alias, tool } = raw;
        if (typeof alias !== "string" || alias.length === 0) {
          return apiError(400, "bad_request", "alias is required");
        }
        if (typeof tool !== "string" || tool.length === 0) {
          return apiError(400, "bad_request", "tool is required");
        }
        const toolArgs = isRecord(raw["arguments"]) ? raw["arguments"] : {};

        const resolved = await resolveSub(rt, alias);
        if ("failure" in resolved) {
          return resolved.failure === "not_found"
            ? apiError(404, "not_found", `no server "${alias}"`)
            : apiError(502, "upstream_unavailable", `server "${alias}" is unreachable`);
        }
        const sub = resolved.sub;

        const tools = await listAllTools(sub.client);
        const toolDef = tools.find((t) => t.name === tool);
        if (!toolDef) return apiError(404, "not_found", `no tool "${tool}" on "${alias}"`);

        const validationError = validateArgs(toolDef.inputSchema, toolArgs);
        if (validationError) return apiError(400, "bad_request", validationError);

        const start = performance.now();
        try {
          const result = await sub.client.callTool({ name: tool, arguments: toolArgs });
          const durationMs = Math.round(performance.now() - start);
          const isError = (result as Record<string, unknown>)["isError"] === true;

          if (rt.db)
            logEntry(rt.db, alias, tool, toolArgs, result, durationMs, isError,
              estimateTokens(toolArgs), estimateTokens(result));

          return Response.json(result);
        } catch (error) {
          const durationMs = Math.round(performance.now() - start);
          const errMsg = error instanceof Error ? error.message : "unknown error";
          const errorResponse = { error: errMsg };

          if (rt.db)
            logEntry(rt.db, alias, tool, toolArgs, errorResponse, durationMs, true,
              estimateTokens(toolArgs), estimateTokens(errorResponse));

          return Response.json(errorResponse);
        }
      },
    },
  };
}
