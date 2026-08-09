#!/usr/bin/env bun
import { Command } from "commander";
import { configCommand } from "./cli/config.ts";
import { inspectCommand } from "./cli/inspect.ts";
import { callCommand } from "./cli/call.ts";
import { testCommand } from "./cli/test.ts";
import { proxyCommand } from "./cli/proxy.ts";
import { renderBrandHeader, palette } from "./utils/brand.ts";
import packageJson from "../package.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Root Program
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("mcpx")
  .description("The missing CLI for the MCP ecosystem")
  .version(packageJson.version, "-v, --version", "Output the current version");

// Add branded header before help output
program.addHelpText("beforeAll", renderBrandHeader(packageJson.version));

// Customize help formatting
program.configureHelp({
  subcommandTerm: (cmd) => palette.primary(cmd.name() + " " + cmd.usage()),
  optionTerm: (option) => palette.primary(option.flags),
});

// Add footer with documentation link
program.addHelpText(
  "after",
  `\n${palette.dim("  Documentation: https://github.com/sdevat/mcpx")}\n`,
);

// ---------------------------------------------------------------------------
// Register Commands
// ---------------------------------------------------------------------------

program.addCommand(configCommand);
program.addCommand(inspectCommand);
program.addCommand(callCommand);
program.addCommand(testCommand);
program.addCommand(proxyCommand);

// ---------------------------------------------------------------------------
// Parse — must be last
// ---------------------------------------------------------------------------

program.parse(Bun.argv);
