import { Command } from "commander";
import chalk from "chalk";
import { Database } from "bun:sqlite";
import uiIndex from "../ui/index.html";
import { join } from "node:path";
import { homedir } from "node:os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getConfig } from "../core/config.ts";
import { apiError } from "../api/error.ts";
import { apiRoutes } from "../api/index.ts";
import type { ProxyRuntime, SubClient } from "../api/types.ts";
import { estimateTokens, logEntry, openLogDb } from "../core/log.ts";
export { openLogDb } from "../core/log.ts";
import { createMcpClient } from "../core/client.ts";
import { brandSpinner } from "../utils/brand.ts";
import { ensureFleetmcpDir } from "../core/config.ts";
import { die } from "../utils/error.ts";
import packageJson from "../../package.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NamespacedTool {
  namespacedName: string;
  alias: string;
  originalName: string;
  tool: Tool;
}

// ---------------------------------------------------------------------------
// SQLite logging
// ---------------------------------------------------------------------------

// FLEETMCP_HOME overrides the log location the same way it overrides config.yml
// (see core/config.ts) -- without mirroring that here, every proxy run under a
// test's temp home silently fell back to the developer's real ~/.fleetmcp/logs.db.
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
    // Set once the session map and its sweep exist; called by cleanup().
    let closeSessions: (() => void) | undefined;

    async function cleanup(): Promise<void> {
      if (httpServer) {
        httpServer.stop(true);
        httpServer = undefined;
      }
      closeSessions?.();
      closeSessions = undefined;
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
      // `|| 4390` would swallow a deliberate 0: parseInt("0") is falsy, so the
      // fallback fired and port 0 silently became 4390. Tests pass 0 to have
      // the OS assign a free port, which is what lets suites run concurrently.
      const parsedPort = Number.parseInt(options.port, 10);
      const port = Number.isNaN(parsedPort) ? 4390 : parsedPort;
      const config = await getConfig();
      const entries = Object.entries(config.servers);

      if (entries.length === 0) {
        console.log(
          chalk.yellow(
            "No servers configured. Run `fleetmcp config add` to register servers first.",
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
          const sub: SubClient = { alias, client, dead: false, lastAttempt: 0, failures: 0 };
          // Protocol.connect() forwards transport.onclose here, and
          // StdioClientTransport fires it on the child's 'close' event — so a
          // crashed sub-server marks itself rather than being discovered on use.
          client.onclose = () => {
            sub.dead = true;
          };
          subClients.push(sub);

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
      await ensureFleetmcpDir();
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

      // ---------------------------------------------------------------------
      // Sub-server reconnect
      //
      // Sub-servers are connected once at startup and held warm. A stdio child
      // that dies — crash, OOM, npx cache eviction — would otherwise fail every
      // call to its tools until the proxy was restarted, which makes "always
      // warm" false the moment anything falls over.
      // ---------------------------------------------------------------------

      /** Replaces this alias's entries in the shared tool map and list. */
      async function refreshTools(sub: SubClient): Promise<void> {
        const { tools } = await sub.client.listTools();

        for (let i = allNamespacedTools.length - 1; i >= 0; i--) {
          if (allNamespacedTools[i]?.alias === sub.alias) allNamespacedTools.splice(i, 1);
        }
        for (const [name, nt] of toolMap) {
          if (nt.alias === sub.alias) toolMap.delete(name);
        }

        for (const tool of tools) {
          const nt: NamespacedTool = {
            namespacedName: `${sub.alias}_${tool.name}`,
            alias: sub.alias,
            originalName: tool.name,
            tool,
          };
          allNamespacedTools.push(nt);
          toolMap.set(nt.namespacedName, nt);
        }
      }

      /**
       * Returns true if the sub-server is usable. Reconnects a dead one at most
       * once per backoff window so a crash-looping server isn't hammered.
       *
       * ponytail: exponential 1s→30s, no jitter. Single-process proxy with one
       * caller, so there is no thundering herd to spread out.
       */
      /**
       * Resolves `<alias>_<name>` back to its sub-server.
       *
       * Aliases may themselves contain underscores, so this matches against
       * known aliases and takes the longest one that fits — splitting on the
       * first separator would mis-route when one alias prefixes another.
       */
      function splitNamespaced(
        namespaced: string,
      ): { sub: SubClient; name: string } | undefined {
        let best: { sub: SubClient; name: string } | undefined;

        for (const sub of subClients) {
          const prefix = `${sub.alias}_`;
          if (!namespaced.startsWith(prefix)) continue;
          if (best === undefined || sub.alias.length > best.sub.alias.length) {
            best = { sub, name: namespaced.slice(prefix.length) };
          }
        }

        return best;
      }

      // ---------------------------------------------------------------------
      // Resource addressing
      //
      // Tools and prompts namespace by name; resources are addressed by URI,
      // and two servers can expose the same one. The alias is carried inside
      // the URI so decoding is prefix-stripping rather than a lookup — nothing
      // to keep in sync, and collisions are impossible by construction.
      //
      // Safe because the spec treats URIs as opaque: a client lists them and
      // hands the value back to resources/read untouched. See #6.
      // ---------------------------------------------------------------------

      const URI_PREFIX = "fleet://";

      function wrapUri(alias: string, uri: string): string {
        return `${URI_PREFIX}${alias}/${uri}`;
      }

      function unwrapUri(wrapped: string): { sub: SubClient; uri: string } | undefined {
        if (!wrapped.startsWith(URI_PREFIX)) return undefined;

        const rest = wrapped.slice(URI_PREFIX.length);
        const slash = rest.indexOf("/");
        if (slash === -1) return undefined;

        const sub = clientMap.get(rest.slice(0, slash));
        if (!sub) return undefined;

        return { sub, uri: rest.slice(slash + 1) };
      }

      async function ensureLive(sub: SubClient): Promise<boolean> {
        if (!sub.dead) return true;

        const backoffMs = Math.min(1000 * 2 ** sub.failures, 30_000);
        if (Date.now() - sub.lastAttempt < backoffMs) return false;
        sub.lastAttempt = Date.now();

        try {
          const client = await createMcpClient({ alias: sub.alias });
          client.onclose = () => {
            sub.dead = true;
          };
          sub.client = client;
          sub.dead = false;
          sub.failures = 0;
          // The server may have changed while it was down.
          await refreshTools(sub);
          console.log(chalk.green(`Reconnected to ${chalk.cyan(sub.alias)}`));
          return true;
        } catch {
          sub.failures++;
          return false;
        }
      }

      // MCP requires an init handshake before tool calls, so the proxy
      // must use stateful sessions. Each session gets its own server+transport
      // pair that persists across requests; the sub-client pool is shared.

      interface ProxySession {
        server: Server;
        transport: WebStandardStreamableHTTPServerTransport;
        /** Touched on every request; drives the idle sweep below. */
        lastSeen: number;
      }

      const sessions = new Map<string, ProxySession>();

      // A client that disconnects without sending DELETE leaves no event to
      // hook, so elapsed time is the only signal we have.
      // ponytail: fixed 30-min idle window, swept every 5 min. Make it a flag
      // only if someone actually needs a different window.
      const SESSION_IDLE_MS = 30 * 60_000;
      const sessionSweep = setInterval(() => {
        const cutoff = Date.now() - SESSION_IDLE_MS;
        for (const [id, session] of sessions) {
          if (session.lastSeen < cutoff) {
            sessions.delete(id);
            void session.transport.close().catch(() => {});
          }
        }
      }, 5 * 60_000);

      closeSessions = () => {
        clearInterval(sessionSweep);
        for (const session of sessions.values()) {
          void session.transport.close().catch(() => {});
        }
        sessions.clear();
      };

      function createSession(): ProxySession {
        const server = new Server(
          { name: "fleetmcp-proxy", version: packageJson.version },
          // Declared bare: subscribe/listChanged are not forwarded.
          { capabilities: { tools: {}, prompts: {}, resources: {} } },
        );

        server.setRequestHandler(ListResourcesRequestSchema, async () => {
          const resources = [];

          for (const sub of subClients) {
            if (!sub.client.getServerCapabilities()?.resources) continue;
            if (!(await ensureLive(sub))) continue;

            try {
              const result = await sub.client.listResources();
              for (const resource of result.resources) {
                resources.push({
                  ...resource,
                  uri: wrapUri(sub.alias, resource.uri),
                  description: `[${sub.alias}] ${resource.description ?? ""}`.trim(),
                });
              }
            } catch {
              // One sub-server failing shouldn't blank the fleet's list.
            }
          }

          return { resources };
        });

        server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
          const resourceTemplates = [];

          for (const sub of subClients) {
            if (!sub.client.getServerCapabilities()?.resources) continue;
            if (!(await ensureLive(sub))) continue;

            try {
              const result = await sub.client.listResourceTemplates();
              for (const template of result.resourceTemplates) {
                resourceTemplates.push({
                  ...template,
                  // The client expands the {placeholder} and sends back a URI
                  // that was never in any list — the alias has to travel in
                  // the string for that to resolve.
                  uriTemplate: wrapUri(sub.alias, template.uriTemplate),
                  description: `[${sub.alias}] ${template.description ?? ""}`.trim(),
                });
              }
            } catch {
              // Same: a failing sub-server is skipped, not fatal.
            }
          }

          return { resourceTemplates };
        });

        server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
          const target = unwrapUri(request.params.uri);
          if (!target) {
            throw new Error(`Unknown resource: ${request.params.uri}`);
          }

          if (!(await ensureLive(target.sub))) {
            throw new Error(`Server ${target.sub.alias} is down`);
          }

          const result = await target.sub.client.readResource({ uri: target.uri });

          // The sub-server echoes its own URI back; rewrite it so the client
          // keeps holding the handle it was given.
          return {
            ...result,
            contents: result.contents.map((content) => ({
              ...content,
              uri: wrapUri(target.sub.alias, String(content.uri)),
            })),
          };
        });

        server.setRequestHandler(ListPromptsRequestSchema, async () => {
          const prompts = [];

          for (const sub of subClients) {
            if (!sub.client.getServerCapabilities()?.prompts) continue;
            if (!(await ensureLive(sub))) continue;

            try {
              const result = await sub.client.listPrompts();
              for (const prompt of result.prompts) {
                prompts.push({
                  ...prompt,
                  name: `${sub.alias}_${prompt.name}`,
                  description: `[${sub.alias}] ${prompt.description ?? ""}`.trim(),
                });
              }
            } catch {
              // A sub-server failing its list shouldn't blank the whole fleet's.
            }
          }

          return { prompts };
        });

        server.setRequestHandler(GetPromptRequestSchema, async (request) => {
          const target = splitNamespaced(request.params.name);
          if (!target) {
            throw new Error(`Unknown prompt: ${request.params.name}`);
          }

          if (!(await ensureLive(target.sub))) {
            throw new Error(`Server ${target.sub.alias} is down`);
          }

          return target.sub.client.getPrompt({
            name: target.name,
            ...(request.params.arguments ? { arguments: request.params.arguments } : {}),
          });
        });

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

          if (!(await ensureLive(sub))) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Server ${entry.alias} is down and reconnect failed (${sub.failures} attempt(s)). Retrying with backoff.`,
                },
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

        let sessionId: string | undefined;

        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (id) => {
            sessionId = id;
            sessions.set(id, { server, transport, lastSeen: Date.now() });
          },
        });

        // The SDK funnels every termination path — DELETE, transport error,
        // shutdown — through close(), which fires onclose. One hook covers
        // them all; without it the map entry outlives the session forever.
        transport.onclose = () => {
          if (sessionId !== undefined) sessions.delete(sessionId);
        };

        return { server, transport, lastSeen: Date.now() };
      }

      // The proxy's running state, handed to the route modules. Passed rather
      // than held at module scope so nothing leaks between two proxies in one
      // process, and so each route module can be tested without a real server.
      const runtime: ProxyRuntime = {
        subClients,
        clientMap,
        ensureLive,
        wrapUri,
        unwrapUri,
        get db() {
          return db;
        },
      };

      // 4. Start Bun HTTP server with session-aware routing
      httpServer = Bun.serve({
        port,
        // Traffic's SSE stream is long-lived and can sit idle between calls;
        // Bun's default idle timeout would otherwise drop it out from under
        // an open browser tab. Disabled server-wide since nothing else here
        // depends on idle connections being reaped.
        idleTimeout: 0,
        // Bundled by Bun's HTML import, so the compiled binary carries the UI.
        // Routing inside the app is hash-based, which keeps deep links working
        // without a server-side catch-all.
        routes: { "/ui": uiIndex, ...apiRoutes(runtime) },
        async fetch(req) {
          const url = new URL(req.url);

          // Unmatched /api/* must not fall through to the HTML shell below --
          // the UI would try to parse a page as JSON.
          if (url.pathname.startsWith("/api/")) {
            return apiError(404, "not_found", `No API route ${url.pathname}`);
          }

          if (url.pathname === "/mcp") {
            const sessionId = req.headers.get("mcp-session-id");

            if (sessionId) {
              const existing = sessions.get(sessionId);
              if (existing) {
                existing.lastSeen = Date.now();
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
                name: "fleetmcp-proxy",
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

      // Bun assigns the real port when `port` is 0, so report what was bound
      // rather than what was asked for. Tests spawn with `-p 0` and read this
      // back, which is what lets suites run concurrently without colliding.
      const boundPort = httpServer.port;

      console.log(
        chalk.green(`\nProxy listening on `) +
          chalk.cyan.bold(`http://localhost:${boundPort}/mcp`),
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
