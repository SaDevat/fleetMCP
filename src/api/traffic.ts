import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { ProxyRuntime } from "./types.ts";
import { apiError } from "./error.ts";
import { logBus } from "../core/log-bus.ts";

/**
 * Routes for the traffic screen. Owned by its screen's branch -- no other module
 * should need editing to add endpoints here.
 *
 * proxy_logs records tool calls only -- resources/prompts are not logged
 * (#32). Nothing here should imply otherwise.
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

interface TrafficRow {
  seq: number;
  id: string;
  timestamp: string;
  alias: string;
  toolName: string;
  durationMs: number;
  isError: boolean;
  requestTokens: number;
  responseTokens: number;
}

interface RawRow extends Omit<TrafficRow, "isError"> {
  isError: number;
}

interface TrafficStats {
  p50: number | null;
  p95: number | null;
  failures: number;
  total: number;
  dbBytes: number;
}

function buildFilterClauses(alias: string | null, failures: boolean): { clauses: string[]; params: SQLQueryBindings[] } {
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (alias) {
    clauses.push("alias = ?");
    params.push(alias);
  }
  if (failures) {
    clauses.push("isError = 1");
  }
  return { clauses, params };
}

function toWhere(clauses: string[]): string {
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

function percentile(sortedDurations: number[], q: number): number | null {
  if (sortedDurations.length === 0) return null;
  const idx = Math.min(sortedDurations.length - 1, Math.floor(sortedDurations.length * q));
  return sortedDurations[idx] ?? null;
}

/** Stats over the alias/failures filter only -- pagination cursors don't narrow the totals. */
function computeStats(db: Database, clauses: string[], params: SQLQueryBindings[]): TrafficStats {
  const durRows = db
    .query(`SELECT durationMs, isError FROM proxy_logs ${toWhere(clauses)}`)
    .all(...params) as { durationMs: number; isError: number }[];

  const durations = durRows.map((r) => r.durationMs).sort((a, b) => a - b);
  const failures = durRows.filter((r) => r.isError === 1).length;

  const pageCount = (db.query("PRAGMA page_count").get() as { page_count: number }).page_count;
  const pageSize = (db.query("PRAGMA page_size").get() as { page_size: number }).page_size;

  return {
    p50: percentile(durations, 0.5),
    p95: percentile(durations, 0.95),
    failures,
    total: durRows.length,
    dbBytes: pageCount * pageSize,
  };
}

/** Parses a non-negative integer query param; returns undefined if absent, null if present-but-invalid. */
function parseIntParam(raw: string | null): number | undefined | null {
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

export function trafficRoutes(rt: ProxyRuntime): Record<string, unknown> {
  return {
    "/api/traffic": {
      GET(req: Request) {
        if (!rt.db) return apiError(503, "upstream_unavailable", "log database unavailable");

        const url = new URL(req.url);
        const alias = url.searchParams.get("alias");
        const failures = url.searchParams.get("failures") === "true";

        const limitParam = parseIntParam(url.searchParams.get("limit"));
        if (limitParam === null) return apiError(400, "bad_request", "limit must be an integer");
        const limit = limitParam ?? DEFAULT_LIMIT;
        if (limit < 1 || limit > MAX_LIMIT) {
          return apiError(400, "bad_request", `limit must be between 1 and ${MAX_LIMIT}`);
        }

        const before = parseIntParam(url.searchParams.get("before"));
        if (before === null) return apiError(400, "bad_request", "before must be an integer seq");
        const after = parseIntParam(url.searchParams.get("after"));
        if (after === null) return apiError(400, "bad_request", "after must be an integer seq");

        const { clauses: filterClauses, params: filterParams } = buildFilterClauses(alias, failures);

        const listClauses = [...filterClauses];
        const listParams = [...filterParams];
        if (before !== undefined) {
          listClauses.push("rowid < ?");
          listParams.push(before);
        }
        if (after !== undefined) {
          listClauses.push("rowid > ?");
          listParams.push(after);
        }

        const rows = rt.db
          .query(
            `SELECT rowid AS seq, id, timestamp, alias, toolName, durationMs, isError, requestTokens, responseTokens
             FROM proxy_logs ${toWhere(listClauses)}
             ORDER BY rowid DESC LIMIT ?`,
          )
          .all(...listParams, limit) as RawRow[];

        const stats = computeStats(rt.db, filterClauses, filterParams);

        return Response.json({
          rows: rows.map((r): TrafficRow => ({ ...r, isError: r.isError === 1 })),
          stats,
        });
      },
    },

    "/api/traffic/stream": {
      GET(_req: Request) {
        if (!rt.db) return apiError(503, "upstream_unavailable", "log database unavailable");

        let listener: ((entry: unknown) => void) | undefined;

        const stream = new ReadableStream({
          start(controller) {
            // So EventSource opens promptly instead of waiting on the first real entry.
            controller.enqueue(": connected\n\n");
            listener = (entry) => {
              controller.enqueue(`data: ${JSON.stringify(entry)}\n\n`);
            };
            logBus.on("entry", listener);
          },
          cancel() {
            // Bun calls this on client disconnect; without removing the listener here,
            // a leaked one accumulates per connected tab for the proxy's lifetime.
            if (listener) logBus.off("entry", listener);
          },
        });

        return new Response(stream, {
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        });
      },
    },

    "/api/traffic/:id": {
      GET(req: Request & { params: { id: string } }) {
        if (!rt.db) return apiError(503, "upstream_unavailable", "log database unavailable");

        const { id } = req.params;
        const row = rt.db
          .query(
            `SELECT rowid AS seq, id, timestamp, alias, toolName, request, response, durationMs, isError, requestTokens, responseTokens
             FROM proxy_logs WHERE id = ?`,
          )
          .get(id) as (RawRow & { request: string; response: string }) | null;

        if (!row) return apiError(404, "not_found", `no traffic entry ${id}`);

        // Payloads are always written as JSON.stringify'd values by logEntry(), but
        // never crash the detail view over a row written by some future format.
        let request: unknown;
        try {
          request = JSON.parse(row.request);
        } catch {
          request = row.request;
        }
        let response: unknown;
        try {
          response = JSON.parse(row.response);
        } catch {
          response = row.response;
        }

        return Response.json({
          seq: row.seq,
          id: row.id,
          timestamp: row.timestamp,
          alias: row.alias,
          toolName: row.toolName,
          durationMs: row.durationMs,
          isError: row.isError === 1,
          requestTokens: row.requestTokens,
          responseTokens: row.responseTokens,
          request,
          response,
        });
      },
    },
  };
}
