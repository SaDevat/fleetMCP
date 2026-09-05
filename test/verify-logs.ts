#!/usr/bin/env bun
/**
 * verify-logs.ts — Quick sanity check for the fleetmcp proxy SQLite log store.
 *
 * Usage:
 *   bun test/verify-logs.ts [--alias <alias>] [--limit <n>]
 *
 * Reads ~/.fleetmcp/logs.db and prints the most recent proxy log entries in a
 * human-readable table. Exits 1 if the database does not exist or the
 * proxy_logs table is missing.
 */

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import Table from "cli-table3";
import chalk from "chalk";

const DB_PATH = join(homedir(), ".fleetmcp", "logs.db");

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------

const args = Bun.argv.slice(2);
let aliasFilter: string | undefined;
let limit = 20;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--alias" && args[i + 1]) {
    aliasFilter = args[++i];
  } else if (args[i] === "--limit" && args[i + 1]) {
    limit = parseInt(args[++i] ?? "20", 10);
  }
}

// ---------------------------------------------------------------------------
// Open DB
// ---------------------------------------------------------------------------

const dbFile = Bun.file(DB_PATH);
if (!(await dbFile.exists())) {
  console.error(chalk.red(`Database not found: ${DB_PATH}`));
  console.error(chalk.yellow("Have you run `fleetmcp proxy <alias>` at least once?"));
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

// Verify table exists
const tableCheck = db
  .query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='proxy_logs'",
  )
  .get();

if (!tableCheck) {
  console.error(chalk.red("Table 'proxy_logs' not found in logs.db."));
  db.close();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

type LogRow = {
  id: string;
  timestamp: string;
  alias: string;
  tool_name: string;
  duration_ms: number;
  is_error: number;
};

const whereClause = aliasFilter ? "WHERE alias = ?" : "";
const params: string[] = aliasFilter ? [aliasFilter] : [];

const rows = db
  .query<LogRow, string[]>(
    `SELECT id, timestamp, alias, tool_name, duration_ms, is_error
     FROM proxy_logs
     ${whereClause}
     ORDER BY timestamp DESC
     LIMIT ${limit}`,
  )
  .all(...params);

db.close();

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

if (rows.length === 0) {
  console.log(chalk.yellow("No log entries found."));
  process.exit(0);
}

const table = new Table({
  head: [
    chalk.cyan("Timestamp"),
    chalk.cyan("Alias"),
    chalk.cyan("Tool"),
    chalk.cyan("Duration"),
    chalk.cyan("Status"),
  ],
  style: { head: [] },
  colWidths: [26, 14, 24, 12, 10],
  wordWrap: true,
});

for (const row of rows) {
  table.push([
    chalk.dim(row.timestamp),
    chalk.white(row.alias),
    chalk.white(row.tool_name),
    chalk.dim(`${row.duration_ms}ms`),
    row.is_error ? chalk.red("ERROR") : chalk.green("OK"),
  ]);
}

console.log(table.toString());
console.log(chalk.dim(`\n${rows.length} log entry(ies) shown from ${DB_PATH}`));
