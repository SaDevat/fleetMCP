import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "echo-test-server",
  version: "1.0.0",
});

server.tool(
  "echo",
  "Echoes back whatever arguments are provided",
  { text: z.string().optional(), data: z.any().optional() },
  async (args) => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(args, null, 2),
      },
    ],
  }),
);

// A prompt and a resource so the proxy's forwarding can be tested without
// pulling an npx server. The resource URI is deliberately generic — registering
// this same server under two aliases produces a collision, which is the whole
// point of the fleet:// wrapper.
server.registerPrompt(
  "greet",
  { description: "Greets whoever you name", argsSchema: { who: z.string() } },
  ({ who }) => ({
    messages: [
      { role: "user" as const, content: { type: "text" as const, text: `Hello, ${who}` } },
    ],
  }),
);

server.registerResource(
  "readme",
  "file:///README.md",
  { description: "A fixed document", mimeType: "text/plain" },
  (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/plain", text: "echo-server readme" }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
