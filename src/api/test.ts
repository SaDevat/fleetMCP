import type { ProxyRuntime } from "./types.ts";
import { apiError } from "./error.ts";
import { getConfig } from "../core/config.ts";
import {
  checkConnection,
  checkToolsList,
  checkSchemaIntegrity,
  checkErrorResilience,
  checkUnknownTool,
} from "../cli/test.ts";
import type { CheckResult, TestResult } from "../types/results.ts";

/**
 * Routes for the test screen. Owned by its screen's branch -- no other module
 * should need editing to add endpoints here.
 *
 * Reuses the five checks from cli/test.ts verbatim -- the API and the CLI
 * must never disagree on what "passing" means.
 */

const CHECKS = [
  { name: "Connection handshake", description: "Opens a fresh MCP connection to the server." },
  { name: "Tools list", description: "Lists the tools the server advertises." },
  { name: "Schema integrity", description: 'Every tool\'s inputSchema declares type: "object".' },
  { name: "Error resilience", description: "Calls every tool with empty arguments; none may crash the transport." },
  {
    name: "Unknown tool rejection",
    description: "Calling a nonexistent tool name is rejected, not silently accepted.",
  },
] as const;

/** Runs the five checks against a live connection, mirroring `fleetmcp test <alias>`. */
async function runChecks(alias: string): Promise<TestResult> {
  const totalStart = performance.now();
  const checks: CheckResult[] = [];

  const conn = await checkConnection(alias).catch((error: unknown) => {
    const enriched = error as { checkResult?: CheckResult };
    checks.push(
      enriched.checkResult ?? {
        name: "Connection handshake",
        passed: false,
        durationMs: Math.round(performance.now() - totalStart),
        error: error instanceof Error ? error.message : "Connection failed",
      },
    );
    return undefined;
  });

  if (!conn) {
    return { alias, passed: false, checks, totalDurationMs: Math.round(performance.now() - totalStart) };
  }

  const { client } = conn;
  checks.push(conn.result);

  try {
    const toolsResult = await checkToolsList(client);
    checks.push(toolsResult.result);

    const tools = toolsResult.tools;
    checks.push(
      tools.length > 0 ? checkSchemaIntegrity(tools) : { name: "Schema integrity", passed: true, durationMs: 0 },
    );
    checks.push(
      tools.length > 0
        ? await checkErrorResilience(client, tools)
        : { name: "Error resilience", passed: true, durationMs: 0 },
    );
    checks.push(await checkUnknownTool(client));
  } finally {
    await Promise.race([client.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  }

  return {
    alias,
    passed: checks.every((c) => c.passed),
    checks,
    totalDurationMs: Math.round(performance.now() - totalStart),
  };
}

export function testRoutes(_rt: ProxyRuntime): Record<string, unknown> {
  return {
    "/api/test/checks": {
      GET() {
        return Response.json(CHECKS.map(({ name, description }) => ({ name, description })));
      },
    },

    "/api/test/:alias": {
      async POST(req: Request & { params: { alias: string } }) {
        const { alias } = req.params;
        const config = await getConfig();
        if (config.servers[alias] === undefined) {
          return apiError(404, "not_found", `no server "${alias}"`);
        }

        try {
          return Response.json(await runChecks(alias));
        } catch (error) {
          // A check throwing outside its own handling must still surface as a
          // legible failure, never a 500 -- reporting failures legibly is the
          // entire point of this screen.
          const result: TestResult = {
            alias,
            passed: false,
            checks: [
              {
                name: "Unexpected error",
                passed: false,
                durationMs: 0,
                error: error instanceof Error ? error.message : String(error),
              },
            ],
            totalDurationMs: 0,
          };
          return Response.json(result);
        }
      },
    },
  };
}
