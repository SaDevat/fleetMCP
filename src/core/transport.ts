import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ServerConfig } from "../types/config.ts";

// ---------------------------------------------------------------------------
// Transport Factory
//
// Reads a ServerConfig discriminated union and returns the correct MCP transport.
// The caller (createMcpClient) never needs to know which transport is in use.
// ---------------------------------------------------------------------------

export async function createTransport(serverConfig: ServerConfig): Promise<Transport> {
  switch (serverConfig.type) {
    case "stdio": {
      return new StdioClientTransport({
        command: serverConfig.command,
        args: serverConfig.args,
        env: {
          ...process.env,
          ...serverConfig.env,
        } as Record<string, string>,
        stderr: "pipe",
      });
    }

    case "http": {
      const url = new URL(serverConfig.url);
      const headers = new Headers(serverConfig.headers);

      try {
        return new StreamableHTTPClientTransport(url, {
          requestInit: { headers },
        }) as unknown as Transport;
      } catch {
        // Fall back to legacy SSEClientTransport for pre-v2 servers.
        return new SSEClientTransport(url);
      }
    }

    default: {
      const _exhaustive: never = serverConfig;
      throw new Error(`Unknown server type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
