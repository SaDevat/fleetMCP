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

const transport = new StdioServerTransport();
await server.connect(transport);
