import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { join } from "node:path";
import { homedir } from "node:os";
import { McpxConfigSchema, type McpxConfig, type ServerConfig } from "../types/config.ts";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const MCPX_DIR = join(homedir(), ".mcpx");
const CONFIG_PATH = join(MCPX_DIR, "config.yml");

// ---------------------------------------------------------------------------
// Secret Management — ${VAR} interpolation
// ---------------------------------------------------------------------------

const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Interpolates ${VAR} patterns in a string with values from process.env.
 * Throws if a variable is referenced but not set.
 */
export function interpolateEnv(value: string): string {
  return value.replace(ENV_VAR_PATTERN, (match, varName) => {
    const resolved = process.env[varName];
    if (resolved === undefined) {
      throw new Error(
        `Environment variable "${varName}" is not set. Add it to your .env file or export it.`,
      );
    }
    return resolved;
  });
}

/**
 * Resolves ${VAR} patterns in a ServerConfig's env/headers.
 * Returns a new ServerConfig with interpolated values.
 */
export function resolveServerConfig(raw: ServerConfig): ServerConfig {
  if (raw.type === "stdio") {
    const resolvedEnv: Record<string, string> = {};
    for (const [key, val] of Object.entries(raw.env)) {
      resolvedEnv[key] = interpolateEnv(val);
    }
    return { ...raw, env: resolvedEnv };
  }
  if (raw.type === "http") {
    const resolvedHeaders: Record<string, string> = {};
    for (const [key, val] of Object.entries(raw.headers)) {
      resolvedHeaders[key] = interpolateEnv(val);
    }
    return { ...raw, headers: resolvedHeaders };
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads and validates ~/.mcpx/config.yml.
 * If the file does not exist, returns a default empty config.
 * Throws a ZodError with a human-readable message if the file is malformed.
 */
export async function getConfig(): Promise<McpxConfig> {
  const file = Bun.file(CONFIG_PATH);
  const exists = await file.exists();

  if (!exists) {
    return McpxConfigSchema.parse({});
  }

  const raw = await file.text();
  const parsed = parseYaml(raw);
  return McpxConfigSchema.parse(parsed);
}

/**
 * Serializes a McpxConfig to YAML and writes it to ~/.mcpx/config.yml.
 * Creates ~/.mcpx/ if it does not exist.
 */
export async function saveConfig(config: McpxConfig): Promise<void> {
  await ensureMcpxDir();
  await Bun.write(Bun.file(CONFIG_PATH), stringifyYaml(config, { indent: 2 }));
}

/**
 * Ensures ~/.mcpx/ directory exists. Call before any write operation.
 */
export async function ensureMcpxDir(): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(MCPX_DIR, { recursive: true });
}
