import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLogDb } from "../src/cli/proxy";

/**
 * Traffic (#27) reads newest-first and filters by server or failure state.
 * Without indexes SQLite answers those with a full SCAN plus a temp B-tree
 * sort. These assertions fail if the indexes in openLogDb() are removed.
 */
const db = openLogDb(join(mkdtempSync(join(tmpdir(), "fleetmcp-idx-")), "logs.db"));

for (let i = 0; i < 50; i++) {
  db.run(
    `INSERT INTO proxy_logs (id, timestamp, alias, toolName, request, response, durationMs, isError, requestTokens, responseTokens)
     VALUES (?, ?, ?, ?, '{}', '{}', 10, ?, 0, 0)`,
    [`id-${i}`, new Date(Date.now() + i).toISOString(), i % 2 ? "fs" : "github", "t", i % 5 === 0 ? 1 : 0],
  );
}

const plan = (sql: string): string =>
  db
    .query(`EXPLAIN QUERY PLAN ${sql}`)
    .all()
    .map((r) => (r as { detail: string }).detail)
    .join(" | ");

test("per-server traffic uses the alias index and needs no sort", () => {
  const p = plan("SELECT id FROM proxy_logs WHERE alias='fs' ORDER BY rowid DESC LIMIT 100");
  expect(p).toContain("idx_proxy_logs_alias");
  expect(p).not.toContain("TEMP B-TREE");
});

test("failures-only traffic uses the isError index and needs no sort", () => {
  const p = plan("SELECT id FROM proxy_logs WHERE isError=1 ORDER BY rowid DESC LIMIT 100");
  expect(p).toContain("idx_proxy_logs_is_error");
  expect(p).not.toContain("TEMP B-TREE");
});

test("cursor paging seeks the rowid tree instead of scanning", () => {
  const p = plan("SELECT id FROM proxy_logs WHERE rowid < 40 ORDER BY rowid DESC LIMIT 100");
  expect(p).toContain("SEARCH");
  expect(p).not.toContain("TEMP B-TREE");
});

test("row detail seeks by primary key", () => {
  expect(plan("SELECT * FROM proxy_logs WHERE id='id-1'")).toContain("SEARCH");
});
