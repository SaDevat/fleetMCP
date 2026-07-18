import chalk from "chalk";
import { ZodError } from "zod";
import { brandBox, palette, statusDot } from "./brand.ts";

/**
 * Formats any error for CLI output and exits with the given code.
 * Handles ZodError specially to show field-level validation failures.
 *
 * Exit codes:
 *   1 = usage/config error
 *   2 = server connection error
 *   3 = tool execution error
 *   4 = test failure (CI mode)
 */
export function die(error: unknown, exitCode = 1, customSuggestions?: string[]): never {
  let message: string;
  let suggestions: string[] = customSuggestions ?? [];

  if (error instanceof ZodError) {
    message = "Configuration Error";
    for (const issue of error.issues) {
      suggestions.push(`${issue.path.join(".")} — ${issue.message}`);
    }
  } else if (error instanceof Error) {
    message = error.message;

    // Contextual suggestions based on error patterns
    if (error.message.includes("not found in ~/.mcpx/config.yml")) {
      suggestions.push("Run `mcpx config list` to see registered servers.");
      const alias = error.message.match(/"([^"]+)"/)?.[1];
      if (alias) {
        suggestions.push(`Run \`mcpx config add ${alias}\` to add it.`);
      }
    }

    if (
      error.message.includes("Connection closed") ||
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("connect ECONNREFUSED")
    ) {
      suggestions.push("Is the server running? Check the command and arguments.");
      suggestions.push("Run `mcpx test <alias>` for a full diagnostic.");
    }

    if (error.message.includes("E404") || error.message.includes("Not found")) {
      suggestions.push("The npm package may not exist. Verify the package name.");
      suggestions.push("Try: npm view <package-name>");
    }

    if (error.message.includes("ENOENT") || error.message.includes("command not found")) {
      suggestions.push("The command binary may not be installed or not in PATH.");
      suggestions.push("Check `mcpx config list` for a status indicator.");
    }
  } else {
    message = "An unknown error occurred.";
  }

  // Render
  const errorBody = [
    `${statusDot.error} ${palette.error(message)}`,
    ...suggestions.map((s) => palette.dim(`  → ${s}`)),
  ].join("\n");

  console.error(brandBox(errorBody, "Error"));
  process.exit(exitCode);
}
