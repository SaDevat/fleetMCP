import { Command } from "commander";
import chalk from "chalk";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { homedir } from "node:os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getConfig } from "../core/config.ts";
import { createMcpClient } from "../core/client.ts";
import { brandSpinner } from "../utils/brand.ts";
import { ensureMcpxDir } from "../core/config.ts";
import { die } from "../utils/error.ts";
import packageJson from "../../package.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubClient {
  alias: string;
  client: Awaited<ReturnType<typeof createMcpClient>>;
}

interface NamespacedTool {
  namespacedName: string;
  alias: string;
  originalName: string;
  tool: Tool;
}

// ---------------------------------------------------------------------------
// SQLite logging
// ---------------------------------------------------------------------------

function estimateTokens(payload: unknown): number {
  const json = typeof payload === "string" ? payload : JSON.stringify(payload);
  return Math.ceil(json.length / 4);
}

function openLogDb(): Database {
  const dbPath = join(homedir(), ".mcpx", "logs.db");
  const db = new Database(dbPath);

  // Create table with token columns (migration-safe: IF NOT EXISTS)
  db.run(`
    CREATE TABLE IF NOT EXISTS proxy_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      alias TEXT NOT NULL,
      toolName TEXT NOT NULL,
      request TEXT NOT NULL,
      response TEXT NOT NULL,
      durationMs INTEGER NOT NULL,
      isError INTEGER NOT NULL,
      requestTokens INTEGER NOT NULL DEFAULT 0,
      responseTokens INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Add token columns to existing tables (graceful migration)
  try {
    db.run(`ALTER TABLE proxy_logs ADD COLUMN requestTokens INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE proxy_logs ADD COLUMN responseTokens INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists
  }

  return db;
}

