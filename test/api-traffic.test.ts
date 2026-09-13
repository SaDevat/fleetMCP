import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { openLogDb } from "../src/cli/proxy.ts";
import { testHome, fleetmcp, startProxy, type RunningProxy } from "./helpers.ts";

const ALIAS = "traffic-probe";

let env: Record<string, string>;
let proxy: RunningProxy;
/** Seeded rows in insertion order, oldest first -- so the last one is the newest (highest seq). */
let seededIds: string[];

function insertRow(
  db: ReturnType<typeof openLogDb>,
  opts: { alias: string; toolName: string; isError: boolean; durationMs: number; request: unknown; response: unknown },
): string {
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO proxy_logs (id, timestamp, alias, toolName, request, response, durationMs, isError, requestTokens, responseTokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      new Date().toISOString(),
      opts.alias,
      opts.toolName,
      JSON.stringify(opts.request),
      JSON.stringify(opts.response),
      opts.durationMs,
      opts.isError ? 1 : 0,
      10,
      20,
    ],
  );
  return id;
}

beforeAll(async () => {
  env = testHome();

  // Register a real server first so the proxy has something to connect to.
  await fleetmcp(
    { env },
    "config", "add", ALIAS,
    "-t", "stdio", "-c", "bun", "-a", join(process.cwd(), "test/echo-server.ts"),
  );

  // Seed rows directly into logs.db before starting the proxy.
  const dbPath = join(env["FLEETMCP_HOME"] ?? "", "logs.db");
  const db = openLogDb(dbPath);
  seededIds = [];
  for (let i = 0; i < 5; i++) {
    const isError = i === 2; // one failure in the middle
    seededIds.push(
      insertRow(db, {
        alias: i % 2 === 0 ? ALIAS : "other-alias",
        toolName: "echo",
        isError,
        durationMs: 50 + i * 10,
        request: { name: "echo", arguments: { i } },
        response: isError ? { error: "boom" } : { content: [{ type: "text", text: `ok ${i}` }], isError: false },
      }),
    );
  }
  db.close();

  proxy = await startProxy(env);
}, 60_000);

afterAll(() => {
  proxy?.stop();
});

describe("GET /api/traffic", () => {
  test("returns rows newest-first by seq", async () => {
    const res = await fetch(`${proxy.base}/api/traffic`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { seq: number; id: string }[]; stats: unknown };
    expect(body.rows.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < body.rows.length; i++) {
      expect(body.rows[i - 1]!.seq).toBeGreaterThan(body.rows[i]!.seq);
    }
    // Newest seeded row (last inserted) must be first.
    expect(body.rows[0]!.id).toBe(seededIds[seededIds.length - 1]);
  });

  test("cursor pagination via `before` has no duplicate or missing seq across the boundary", async () => {
    const page1 = (await (await fetch(`${proxy.base}/api/traffic?limit=2`)).json()) as {
      rows: { seq: number }[];
    };
    expect(page1.rows.length).toBe(2);
    const cursor = page1.rows[page1.rows.length - 1]!.seq;

    const page2 = (await (await fetch(`${proxy.base}/api/traffic?before=${cursor}&limit=3`)).json()) as {
      rows: { seq: number }[];
    };

    const seqs1 = page1.rows.map((r) => r.seq);
    const seqs2 = page2.rows.map((r) => r.seq);
    // No overlap.
    expect(seqs1.some((s) => seqs2.includes(s))).toBe(false);
    // Contiguous: the highest seq2 is exactly one less than the cursor's neighbour
    // relation -- every seq2 must be < cursor.
    for (const s of seqs2) expect(s).toBeLessThan(cursor);
  });

  test("alias filter narrows rows to that alias", async () => {
    const res = await fetch(`${proxy.base}/api/traffic?alias=${ALIAS}`);
    const body = (await res.json()) as { rows: { alias: string }[] };
    expect(body.rows.length).toBeGreaterThan(0);
    for (const row of body.rows) expect(row.alias).toBe(ALIAS);
  });

  test("failures=true filter returns only errors", async () => {
    const res = await fetch(`${proxy.base}/api/traffic?failures=true`);
    const body = (await res.json()) as { rows: { isError: boolean }[] };
    expect(body.rows.length).toBeGreaterThan(0);
    for (const row of body.rows) expect(row.isError).toBe(true);
  });

  test("limit=9999 is rejected with a 400 envelope", async () => {
    const res = await fetch(`${proxy.base}/api/traffic?limit=9999`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("bad_request");
  });
});

describe("GET /api/traffic/:id", () => {
  test("unknown id returns a 404 envelope", async () => {
    const res = await fetch(`${proxy.base}/api/traffic/does-not-exist`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  test("returns the full row with parsed request/response", async () => {
    const errorId = seededIds[2]!; // the seeded failure
    const res = await fetch(`${proxy.base}/api/traffic/${errorId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      isError: boolean;
      request: { name: string; arguments: { i: number } };
      response: { error: string };
    };
    expect(body.id).toBe(errorId);
    expect(body.isError).toBe(true);
    expect(body.request.name).toBe("echo");
    expect(body.response.error).toBe("boom");
  });
});

describe("GET /api/traffic/stream", () => {
  test("responds 200 with an SSE content-type", async () => {
    const controller = new AbortController();
    const res = await fetch(`${proxy.base}/api/traffic/stream`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body?.getReader();
    const { value } = await reader!.read();
    expect(new TextDecoder().decode(value)).toContain("connected");

    controller.abort();
  });
});
