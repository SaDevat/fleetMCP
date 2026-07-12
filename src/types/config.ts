import { z } from "zod";

// ---------------------------------------------------------------------------
// Server Configuration Variants
// Discriminated on the `type` field — matches PRD Section 3.D and 4.
// ---------------------------------------------------------------------------

export const StdioServerConfigSchema = z.object({
  type: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string(), z.string()).optional().default({}),
});

export const HttpServerConfigSchema = z.object({
  type: z.literal("http"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional().default({}),
});

export const ServerConfigSchema = z.discriminatedUnion("type", [
  StdioServerConfigSchema,
  HttpServerConfigSchema,
]);

// ---------------------------------------------------------------------------
// Root Config Schema — serialized to/from ~/.mcpx/config.yml
// ---------------------------------------------------------------------------

export const McpxConfigSchema = z.object({
  version: z.literal(1).default(1),
  servers: z.record(z.string(), ServerConfigSchema).default({}),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript Types — import these everywhere instead of raw Zod types
// ---------------------------------------------------------------------------

export type StdioServerConfig = z.infer<typeof StdioServerConfigSchema>;
export type HttpServerConfig = z.infer<typeof HttpServerConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type McpxConfig = z.infer<typeof McpxConfigSchema>;
