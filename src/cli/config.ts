import { Command } from "commander";
import Table from "cli-table3";
import chalk from "chalk";
import * as p from "@clack/prompts";
import {
  getConfig,
  saveConfig,
  ensureFleetmcpDir,
  resolveServerConfig,
  pinStdioPaths,
} from "../core/config.ts";
import { FleetmcpConfigSchema, ServerConfigSchema } from "../types/config.ts";
import type { ServerConfig } from "../types/config.ts";
import { prettyJson } from "../formatters/json.ts";
import { die } from "../utils/error.ts";
import { statusDot, palette } from "../utils/brand.ts";

// ---------------------------------------------------------------------------
// Root `config` command (groups subcommands)
// ---------------------------------------------------------------------------

export const configCommand = new Command("config").description(
  "Manage the fleetmcp server registry (~/.fleetmcp/config.yml)"
);

// ---------------------------------------------------------------------------
// `fleetmcp config list`
// ---------------------------------------------------------------------------

configCommand
  .command("list")
  .description("Display all configured servers in a table")
  .action(async () => {
    const config = await getConfig();
    const entries = Object.entries(config.servers);

    if (entries.length === 0) {
      console.log(
        palette.warning("No servers configured. Run `fleetmcp config add` to get started."),
      );
      return;
    }

    const table = new Table({
      head: ["", palette.primary("Alias"), palette.primary("Type"), palette.primary("Connection")],
      style: { head: [] },
      colWidths: [3, 20, 8, 50],
      wordWrap: true,
    });

    for (const [alias, serverConfig] of entries) {
      const connection =
        serverConfig.type === "stdio"
          ? `${serverConfig.command} ${serverConfig.args?.join(" ") ?? ""}`.trim()
          : serverConfig.url;

      let status: string;
      if (serverConfig.type === "stdio") {
        const resolved = Bun.which(serverConfig.command);
        status = resolved ? statusDot.ok : statusDot.warn;
      } else {
        status = statusDot.unknown;
      }

      table.push([status, chalk.white(alias), palette.success(serverConfig.type), connection]);
    }

    console.log(table.toString());
    console.log(palette.dim(`\n${entries.length} server(s) configured.`));
    console.log(
      palette.dim(
        `${statusDot.ok} binary found  ${statusDot.warn} binary not found  ${statusDot.unknown} HTTP (unchecked)`,
      ),
    );
  });

// ---------------------------------------------------------------------------
// `fleetmcp config add <alias>` — Interactive wizard + flag-based mode
// ---------------------------------------------------------------------------

function collectEnv(val: string, acc: string[]): string[] {
  return [...acc, val];
}

function validateCommand(command: string): void {
  const baseCommand = command.split(" ")[0];
  if (!baseCommand) return;

  const resolved = Bun.which(baseCommand);
  if (!resolved) {
    if (baseCommand === "npx" || baseCommand === "bunx") {
      const npxResolved = Bun.which(baseCommand);
      if (!npxResolved) {
        console.warn(
          chalk.yellow(
            `Warning: "${baseCommand}" not found on PATH. Install Node.js/Bun first.`,
          ),
        );
      }
    } else {
      console.warn(
        chalk.yellow(
          `Warning: "${baseCommand}" not found on PATH. The server may fail to start.`,
        ),
      );
    }
  }
}

