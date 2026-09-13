import { Command } from "commander";
import Table from "cli-table3";
import chalk from "chalk";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createMcpClient } from "../core/client.ts";
import { getConfig } from "../core/config.ts";
import { die } from "../utils/error.ts";
import type { CheckResult } from "../types/results.ts";
import { brandSpinner } from "../utils/brand.ts";

// ---------------------------------------------------------------------------
// Individual checks — each returns a CheckResult
// ---------------------------------------------------------------------------

export async function checkConnection(
  alias: string,
): Promise<{ client: Awaited<ReturnType<typeof createMcpClient>>; result: CheckResult }> {
  const start = performance.now();
  try {
    const client = await createMcpClient({ alias });
    return {
      client,
      result: {
        name: "Connection handshake",
        passed: true,
        durationMs: Math.round(performance.now() - start),
      },
    };
  } catch (error) {
    throw Object.assign(
      new Error(error instanceof Error ? error.message : "Connection failed"),
      {
        checkResult: {
          name: "Connection handshake",
          passed: false,
          durationMs: Math.round(performance.now() - start),
          error: error instanceof Error ? error.message : "Unknown error",
        } satisfies CheckResult,
      },
    );
  }
}

export async function checkToolsList(
  client: Awaited<ReturnType<typeof createMcpClient>>,
): Promise<{ tools: Tool[]; result: CheckResult }> {
  const start = performance.now();
  try {
    const { tools } = await client.listTools();
    return {
      tools,
      result: {
        name: "Tools list",
        passed: true,
        durationMs: Math.round(performance.now() - start),
      },
    };
  } catch (error) {
    return {
      tools: [],
      result: {
        name: "Tools list",
        passed: false,
        durationMs: Math.round(performance.now() - start),
        error: error instanceof Error ? error.message : "Unknown error",
      },
    };
  }
}

export function checkSchemaIntegrity(tools: Tool[]): CheckResult {
  const start = performance.now();
  const invalid: string[] = [];

  for (const tool of tools) {
    const schema = tool.inputSchema as Record<string, unknown> | undefined;
    if (!schema || schema["type"] !== "object") {
      invalid.push(tool.name);
    }
  }

  if (invalid.length > 0) {
    return {
      name: "Schema integrity",
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: `Tools with invalid inputSchema (missing type:"object"): ${invalid.join(", ")}`,
    };
  }

  return {
    name: "Schema integrity",
    passed: true,
    durationMs: Math.round(performance.now() - start),
  };
}

export async function checkErrorResilience(
  client: Awaited<ReturnType<typeof createMcpClient>>,
  tools: Tool[],
): Promise<CheckResult> {
  const start = performance.now();
  const crashed: string[] = [];

  for (const tool of tools) {
    try {
      const result = await client.callTool(
        { name: tool.name, arguments: {} },
        undefined,
        { timeout: 10_000 },
      );
      const resultObj = result as Record<string, unknown>;
      const isError = resultObj["isError"] === true;
      const hasContent = Array.isArray(resultObj["content"]);
      if (!isError && !hasContent) {
        crashed.push(`${tool.name} (no content/isError)`);
      }
    } catch (error) {
      if (error instanceof McpError) {
        continue;
      }
      // JSON-RPC protocol-level rejection (e.g. -32601 Method not found, -32602 Invalid params)
      const maybeCode = (error as Record<string, unknown>)["code"];
      if (typeof maybeCode === "number" && maybeCode < 0) {
        continue;
      }
      crashed.push(tool.name);
    }
  }

  if (crashed.length > 0) {
    return {
      name: "Error resilience",
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: `Tools that crashed on empty args: ${crashed.join(", ")}`,
    };
  }

  return {
    name: "Error resilience",
    passed: true,
    durationMs: Math.round(performance.now() - start),
  };
}

export async function checkUnknownTool(
  client: Awaited<ReturnType<typeof createMcpClient>>,
): Promise<CheckResult> {
  const start = performance.now();
  try {
    const result = await client.callTool(
      { name: "__fleetmcp_probe_nonexistent_tool__", arguments: {} },
      undefined,
      { timeout: 10_000 },
    );
    const resultObj = result as Record<string, unknown>;
    if (resultObj["isError"] === true) {
      return {
        name: "Unknown tool rejection",
        passed: true,
        durationMs: Math.round(performance.now() - start),
      };
    }
    return {
      name: "Unknown tool rejection",
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: "Server accepted a nonexistent tool without error",
    };
  } catch {
    return {
      name: "Unknown tool rejection",
      passed: true,
      durationMs: Math.round(performance.now() - start),
    };
  }
}

// ---------------------------------------------------------------------------
// Result rendering
// ---------------------------------------------------------------------------

