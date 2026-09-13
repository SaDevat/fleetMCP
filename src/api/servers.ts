import type { ProxyRuntime } from "./types.ts";
import { apiError } from "./error.ts";
import { getConfig, saveConfig, pinStdioPaths } from "../core/config.ts";
import { ServerConfigSchema, type ServerConfig } from "../types/config.ts";
import { mapExternalEntry, toClaudeFormat, toCursorFormat } from "../cli/config.ts";

/**
 * Routes for the servers screen. Owned by its screen's branch -- mirrors
 * traffic.ts: a factory over the running proxy, no module-level state.
 */

export interface ServerEntry {
  alias: string;
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  health: "ok" | "missing" | "http";
  connected: boolean;
  /** Present only when non-empty -- the edit dialog needs these so a save doesn't
   * silently drop secrets the GET response would otherwise omit. */
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

/** Pins a stdio config's paths in place; passes http configs through untouched. */
function pinIfStdio(cfg: ServerConfig): ServerConfig {
  if (cfg.type !== "stdio") return cfg;
  const pinned = pinStdioPaths(cfg.command, cfg.args);
  return { ...cfg, ...pinned };
}

function health(cfg: ServerConfig): "ok" | "missing" | "http" {
  if (cfg.type === "http") return "http";
  return Bun.which(cfg.command) ? "ok" : "missing";
}

function toEntry(alias: string, cfg: ServerConfig, rt: ProxyRuntime): ServerEntry {
  const sub = rt.clientMap.get(alias);
  const connected = sub !== undefined && !sub.dead;
  return {
    alias,
    type: cfg.type,
    health: health(cfg),
    connected,
    ...(cfg.type === "stdio"
      ? { command: cfg.command, args: cfg.args, ...(Object.keys(cfg.env).length ? { env: cfg.env } : {}) }
      : { url: cfg.url, ...(Object.keys(cfg.headers).length ? { headers: cfg.headers } : {}) }),
  };
}

/** Splits {alias, ...ServerConfig} into its parts; returns an error message on failure. */
function parseAddBody(raw: unknown): { alias: string; config: ServerConfig } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "body must be an object" };
  const { alias, ...rest } = raw as Record<string, unknown>;
  if (typeof alias !== "string" || alias.length === 0) return { error: "alias is required" };
  const parsed = ServerConfigSchema.safeParse(rest);
  if (!parsed.success) return { error: parsed.error.message };
  return { alias, config: parsed.data };
}

export function serversRoutes(rt: ProxyRuntime): Record<string, unknown> {
  return {
    "/api/servers": {
      async GET() {
        const config = await getConfig();
        const servers = Object.entries(config.servers).map(([alias, cfg]) => toEntry(alias, cfg, rt));
        return Response.json({ servers });
      },

      async POST(req: Request) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          return apiError(400, "bad_request", "invalid JSON body");
        }

        const parsed = parseAddBody(raw);
        if ("error" in parsed) return apiError(400, "bad_request", parsed.error);

        const config = await getConfig();
        if (config.servers[parsed.alias]) {
          return apiError(409, "bad_request", `alias "${parsed.alias}" already exists`);
        }

        const pinned = pinIfStdio(parsed.config);
        config.servers[parsed.alias] = pinned;
        await saveConfig(config);

        return Response.json(toEntry(parsed.alias, pinned, rt), { status: 201 });
      },
    },

    "/api/servers/export": {
      async GET(req: Request) {
        const url = new URL(req.url);
        const target = url.searchParams.get("target");
        if (target !== "claude" && target !== "cursor") {
          return apiError(400, "bad_request", `target must be "claude" or "cursor"`);
        }
        const config = await getConfig();
        const output = target === "cursor" ? toCursorFormat(config.servers) : toClaudeFormat(config.servers);
        return Response.json(output);
      },
    },

    "/api/servers/import": {
      async POST(req: Request) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          return apiError(400, "bad_request", "invalid JSON body");
        }

        if (typeof raw !== "object" || raw === null) {
          return apiError(400, "bad_request", "body must be an object");
        }
        const mcpServers = (raw as Record<string, unknown>)["mcpServers"];
        if (typeof mcpServers !== "object" || mcpServers === null) {
          return apiError(400, "bad_request", `expected an "mcpServers" object`);
        }

        const config = await getConfig();
        const added: string[] = [];
        const skipped: string[] = [];

        for (const [alias, entry] of Object.entries(mcpServers as Record<string, unknown>)) {
          if (config.servers[alias]) {
            skipped.push(alias);
            continue;
          }
          const mapped = mapExternalEntry(entry);
          if (!mapped) {
            skipped.push(alias);
            continue;
          }
          config.servers[alias] = pinIfStdio(mapped);
          added.push(alias);
        }

        if (added.length > 0) await saveConfig(config);
        return Response.json({ added, skipped });
      },
    },

    "/api/servers/:alias": {
      async PATCH(req: Request & { params: { alias: string } }) {
        const { alias } = req.params;
        const config = await getConfig();
        if (!config.servers[alias]) return apiError(404, "not_found", `no server "${alias}"`);

        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          return apiError(400, "bad_request", "invalid JSON body");
        }

        const parsed = ServerConfigSchema.safeParse(raw);
        if (!parsed.success) return apiError(400, "bad_request", parsed.error.message);

        const pinned = pinIfStdio(parsed.data);
        config.servers[alias] = pinned;
        await saveConfig(config);

        return Response.json(toEntry(alias, pinned, rt));
      },

      async DELETE(req: Request & { params: { alias: string } }) {
        const { alias } = req.params;
        const config = await getConfig();
        if (!config.servers[alias]) return apiError(404, "not_found", `no server "${alias}"`);

        delete config.servers[alias];
        await saveConfig(config);

        return Response.json({ ok: true });
      },
    },
  };
}
