#!/usr/bin/env bun
import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Root Program
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("mcpx")
  .description("The missing CLI for the MCP ecosystem")
  .version(packageJson.version, "-v, --version", "Output the current version");

// ---------------------------------------------------------------------------
// Parse — must be last
// ---------------------------------------------------------------------------

program.parse(Bun.argv);
