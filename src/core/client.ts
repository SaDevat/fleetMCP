import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createTransport } from "./transport.ts";
import { getConfig, resolveServerConfig } from "./config.ts";
import type { ServerConfig } from "../types/config.ts";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import packageJson from "../../package.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Protocol version capture
//
// The SDK stores the negotiated protocolVersion from the initialize response
// internally but doesn't expose it via any public API for stdio transports.
// We intercept the transport's onmessage callback to capture it from the raw
// JSON-RPC response before the SDK processes it.
// ---------------------------------------------------------------------------

const clientProtocolVersions = new WeakMap<Client, string>();

/**
 * Returns the MCP protocol version negotiated during the initialize handshake.
 * Works for all transport types (stdio, HTTP, SSE).
 */
export function getClientProtocolVersion(client: Client): string {
  return clientProtocolVersions.get(client) ?? "unknown";
}

// ---------------------------------------------------------------------------
// createMcpClient
//
// High-level factory used by every command (inspect, call, test, proxy).
// Resolves an alias from the config OR accepts a raw ServerConfig,
// creates the correct transport, connects, and returns the ready Client.
//
// The caller is responsible for calling client.close() when done.
// ---------------------------------------------------------------------------

export interface McpClientOptions {
  /** A registered alias from ~/.fleetmcp/config.yml */
  alias?: string;
  /** A raw ServerConfig — bypasses the registry (used for inline URLs) */
  serverConfig?: ServerConfig;
}

export async function createMcpClient(options: McpClientOptions): Promise<Client> {
  let serverConfig: ServerConfig;

  if (options.serverConfig) {
    serverConfig = options.serverConfig;
  } else if (options.alias) {
    const config = await getConfig();
    const found = config.servers[options.alias];
    if (!found) {
      throw new Error(
        `Alias "${options.alias}" not found in ~/.fleetmcp/config.yml. ` +
        `Run \`fleetmcp config list\` to see registered servers.`
      );
    }
    serverConfig = found;
  } else {
    throw new Error("Must provide either alias or serverConfig.");
  }

  // Resolve ${VAR} patterns in env/headers before creating transport
  const resolved = resolveServerConfig(serverConfig);
  const transport = await createTransport(resolved);

  // Capture stderr from stdio child processes so we can surface the real
  // failure reason (npm 404, missing env var, ENOENT, etc.) on connect failure.
  const stderrChunks: Buffer[] = [];
  if (transport instanceof StdioClientTransport && transport.stderr) {
    transport.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
  }

  const client = new Client(
    { name: "fleetmcp", version: packageJson.version },
    { enforceStrictCapabilities: false }
  );

  // Intercept transport messages to capture the protocol version from the
  // initialize response. We wrap onmessage so the SDK still processes
  // everything normally — we just peek at the first result that carries
  // protocolVersion.
  const origOnMessage = transport.onmessage;
  let captured = false;
  transport.onmessage = (message: JSONRPCMessage) => {
    if (
      !captured &&
      "result" in message &&
      typeof message.result === "object" &&
      message.result !== null &&
      "protocolVersion" in message.result &&
      typeof (message.result as Record<string, unknown>).protocolVersion === "string"
    ) {
      clientProtocolVersions.set(
        client,
        (message.result as Record<string, unknown>).protocolVersion as string,
      );
      captured = true;
    }
    origOnMessage?.call(transport, message);
  };

  try {
    await client.connect(transport);
  } catch (error) {
    const detail = Buffer.concat(stderrChunks).toString().trim();
    if (detail) {
      const msg = error instanceof Error ? error.message : "Connection failed";
      throw new Error(`${msg}\n\nServer stderr:\n${detail}`);
    }
    throw error;
  }

  return client;
}
