import { Command } from "commander";
import chalk from "chalk";
import { createMcpClient } from "../core/client.ts";
import { readStdin } from "../utils/stdin.ts";
import { die } from "../utils/error.ts";
import { prettyJson } from "../formatters/json.ts";
import { brandSpinner } from "../utils/brand.ts";

// ---------------------------------------------------------------------------
// Argument Parsing — JSON-first with optional --raw override
// ---------------------------------------------------------------------------

function coerceValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value) && value !== "") {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return value;
}

function tryParseJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not valid JSON
  }
  return undefined;
}

function parseToolArgs(
  positionalArgs: string[],
  pipedData: unknown | null,
  raw: boolean,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    pipedData !== null && typeof pipedData === "object" && !Array.isArray(pipedData)
      ? { ...(pipedData as Record<string, unknown>) }
      : {};

  if (positionalArgs.length === 0) return base;

  // Single arg — try JSON-first (always, regardless of --raw)
  if (positionalArgs.length === 1) {
    const first = positionalArgs[0];
    if (first !== undefined) {
      const jsonObj = tryParseJsonObject(first);
      if (jsonObj !== undefined) {
        return { ...base, ...jsonObj };
      }
    }
  }

  // key=value parsing
  for (const arg of positionalArgs) {
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) {
      // Bare arg — try as JSON object
      const jsonObj = tryParseJsonObject(arg);
      if (jsonObj !== undefined) {
        Object.assign(base, jsonObj);
        continue;
      }
      throw new Error(
        `Invalid argument "${arg}". Use key=value pairs or a JSON string.`,
      );
    }

    const key = arg.slice(0, eqIndex);
    const value = arg.slice(eqIndex + 1);
    base[key] = raw ? value : coerceValue(value);
  }

  return base;
}

// ---------------------------------------------------------------------------
// Content Rendering — handles every MCP content type
// ---------------------------------------------------------------------------

function renderContent(result: Record<string, unknown>, isError: boolean): void {
  // Legacy compat shape: { toolResult: unknown }
  if ("toolResult" in result && !("content" in result)) {
    console.log(prettyJson(result["toolResult"]));
    return;
  }

  const content = result["content"];
  if (!Array.isArray(content)) return;

  for (const item of content) {
    if (typeof item !== "object" || item === null) continue;
    const typed = item as Record<string, unknown>;

    switch (typed["type"]) {
      case "text": {
        const text = String(typed["text"] ?? "");
        console.log(isError ? chalk.red(text) : text);
        break;
      }
      case "image": {
        const mime = String(typed["mimeType"] ?? "unknown");
        const data = String(typed["data"] ?? "");
        const bytes = Math.ceil((data.length * 3) / 4);
        console.log(chalk.dim(`[Image: ${mime}, ~${bytes} bytes base64]`));
        break;
      }
      case "audio": {
        const mime = String(typed["mimeType"] ?? "unknown");
        const data = String(typed["data"] ?? "");
        const bytes = Math.ceil((data.length * 3) / 4);
        console.log(chalk.dim(`[Audio: ${mime}, ~${bytes} bytes base64]`));
        break;
      }
      case "resource": {
        const resource = typed["resource"];
        if (typeof resource === "object" && resource !== null) {
          const res = resource as Record<string, unknown>;
          console.log(chalk.cyan(String(res["uri"] ?? "")));
          if (typeof res["text"] === "string") {
            console.log(res["text"]);
          } else if (typeof res["blob"] === "string") {
            const bytes = Math.ceil((res["blob"].length * 3) / 4);
            console.log(chalk.dim(`[Binary resource: ~${bytes} bytes]`));
          }
        }
        break;
      }
      case "resource_link": {
        const uri = String(typed["uri"] ?? "");
        const name = String(typed["name"] ?? "");
        console.log(`${chalk.cyan(uri)} ${chalk.dim(name)}`);
        break;
      }
      default:
        console.log(prettyJson(typed));
    }
  }

  const structured = result["structuredContent"];
  if (structured !== undefined && structured !== null) {
    console.log(chalk.bold.cyan("\nStructured Content:"));
    console.log(prettyJson(structured));
  }
}

// ---------------------------------------------------------------------------
// Call Command
// ---------------------------------------------------------------------------

export const callCommand = new Command("call")
  .description("Invoke a tool on a configured server (the cURL for MCP)")
  .argument("<alias>", "Server alias from ~/.fleetmcp/config.yml")
  .argument("<tool>", "Tool name to invoke")
  .argument("[args...]", "Tool arguments as key=value pairs or a JSON string")
  .option("--raw", "Disable smart coercion on key=value pairs (values stay strings)")
  .option("--timeout <ms>", "Request timeout in milliseconds", "60000")
  .action(
    async (
      alias: string,
      toolName: string,
      args: string[],
      options: { raw: true | undefined; timeout: string },
    ) => {
      let client: Awaited<ReturnType<typeof createMcpClient>> | undefined;
      let spinner: ReturnType<typeof brandSpinner> | undefined;
      let connected = false;

      async function cleanup(): Promise<void> {
        spinner?.stop();
        if (client) {
          await Promise.race([
            client.close().catch(() => {}),
            new Promise((r) => setTimeout(r, 3000)),
          ]);
          client = undefined;
        }
      }

      const onSigint = async () => {
        await cleanup();
        process.exit(130);
      };
      process.on("SIGINT", onSigint);

      try {
        // 1. Parse arguments (stdin + positional)
        const pipedData = await readStdin();
        const raw = options.raw === true;
        const toolArgs = parseToolArgs(args, pipedData, raw);
        const timeoutMs = parseInt(options.timeout, 10) || 60_000;

        // 2. Connect (SDK handles the initialize handshake internally)
        spinner = brandSpinner(`Connecting to ${chalk.cyan(alias)}...`).start();
        client = await createMcpClient({ alias });
        connected = true;

        // 3. Call tool with live progress updates on the spinner
        spinner.text = `Calling ${chalk.cyan(toolName)}...`;
        const result = await client.callTool(
          { name: toolName, arguments: toolArgs },
          undefined,
          {
            onprogress: (ev) => {
              if (spinner) {
                const pct = ev.total !== undefined
                  ? `${Math.round((ev.progress / ev.total) * 100)}%`
                  : `step ${ev.progress}`;
                spinner.text = `Calling ${chalk.cyan(toolName)}... ${chalk.yellow(pct)}`;
              }
            },
            resetTimeoutOnProgress: true,
            timeout: timeoutMs,
          },
        );

        // 4. Determine error status and stop spinner
        const resultObj = result as Record<string, unknown>;
        const isError = resultObj["isError"] === true;

        if (isError) {
          spinner.fail(`${chalk.cyan(toolName)} returned an error`);
        } else {
          spinner.succeed(`${chalk.cyan(toolName)} completed`);
        }

        // 5. Render all content items
        renderContent(resultObj, isError);

        // 6. Graceful shutdown
        await cleanup();

        if (isError) {
          process.exit(3);
        }
      } catch (error) {
        await cleanup();
        die(error, connected ? 3 : 2);
      } finally {
        process.removeListener("SIGINT", onSigint);
      }
    },
  );
