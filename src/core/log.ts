import { Database } from "bun:sqlite";
import { join } from "node:path";
import { homedir } from "node:os";
import { logBus } from "./log-bus.ts";

/**
 * The proxy log: where it lives, and the one function that writes to it.
 *
 * This is its own module because both the proxy's own callTool handler and the
 * UI's POST /api/call need to write here, and `src/cli/proxy.ts` already imports
 * the api routes -- so the api layer importing back would be a cycle. Two copies
 * of a write path drift, and a drift here means Traffic quietly disagrees with
 * itself about what happened.
 */

export function estimateTokens(payload: unknown): number {
  const json = typeof payload === "string" ? payload : JSON.stringify(payload);
  return Math.ceil(json.length / 4);
}

export function openLogDb(
  dbPath = join(process.env["FLEETMCP_HOME"] ?? join(homedir(), ".fleetmcp"), "logs.db"),
): Database {
  const db = new Database(dbPath);

  // Create table with token columns (migration-safe: IF NOT EXISTS)
  db.run(`
    CREATE TABLE IF NOT EXISTS proxy_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      alias TEXT NOT NULL,
      toolName TEXT NOT NULL,
      request TEXT NOT NULL,
      response TEXT NOT NULL,
      durationMs INTEGER NOT NULL,
      isError INTEGER NOT NULL,
      requestTokens INTEGER NOT NULL DEFAULT 0,
      responseTokens INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Add token columns to existing tables (graceful migration)
  try {
    db.run(`ALTER TABLE proxy_logs ADD COLUMN requestTokens INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists
  }
  try {
    db.run(`ALTER TABLE proxy_logs ADD COLUMN responseTokens INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists
  }

  // Traffic reads newest-first and filters by server or failure. SQLite appends
  // rowid to every index entry, so these also satisfy ORDER BY rowid DESC with
  // no temp B-tree. Unfiltered paging needs no index: it walks the rowid tree.
  db.run(`CREATE INDEX IF NOT EXISTS idx_proxy_logs_alias ON proxy_logs(alias)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_proxy_logs_is_error ON proxy_logs(isError)`);

  return db;
}

export function logEntry(
  db: Database,
  alias: string,
  toolName: string,
  request: unknown,
  response: unknown,
  durationMs: number,
  isError: boolean,
  requestTokens: number,
  responseTokens: number,
): void {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const { lastInsertRowid } = db.run(
    `INSERT INTO proxy_logs (id, timestamp, alias, toolName, request, response, durationMs, isError, requestTokens, responseTokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      timestamp,
      alias,
      toolName,
      JSON.stringify(request),
      JSON.stringify(response),
      durationMs,
      isError ? 1 : 0,
      requestTokens,
      responseTokens,
    ],
  );

  // Traffic's SSE stream subscribes here. Emitting rather than driving a stream
  // directly keeps the logging path unaware of who is listening. `seq` matches
  // rowid so streamed rows can be merged with the paginated list by the same key.
  logBus.emit("entry", {
    seq: Number(lastInsertRowid),
    id,
    timestamp,
    alias,
    toolName,
    durationMs,
    isError,
    requestTokens,
    responseTokens,
  });
}
