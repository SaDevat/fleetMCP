import chalk from "chalk";
import type {
  Tool,
  Resource,
  Prompt,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";

function highlightTemplateVariables(template: string): string {
  return template.replace(/\{[^}]+\}/g, (match) => chalk.yellow(match));
}

/**
 * Renders the capability tree for `mcpx inspect`.
 * Returns a string ready for console.log().
 */
export function renderCapabilityTree(data: {
  tools: Tool[];
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  prompts: Prompt[];
}): string {
  const lines: string[] = [];

  const renderSection = <T extends { name: string; description?: string | undefined }>(
    label: string,
    items: T[],
    color: (s: string) => string = chalk.cyan,
  ) => {
    lines.push(chalk.bold(color(`\n${label} (${items.length})`)));
    if (items.length === 0) {
      lines.push(chalk.dim("  (none)"));
      return;
    }
    for (const [i, item] of items.entries()) {
      const isLast = i === items.length - 1;
      const prefix = isLast ? "└── " : "├── ";
      lines.push(`${color(prefix)}${chalk.white(item.name)}`);
      if (item.description) {
        const contPrefix = isLast ? "    " : "│   ";
        lines.push(`${color(contPrefix)}${chalk.dim(item.description)}`);
      }
    }
  };

  renderSection("Tools", data.tools, chalk.cyan);
  renderSection("Resources", data.resources, chalk.green);
  
  // Resource Templates with special handling
  lines.push(chalk.bold.green(`\nResource Templates (${data.resourceTemplates.length})`));
  if (data.resourceTemplates.length === 0) {
    lines.push(chalk.dim("  (none)"));
  } else {
    for (const [i, template] of data.resourceTemplates.entries()) {
      const isLast = i === data.resourceTemplates.length - 1;
      const prefix = isLast ? "└── " : "├── ";
      lines.push(`${chalk.green(prefix)}${chalk.white(template.name)}`);
      const contPrefix = isLast ? "    " : "│   ";
      lines.push(
        `${chalk.green(contPrefix)}${chalk.cyan(
          highlightTemplateVariables(template.uriTemplate),
        )}`,
      );
      if (template.description) {
        lines.push(`${chalk.green(contPrefix)}${chalk.dim(template.description)}`);
      }
    }
  }
  
  renderSection("Prompts", data.prompts, chalk.magenta);

  return lines.join("\n");
}
