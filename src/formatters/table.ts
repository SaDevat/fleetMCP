import Table from "cli-table3";
import chalk from "chalk";

export interface ToolTableRow {
  name: string;
  description: string;
  schemaSummary: string;
  usageExample: string;
}

/**
 * Renders a table of tools. Used by `inspect` with --filter flag.
 */
export function renderToolsTable(tools: ToolTableRow[]): string {
  const table = new Table({
    head: [
      chalk.cyan("Tool"),
      chalk.cyan("Description"),
      chalk.cyan("Args"),
      chalk.cyan("Usage Example"),
    ],
    style: { head: [] },
    colWidths: [24, 36, 40, 54],
    wordWrap: true,
  });

  for (const tool of tools) {
    table.push([
      chalk.white(tool.name),
      chalk.dim(tool.description),
      chalk.yellow(tool.schemaSummary),
      chalk.green(tool.usageExample),
    ]);
  }

  return table.toString();
}