configCommand
  .command("add [alias]")
  .description("Add a new server to the registry (interactive or flag-based)")
  .option("-t, --type <type>", "Server transport type: stdio | http")
  .option("-c, --command <cmd>", "Command to run (stdio only)")
  .option("-a, --args <args>", "Space-separated args for the command (stdio only)")
  .option("-u, --url <url>", "Server URL (http only)")
  .option("-e, --env <KEY=VALUE>", "Env var for the server (repeatable, stdio only)", collectEnv, [] as string[])
  .action(async (aliasArg: string | undefined, options: Record<string, string | string[] | undefined>) => {
    await ensureFleetmcpDir();
    const config = await getConfig();

    // Detect interactive mode: no alias OR (alias provided but missing required flags)
    const hasRequiredFlags = options["command"] || options["url"];
    const isInteractive = !aliasArg || !hasRequiredFlags;

    if (isInteractive) {
      // Interactive wizard mode
      p.intro(chalk.cyan("Add a new MCP server"));

      let alias = aliasArg;
      if (!alias) {
        const aliasInput = await p.text({
          message: "Server alias",
          placeholder: "my-server",
          validate: (val) => {
            if (!val || val.trim().length === 0) return "Alias is required";
            if (config.servers[val]) return `Alias "${val}" already exists`;
            return undefined;
          },
        });
        if (p.isCancel(aliasInput)) {
          p.cancel("Cancelled.");
          process.exit(0);
        }
        alias = aliasInput as string;
      } else if (config.servers[alias]) {
        p.cancel(
          chalk.red(
            `Alias "${alias}" already exists. Remove it first with \`fleetmcp config remove ${alias}\`.`,
          ),
        );
        process.exit(1);
      }

      const serverType = await p.select({
        message: "Transport type",
        options: [
          { value: "stdio", label: "Stdio", hint: "Local command (npx, bun, python...)" },
          { value: "http", label: "HTTP", hint: "Remote URL (SSE / Streamable HTTP)" },
        ],
      });
      if (p.isCancel(serverType)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }

      let serverConfig: ServerConfig;

      if (serverType === "stdio") {
        const command = await p.text({
          message: "Command",
          placeholder: "npx",
          validate: (val) => (val && val.trim().length > 0 ? undefined : "Command is required"),
        });
        if (p.isCancel(command)) {
          p.cancel("Cancelled.");
          process.exit(0);
        }

        validateCommand(command as string);

        const argsInput = await p.text({
          message: "Arguments (space-separated)",
          placeholder: "-y @modelcontextprotocol/server-everything",
          defaultValue: "",
        });
        if (p.isCancel(argsInput)) {
          p.cancel("Cancelled.");
          process.exit(0);
        }

        const envInput = await p.text({
          message: "Environment variables (KEY=VAL,KEY2=VAL2)",
          placeholder: "${MY_API_KEY} or raw value",
          defaultValue: "",
        });
        if (p.isCancel(envInput)) {
          p.cancel("Cancelled.");
          process.exit(0);
        }

        const envRecord: Record<string, string> = {};
        const envStr = (envInput as string).trim();
        if (envStr.length > 0) {
          for (const pair of envStr.split(",")) {
            const eqIdx = pair.indexOf("=");
            if (eqIdx > 0) {
              envRecord[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
            }
          }
        }

        const pinned = pinStdioPaths(
          command as string,
          (argsInput as string).trim().length > 0
            ? (argsInput as string).trim().split(/\s+/)
            : [],
        );

        serverConfig = ServerConfigSchema.parse({
          type: "stdio",
          command: pinned.command,
          args: pinned.args,
          env: envRecord,
        });
      } else {
        const url = await p.text({
          message: "Server URL",
          placeholder: "https://my-server.com/mcp",
          validate: (val) => {
            if (!val || val.trim().length === 0) return "URL is required";
            try {
              new URL(val);
              return undefined;
            } catch {
              return "Invalid URL";
            }
          },
        });
        if (p.isCancel(url)) {
          p.cancel("Cancelled.");
          process.exit(0);
        }

        const headersInput = await p.text({
          message: "Headers (Key:Val,Key2:Val2)",
          placeholder: "optional",
          defaultValue: "",
        });
        if (p.isCancel(headersInput)) {
          p.cancel("Cancelled.");
          process.exit(0);
        }

        const headersRecord: Record<string, string> = {};
        const headersStr = (headersInput as string).trim();
        if (headersStr.length > 0) {
          for (const pair of headersStr.split(",")) {
            const colonIdx = pair.indexOf(":");
            if (colonIdx > 0) {
              headersRecord[pair.slice(0, colonIdx).trim()] = pair.slice(colonIdx + 1).trim();
            }
          }
        }

        serverConfig = ServerConfigSchema.parse({
          type: "http",
          url: url as string,
          headers: headersRecord,
        });
      }

      config.servers[alias] = serverConfig;
      await saveConfig(config);

      p.outro(chalk.green(`Server "${alias}" added successfully.`));
    } else {
      // Flag-based mode (existing logic)
      const alias = aliasArg as string;

      if (config.servers[alias]) {
        console.error(
          chalk.red(
            `Error: alias "${alias}" already exists. Remove it first with \`fleetmcp config remove ${alias}\`.`,
          ),
        );
        process.exit(1);
      }

      const envRecord: Record<string, string> = {};
      const envEntries = options["env"];
      if (Array.isArray(envEntries)) {
        for (const entry of envEntries) {
          const eqIdx = entry.indexOf("=");
          if (eqIdx < 1) {
            console.error(
              chalk.yellow(
                `Warning: skipping malformed --env entry "${entry}" (expected KEY=VALUE)`,
              ),
            );
            continue;
          }
          const key = entry.slice(0, eqIdx);
          const value = entry.slice(eqIdx + 1);
          envRecord[key] = value;
        }
      }

      let rawServer: unknown;
      const typeOpt = options["type"] ?? "stdio";

      if (typeOpt === "stdio") {
        if (!options["command"]) {
          console.error(chalk.red("Error: --command is required for stdio servers."));
          process.exit(1);
        }
        const cmd = options["command"] as string;
        validateCommand(cmd);

        const pinned = pinStdioPaths(
          cmd,
          options["args"] ? (options["args"] as string).split(" ") : [],
        );

        rawServer = {
          type: "stdio",
          command: pinned.command,
          args: pinned.args,
          env: envRecord,
        };
      } else if (typeOpt === "http") {
        if (!options["url"]) {
          console.error(chalk.red("Error: --url is required for http servers."));
          process.exit(1);
        }
        rawServer = { type: "http", url: options["url"] };
      } else {
        console.error(chalk.red(`Error: unknown type "${typeOpt}". Use stdio or http.`));
        process.exit(1);
      }

      const serverConfig = ServerConfigSchema.parse(rawServer);
      config.servers[alias] = serverConfig;
      await saveConfig(config);

      console.log(chalk.green(`Added server "${alias}" (${serverConfig.type}).`));
    }
  });

// ---------------------------------------------------------------------------
// `fleetmcp config remove <alias>`
// ---------------------------------------------------------------------------

configCommand
  .command("remove <alias>")
  .description("Remove a server from the registry")
  .action(async (alias: string) => {
    const config = await getConfig();

    if (!config.servers[alias]) {
      console.error(chalk.red(`Error: alias "${alias}" not found.`));
      process.exit(1);
    }

    const { [alias]: _removed, ...remaining } = config.servers;
    const updated = FleetmcpConfigSchema.parse({ ...config, servers: remaining });
    await saveConfig(updated);

    console.log(chalk.green(`Removed server "${alias}".`));
  });

// ---------------------------------------------------------------------------
// `fleetmcp config check` — Validate ${VAR} interpolation
// ---------------------------------------------------------------------------

configCommand
  .command("check")
  .description("Check environment variable resolution for all servers")
  .action(async () => {
    const config = await getConfig();
    const entries = Object.entries(config.servers);

    if (entries.length === 0) {
      console.log(chalk.yellow("No servers configured."));
      return;
    }

    const table = new Table({
      head: [chalk.cyan("Alias"), chalk.cyan("Status"), chalk.cyan("Unresolved Variables")],
      style: { head: [] },
      colWidths: [20, 10, 50],
      wordWrap: true,
    });

    for (const [alias, serverConfig] of entries) {
      try {
        resolveServerConfig(serverConfig);
        table.push([chalk.white(alias), chalk.green("✓"), chalk.dim("—")]);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        table.push([chalk.white(alias), chalk.red("✗"), chalk.yellow(msg)]);
      }
    }

    console.log(table.toString());
  });

// ---------------------------------------------------------------------------
// Shared helpers for import/export
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapExternalEntry(raw: unknown): ServerConfig | undefined {
  if (!isRecord(raw)) return undefined;

  if (typeof raw["command"] === "string" && raw["command"].length > 0) {
    const args = Array.isArray(raw["args"])
      ? raw["args"].filter((a): a is string => typeof a === "string")
      : [];
    const env: Record<string, string> = {};
    const rawEnv = raw["env"];
    if (isRecord(rawEnv)) {
      for (const [k, v] of Object.entries(rawEnv)) {
        if (typeof v === "string") env[k] = v;
      }
    }
    return ServerConfigSchema.parse({ type: "stdio", command: raw["command"], args, env });
  }

  if (typeof raw["url"] === "string" && raw["url"].length > 0) {
    const headers: Record<string, string> = {};
    const rawHeaders = raw["headers"];
    if (isRecord(rawHeaders)) {
      for (const [k, v] of Object.entries(rawHeaders)) {
        if (typeof v === "string") headers[k] = v;
      }
    }
    return ServerConfigSchema.parse({ type: "http", url: raw["url"], headers });
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// `fleetmcp config import <path>`
// ---------------------------------------------------------------------------

configCommand
  .command("import <path>")
  .description(
    "Import servers from a Claude Desktop or Cursor config file"
  )
  .action(async (filePath: string) => {
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) {
      die(new Error(`File not found: ${filePath}`), 1);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      die(new Error(`Failed to parse JSON from ${filePath}`), 1);
    }

    if (!isRecord(parsed)) {
      die(new Error("Expected a JSON object at the top level."), 1);
    }

    const serversBlock = parsed["mcpServers"];
    if (!isRecord(serversBlock)) {
      die(
        new Error(
          `No "mcpServers" object found in ${filePath}. Expected Claude Desktop or Cursor config format.`
        ),
        1,
      );
    }

    await ensureFleetmcpDir();
    const config = await getConfig();

    const imported: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];

    for (const [alias, entry] of Object.entries(serversBlock)) {
      if (config.servers[alias] !== undefined) {
        skipped.push(alias);
        continue;
      }

      const serverConfig = mapExternalEntry(entry);
      if (serverConfig === undefined) {
        failed.push(alias);
        continue;
      }

      config.servers[alias] = serverConfig;
      imported.push(alias);
    }

    if (imported.length > 0) {
      await saveConfig(config);
    }

    console.log(chalk.bold.cyan("Import Summary"));
    if (imported.length > 0) {
      console.log(chalk.green(`  Imported: ${imported.join(", ")}`));
    }
    if (skipped.length > 0) {
      console.log(chalk.yellow(`  Skipped (duplicate): ${skipped.join(", ")}`));
    }
    if (failed.length > 0) {
      console.log(chalk.red(`  Failed (unrecognized format): ${failed.join(", ")}`));
    }
    if (imported.length === 0 && skipped.length === 0 && failed.length === 0) {
      console.log(chalk.yellow("  No entries found in mcpServers."));
    }

    console.log(chalk.bold.cyan("\nRegistry"));
    console.log(prettyJson(config.servers));
  });

// ---------------------------------------------------------------------------
// `fleetmcp config export [--format cursor|claude]`
// ---------------------------------------------------------------------------

function toClaudeFormat(servers: Record<string, ServerConfig>): Record<string, unknown> {
  const mcpServers: Record<string, unknown> = {};
  for (const [alias, serverConfig] of Object.entries(servers)) {
    if (serverConfig.type === "stdio") {
      const entry: Record<string, unknown> = {
        command: serverConfig.command,
        args: serverConfig.args,
      };
      if (Object.keys(serverConfig.env).length > 0) {
        entry["env"] = serverConfig.env;
      }
      mcpServers[alias] = entry;
    } else {
      const entry: Record<string, unknown> = { url: serverConfig.url };
      if (Object.keys(serverConfig.headers).length > 0) {
        entry["headers"] = serverConfig.headers;
      }
      mcpServers[alias] = entry;
    }
  }
  return { mcpServers };
}

function toCursorFormat(servers: Record<string, ServerConfig>): Record<string, unknown> {
  const mcpServers: Record<string, unknown> = {};
  for (const [alias, serverConfig] of Object.entries(servers)) {
    if (serverConfig.type === "stdio") {
      const entry: Record<string, unknown> = {
        command: serverConfig.command,
        args: serverConfig.args,
      };
      if (Object.keys(serverConfig.env).length > 0) {
        entry["env"] = serverConfig.env;
      }
      mcpServers[alias] = entry;
    } else {
      mcpServers[alias] = { url: serverConfig.url };
    }
  }
  return { mcpServers };
}

configCommand
  .command("export")
  .description("Export the registry to Claude Desktop or Cursor format (stdout)")
  .option(
    "-f, --format <format>",
    "Output format: claude | cursor",
    "claude",
  )
  .action(async (options: { format: string }) => {
    const fmt = options.format.toLowerCase();
    if (fmt !== "claude" && fmt !== "cursor") {
      die(new Error(`Unknown format "${fmt}". Use "claude" or "cursor".`), 1);
    }

    const config = await getConfig();
    const entries = Object.entries(config.servers);
    if (entries.length === 0) {
      console.error(
        chalk.yellow("No servers configured. Nothing to export."),
      );
      return;
    }

    const output = fmt === "cursor"
      ? toCursorFormat(config.servers)
      : toClaudeFormat(config.servers);

    console.log(JSON.stringify(output, null, 2));
  });