function renderResults(alias: string, checks: CheckResult[], totalMs: number): void {
  const table = new Table({
    head: [
      chalk.cyan("Check"),
      chalk.cyan("Result"),
      chalk.cyan("Duration"),
      chalk.cyan("Details"),
    ],
    style: { head: [] },
    colWidths: [24, 10, 12, 50],
    wordWrap: true,
  });

  for (const check of checks) {
    table.push([
      chalk.white(check.name),
      check.passed ? chalk.green("PASS") : chalk.red("FAIL"),
      chalk.dim(`${check.durationMs}ms`),
      check.error ? chalk.red(check.error) : chalk.dim("—"),
    ]);
  }

  console.log(table.toString());

  const passed = checks.filter((c) => c.passed).length;
  const total = checks.length;
  const allPassed = passed === total;

  console.log(
    `\n${allPassed ? chalk.green("All checks passed") : chalk.red(`${total - passed} check(s) failed`)}` +
      ` for ${chalk.cyan(alias)} ${chalk.dim(`(${totalMs}ms)`)}`,
  );
}

// ---------------------------------------------------------------------------
// Test Command
// ---------------------------------------------------------------------------

export const testCommand = new Command("test")
  .description("Run automated health and compliance checks against a server")
  .argument("<alias>", "Server alias from ~/.fleetmcp/config.yml")
  .option("--ci", "Exit with non-zero code on any failure (for CI/CD)")
  .action(async (alias: string, options: { ci: true | undefined }) => {
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
      const config = await getConfig();
      if (config.servers[alias] === undefined) {
        die(
          new Error(
            `Alias "${alias}" not found in ~/.fleetmcp/config.yml. Run \`fleetmcp config list\` to see registered servers.`,
          ),
          1,
        );
      }

      const totalStart = performance.now();
      const checks: CheckResult[] = [];

      // 1. Connection handshake
      spinner = brandSpinner(`Connecting to ${chalk.cyan(alias)}...`).start();
      try {
        const conn = await checkConnection(alias);
        client = conn.client;
        connected = true;
        checks.push(conn.result);
        spinner.succeed(`Connected to ${chalk.cyan(alias)}`);
      } catch (error) {
        spinner.fail(`Failed to connect to ${chalk.cyan(alias)}`);
        const enriched = error as { checkResult?: CheckResult };
        if (enriched.checkResult) {
          checks.push(enriched.checkResult);
        }
        renderResults(alias, checks, Math.round(performance.now() - totalStart));
        await cleanup();
        if (options.ci === true) process.exit(4);
        die(error, 2);
      }

      // 2. Tools list
      spinner = brandSpinner("Listing tools...").start();
      const toolsResult = await checkToolsList(client);
      checks.push(toolsResult.result);
      if (toolsResult.result.passed) {
        spinner.succeed(`Found ${toolsResult.tools.length} tool(s)`);
      } else {
        spinner.fail("Failed to list tools");
      }

      // 3. Schema integrity (synchronous, no spinner needed)
      if (toolsResult.tools.length > 0) {
        const schemaCheck = checkSchemaIntegrity(toolsResult.tools);
        checks.push(schemaCheck);
      } else {
        checks.push({
          name: "Schema integrity",
          passed: true,
          durationMs: 0,
        });
      }

      // 4. Error resilience
      if (toolsResult.tools.length > 0) {
        spinner = brandSpinner(
          `Testing error resilience (${toolsResult.tools.length} tool(s))...`,
        ).start();
        const resilienceCheck = await checkErrorResilience(client, toolsResult.tools);
        checks.push(resilienceCheck);
        if (resilienceCheck.passed) {
          spinner.succeed("Error resilience OK");
        } else {
          spinner.fail("Error resilience issues detected");
        }
      } else {
        checks.push({
          name: "Error resilience",
          passed: true,
          durationMs: 0,
        });
      }

      // 5. Unknown tool rejection
      spinner = brandSpinner("Testing unknown tool rejection...").start();
      const unknownToolCheck = await checkUnknownTool(client);
      checks.push(unknownToolCheck);
      if (unknownToolCheck.passed) {
        spinner.succeed("Unknown tool rejection OK");
      } else {
        spinner.fail("Unknown tool rejection issue detected");
      }

      const totalMs = Math.round(performance.now() - totalStart);
      renderResults(alias, checks, totalMs);

      await cleanup();

      const allPassed = checks.every((c) => c.passed);
      if (!allPassed && options.ci === true) {
        process.exit(4);
      }
    } catch (error) {
      await cleanup();
      if (options.ci === true) process.exit(4);
      die(error, connected ? 3 : 2);
    } finally {
      process.removeListener("SIGINT", onSigint);
    }
  });
