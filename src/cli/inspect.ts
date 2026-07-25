import { Command } from "commander";
import chalk from "chalk";
import type {
  Prompt,
  Resource,
  ResourceTemplate,
  ServerCapabilities,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { createMcpClient, getClientProtocolVersion } from "../core/client.ts";
import { renderCapabilityTree } from "../formatters/tree.ts";
import { renderToolsTable } from "../formatters/table.ts";
import { prettyJson } from "../formatters/json.ts";
import { fuzzyRank } from "../utils/fuzzy.ts";
import { buildUsageExample, summarizeSchema } from "../utils/schema.ts";
import { die } from "../utils/error.ts";
import {
  brandBox,
  brandSpinner,
  palette,
  sectionHeader,
  bullet,
} from "../utils/brand.ts";

interface EnrichedTool {
  tool: Tool;
  schemaSummary: string;
  usageExample: string;
  fuzzyScore: number;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function listAllTools(client: Awaited<ReturnType<typeof createMcpClient>>): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;

  do {
    const result = await client.listTools(cursor === undefined ? undefined : { cursor });
    tools.push(...result.tools);
    cursor = result.nextCursor;
  } while (cursor !== undefined);

  return tools;
}

async function listAllResources(
  client: Awaited<ReturnType<typeof createMcpClient>>,
): Promise<Resource[]> {
  const resources: Resource[] = [];
  let cursor: string | undefined;

  do {
    const result = await client.listResources(cursor === undefined ? undefined : { cursor });
    resources.push(...result.resources);
    cursor = result.nextCursor;
  } while (cursor !== undefined);

  return resources;
}

async function listAllResourceTemplates(
  client: Awaited<ReturnType<typeof createMcpClient>>,
): Promise<ResourceTemplate[]> {
  const templates: ResourceTemplate[] = [];
  let cursor: string | undefined;

  do {
    const result = await client.listResourceTemplates(
      cursor === undefined ? undefined : { cursor },
    );
    templates.push(...result.resourceTemplates);
    cursor = result.nextCursor;
  } while (cursor !== undefined);

  return templates;
}

async function listAllPrompts(
  client: Awaited<ReturnType<typeof createMcpClient>>,
): Promise<Prompt[]> {
  const prompts: Prompt[] = [];
  let cursor: string | undefined;

  do {
    const result = await client.listPrompts(cursor === undefined ? undefined : { cursor });
    prompts.push(...result.prompts);
    cursor = result.nextCursor;
  } while (cursor !== undefined);

  return prompts;
}

function summarizeCapabilities(capabilities: ServerCapabilities | undefined): string {
  if (!capabilities) return "none advertised";

  const sections: string[] = [];

  if (capabilities.resources) {
    const parts = ["list", "read", "templates"];
    if (capabilities.resources.subscribe === true) parts.push("subscribe");
    if (capabilities.resources.listChanged === true) parts.push("listChanged");
    sections.push(`resources (${parts.join(", ")})`);
  }

  if (capabilities.tools) {
    const parts = ["list", "call"];
    if (capabilities.tools.listChanged === true) parts.push("listChanged");
    sections.push(`tools (${parts.join(", ")})`);
  }

  if (capabilities.prompts) {
    const parts = ["list", "get"];
    if (capabilities.prompts.listChanged === true) parts.push("listChanged");
    sections.push(`prompts (${parts.join(", ")})`);
  }

  if (capabilities.logging) sections.push("logging");
  if (capabilities.completions) sections.push("completions");
  if (capabilities.tasks) sections.push("tasks");

  return sections.length > 0 ? sections.join(", ") : "none advertised";
}

function getProtocolVersion(client: Awaited<ReturnType<typeof createMcpClient>>): string {
  return getClientProtocolVersion(client);
}

function enrichTools(target: string, tools: Tool[], filter: string | undefined): EnrichedTool[] {
  const base = tools.map((tool) => ({
    tool,
    schemaSummary: summarizeSchema(tool.inputSchema),
    usageExample: buildUsageExample(target, tool.name, tool.inputSchema),
    fuzzyScore: 1,
  }));

  if (!filter || filter.trim().length === 0) {
    return base.sort((a, b) => a.tool.name.localeCompare(b.tool.name));
  }

  const ranked = fuzzyRank(base, filter, (entry) => `${entry.tool.name} ${entry.tool.description ?? ""}`);
  return ranked.map(({ item, score }) => ({ ...item, fuzzyScore: score }));
}

function printIdentityBlock(
  client: Awaited<ReturnType<typeof createMcpClient>>,
  target: string,
): void {
  const server = client.getServerVersion();
  const capabilities = client.getServerCapabilities();

  const identityContent = [
    `${palette.bold("Server:")}  ${chalk.white(server?.name ?? target)} ${palette.dim(
      `(v${server?.version ?? "unknown"})`,
    )}`,
    `${palette.bold("Protocol:")} ${chalk.white(getProtocolVersion(client))}`,
    `${palette.bold("Capabilities:")} ${chalk.white(summarizeCapabilities(capabilities))}`,
  ].join("\n");

  console.log(brandBox(identityContent, "Identity"));
}

function printSchemaBlocks(tools: EnrichedTool[]): void {
  if (tools.length === 0) return;

  console.log(sectionHeader("Tool Schemas"));
  for (const entry of tools) {
    console.log(`\n${chalk.white(entry.tool.name)} ${palette.dim(entry.schemaSummary)}`);
    console.log(palette.dim(`Usage: ${entry.usageExample}`));
    console.log(prettyJson(entry.tool.inputSchema));
  }
}

export const inspectCommand = new Command("inspect")
  .description("Deep-dive into a server's tools, resources, and prompts")
  .argument("<aliasOrUrl>", "Server alias or URL")
  .option("--filter <query>", "Fuzzy-search tools by name/description")
  .option("--verbose", "Print full inputSchema JSON for all matched tools")
  .action(
    async (
      aliasOrUrl: string,
      options: { filter: string | undefined; verbose: boolean | undefined },
    ) => {
      let client: Awaited<ReturnType<typeof createMcpClient>> | undefined;
      let spinner: ReturnType<typeof brandSpinner> | undefined;
      let connected = false;

      async function cleanup(): Promise<void> {
        spinner?.stop();
        if (client) {
          await Promise.race([
            client.close().catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, 3000)),
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
        spinner = brandSpinner(`Connecting to ${chalk.cyan(aliasOrUrl)}...`).start();
        if (isHttpUrl(aliasOrUrl)) {
          client = await createMcpClient({
            serverConfig: { type: "http", url: aliasOrUrl, headers: {} },
          });
        } else {
          client = await createMcpClient({ alias: aliasOrUrl });
        }
        connected = true;

        spinner.text = "Discovering capabilities...";
        const capabilities = client.getServerCapabilities();

        const tools = capabilities?.tools ? await listAllTools(client) : [];
        const resources = capabilities?.resources ? await listAllResources(client) : [];
        const resourceTemplates = capabilities?.resources
          ? await listAllResourceTemplates(client)
          : [];
        const prompts = capabilities?.prompts ? await listAllPrompts(client) : [];

        const enrichedTools = enrichTools(aliasOrUrl, tools, options.filter);
        const showFullSchemas = options.verbose === true || enrichedTools.length === 1;

        spinner.succeed(`Inspected ${chalk.cyan(aliasOrUrl)}`);

        printIdentityBlock(client, aliasOrUrl);

        const filterLabel = options.filter ? options.filter : "(none)";
        console.log(sectionHeader("Overview"));
        console.log(
          `${palette.bold("Target:")} ${chalk.white(aliasOrUrl)}  ${palette.bold("Filter:")} ${palette.warning(filterLabel)}`,
        );
        console.log(
          bullet(
            `${palette.primary("Tools:")} ${tools.length}    ${palette.success("Resources:")} ${resources.length}    ${palette.success("Templates:")} ${resourceTemplates.length}    ${palette.accent("Prompts:")} ${prompts.length}`,
          ),
        );

        if (options.filter) {
          if (enrichedTools.length === 0) {
            console.log(palette.warning("\nNo tools matched the filter."));
          } else {
            console.log(sectionHeader(`Filtered Tools (${enrichedTools.length})`));
            console.log(
              renderToolsTable(
                enrichedTools.map((entry) => ({
                  name: `${entry.tool.name} ${chalk.dim(`[${entry.fuzzyScore.toFixed(2)}]`)}`,
                  description: entry.tool.description ?? "",
                  schemaSummary: entry.schemaSummary,
                  usageExample: entry.usageExample,
                })),
              ),
            );
          }
        } else {
          console.log(
            renderCapabilityTree({
              tools,
              resources,
              resourceTemplates,
              prompts,
            }),
          );
        }

        if (showFullSchemas) {
          printSchemaBlocks(enrichedTools);
        } else {
          console.log(
            palette.dim(
              "\nTip: use --verbose (or narrow --filter to one tool) to print full input schemas.",
            ),
          );
        }

        await cleanup();
      } catch (error) {
        await cleanup();
        die(error, connected ? 3 : 2);
      } finally {
        process.removeListener("SIGINT", onSigint);
      }
    },
  );