function logEntry(
  db: Database,
  alias: string,
  toolName: string,
  request: unknown,
  response: unknown,
  durationMs: number,
  isError: boolean,
  requestTokens: number,
  responseTokens: number,
): void {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  db.run(
    `INSERT INTO proxy_logs (id, timestamp, alias, toolName, request, response, durationMs, isError, requestTokens, responseTokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      timestamp,
      alias,
      toolName,
      JSON.stringify(request),
      JSON.stringify(response),
      durationMs,
      isError ? 1 : 0,
      requestTokens,
      responseTokens,
    ],
  );
}

// ---------------------------------------------------------------------------
// Proxy Command
// ---------------------------------------------------------------------------

export const proxyCommand = new Command("proxy")
  .description("Start a namespaced SSE aggregator wrapping N sub-servers")
  .option("-p, --port <number>", "Port to listen on", "4390")
  .action(async (options: { port: string }) => {
    const subClients: SubClient[] = [];
    let db: Database | undefined;
    let httpServer: ReturnType<typeof Bun.serve> | undefined;

    async function cleanup(): Promise<void> {
      if (httpServer) {
        httpServer.stop(true);
        httpServer = undefined;
      }
      for (const sub of subClients) {
        await sub.client.close().catch(() => {});
      }
      subClients.length = 0;
      db?.close();
      db = undefined;
    }

    const onShutdown = async () => {
      console.log(chalk.dim("\nShutting down proxy..."));
      await cleanup();
      process.exit(0);
    };
    process.on("SIGINT", onShutdown);
    process.on("SIGTERM", onShutdown);

    try {
      const port = parseInt(options.port, 10) || 4390;
      const config = await getConfig();
      const entries = Object.entries(config.servers);

      if (entries.length === 0) {
        console.log(
          chalk.yellow(
            "No servers configured. Run `mcpx config add` to register servers first.",
          ),
        );
        return;
      }

      // 1. Connect to all sub-servers
      const spinner = brandSpinner("Connecting to sub-servers...").start();
      const allNamespacedTools: NamespacedTool[] = [];

      for (const [alias] of entries) {
        try {
          spinner.text = `Connecting to ${chalk.cyan(alias)}...`;
          const client = await createMcpClient({ alias });
          subClients.push({ alias, client });

          const { tools } = await client.listTools();
          for (const tool of tools) {
            allNamespacedTools.push({
              namespacedName: `${alias}_${tool.name}`,
              alias,
              originalName: tool.name,
              tool,
            });
          }
        } catch (error) {
          spinner.warn(
            `Skipping ${chalk.cyan(alias)}: ${error instanceof Error ? error.message : "unknown error"}`,
          );
          spinner.start();
        }
      }

      if (subClients.length === 0) {
        spinner.fail("Could not connect to any server.");
        await cleanup();
        die(new Error("All server connections failed"), 2);
      }

      spinner.succeed(
        `Connected to ${subClients.length} server(s), ${allNamespacedTools.length} tool(s) available`,
      );

      // 2. Setup SQLite logging
      await ensureMcpxDir();
      db = openLogDb();

      // 3. Build tool routing map (shared across all request-scoped servers)
      const toolMap = new Map<string, NamespacedTool>();
      for (const nt of allNamespacedTools) {
        toolMap.set(nt.namespacedName, nt);
      }

      const clientMap = new Map<string, SubClient>();
      for (const sub of subClients) {
        clientMap.set(sub.alias, sub);
      }

      // MCP requires an init handshake before tool calls, so the proxy
      // must use stateful sessions. Each session gets its own server+transport
      // pair that persists across requests; the sub-client pool is shared.

      interface ProxySession {
        server: Server;
        transport: WebStandardStreamableHTTPServerTransport;
      }

      const sessions = new Map<string, ProxySession>();

      function createSession(): ProxySession {
        const server = new Server(
          { name: "mcpx-proxy", version: packageJson.version },
          { capabilities: { tools: {} } },
        );

        server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: allNamespacedTools.map((nt) => ({
            ...nt.tool,
            name: nt.namespacedName,
            description: `[${nt.alias}] ${nt.tool.description ?? ""}`.trim(),
          })),
        }));

        server.setRequestHandler(CallToolRequestSchema, async (request) => {
          const nsName = request.params.name;
          const nsArgs = (request.params.arguments ?? {}) as Record<string, unknown>;
          const entry = toolMap.get(nsName);

          if (!entry) {
            return {
              content: [{ type: "text" as const, text: `Unknown tool: ${nsName}` }],
              isError: true,
            };
          }

          const sub = clientMap.get(entry.alias);
          if (!sub) {
            return {
              content: [
                { type: "text" as const, text: `Server ${entry.alias} disconnected` },
              ],
              isError: true,
            };
          }

          const requestTokens = estimateTokens(nsArgs);
          const start = performance.now();

          try {
            const result = await sub.client.callTool({
              name: entry.originalName,
              arguments: nsArgs,
            });
            const durationMs = Math.round(performance.now() - start);
            const resultObj = result as Record<string, unknown>;
            const responseTokens = estimateTokens(result);

            if (db) {
              logEntry(
                db,
                entry.alias,
                entry.originalName,
                nsArgs,
                result,
                durationMs,
                resultObj["isError"] === true,
                requestTokens,
                responseTokens,
              );
            }

            return result;
          } catch (error) {
            const durationMs = Math.round(performance.now() - start);
            const errMsg = error instanceof Error ? error.message : "Unknown error";
            const errorResponse = { error: errMsg };
            const responseTokens = estimateTokens(errorResponse);

            if (db) {
              logEntry(
                db,
                entry.alias,
                entry.originalName,
                nsArgs,
                errorResponse,
                durationMs,
                true,
                requestTokens,
                responseTokens,
              );
            }

            return {
              content: [{ type: "text" as const, text: errMsg }],
              isError: true,
            };
          }
        });

        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sessionId) => {
            sessions.set(sessionId, { server, transport });
          },
        });

        return { server, transport };
      }

      // 4. Start Bun HTTP server with session-aware routing
      httpServer = Bun.serve({
        port,
        async fetch(req) {
          const url = new URL(req.url);

          if (url.pathname === "/mcp") {
            const sessionId = req.headers.get("mcp-session-id");

            if (sessionId) {
              const existing = sessions.get(sessionId);
              if (existing) {
                return existing.transport.handleRequest(req);
              }

              if (req.method === "DELETE") {
                return new Response(null, { status: 204 });
              }

              return new Response(
                JSON.stringify({
                  jsonrpc: "2.0",
                  error: { code: -32000, message: "Session not found" },
                  id: null,
                }),
                { status: 404, headers: { "content-type": "application/json" } },
              );
            }

            if (req.method === "POST") {
              const session = createSession();
              await session.server.connect(session.transport);
              return session.transport.handleRequest(req);
            }

            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32000, message: "Missing mcp-session-id header" },
                id: null,
              }),
              { status: 400, headers: { "content-type": "application/json" } },
            );
          }

          if (url.pathname === "/" && req.method === "GET") {
            // Aggregate token stats from SQLite
            let totalRequests = 0;
            let totalRequestTokens = 0;
            let totalResponseTokens = 0;

            if (db) {
              try {
                const stats = db
                  .query(
                    `SELECT COUNT(*) as count, 
                            COALESCE(SUM(requestTokens), 0) as reqTokens, 
                            COALESCE(SUM(responseTokens), 0) as resTokens 
                     FROM proxy_logs`,
                  )
                  .get() as
                  | { count: number; reqTokens: number; resTokens: number }
                  | undefined;

                if (stats) {
                  totalRequests = stats.count;
                  totalRequestTokens = stats.reqTokens;
                  totalResponseTokens = stats.resTokens;
                }
              } catch {
                // Graceful fallback if query fails
              }
            }

            return new Response(
              JSON.stringify({
                name: "mcpx-proxy",
                version: packageJson.version,
                tools: allNamespacedTools.length,
                servers: subClients.length,
                sessions: sessions.size,
                endpoint: "/mcp",
                totalRequests,
                estimatedTokens: {
                  request: totalRequestTokens,
                  response: totalResponseTokens,
                },
              }),
              { headers: { "content-type": "application/json" } },
            );
          }

          return new Response("Not Found", { status: 404 });
        },
      });

      console.log(
        chalk.green(`\nProxy listening on `) +
          chalk.cyan.bold(`http://localhost:${port}/mcp`),
      );
      console.log(chalk.dim("Press Ctrl+C to stop.\n"));

      // Print tool inventory
      for (const nt of allNamespacedTools) {
        console.log(
          `  ${chalk.white(nt.namespacedName)} ${chalk.dim(`→ ${nt.alias}/${nt.originalName}`)}`,
        );
      }
      console.log();
    } catch (error) {
      await cleanup();
      die(error, 2);
    } finally {
      process.removeListener("SIGINT", onShutdown);
      process.removeListener("SIGTERM", onShutdown);
    }
  });
