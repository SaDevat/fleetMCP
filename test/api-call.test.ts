import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { openLogDb } from "../src/cli/proxy.ts";
import { testHome, fleetmcp, startProxy, type RunningProxy } from "./helpers.ts";

const ALIAS = "call-probe";

let env: Record<string, string>;
let proxy: RunningProxy;

beforeAll(async () => {
  env = testHome();

  await fleetmcp(
    { env },
    "config", "add", ALIAS,
    "-t", "stdio", "-c", "bun", "-a", join(process.cwd(), "test/echo-server.ts"),
  );

  proxy = await startProxy(env);
}, 60_000);

afterAll(() => {
  proxy?.stop();
});

describe("GET /api/servers/:alias/tools", () => {
  test("returns the echo tool with its schema and namespaced name", async () => {
    const res = await fetch(`${proxy.base}/api/servers/${ALIAS}/tools`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tools: { name: string; inputSchema: unknown; namespaced: string }[] };
    const echo = body.tools.find((t) => t.name === "echo");
    expect(echo).toBeDefined();
    expect(echo?.namespaced).toBe(`${ALIAS}_echo`);
    expect(echo?.inputSchema).toBeTruthy();
  });

  test("unknown alias returns a 404 envelope", async () => {
    const res = await fetch(`${proxy.base}/api/servers/does-not-exist/tools`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });
});

describe("POST /api/call", () => {
  test("a real call returns content and logs a row in proxy_logs", async () => {
    const dbPath = join(env["FLEETMCP_HOME"] ?? "", "logs.db");
    const db = openLogDb(dbPath);
    const before = (db.query("SELECT COUNT(*) as n FROM proxy_logs WHERE alias = ? AND toolName = 'echo'").get(ALIAS) as { n: number }).n;

    const res = await fetch(`${proxy.base}/api/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: ALIAS, tool: "echo", arguments: { text: "hi" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: { type: string; text: string }[] };
    expect(Array.isArray(body.content)).toBe(true);
    expect(body.content[0]?.text).toContain("hi");

    const after = (db.query("SELECT COUNT(*) as n FROM proxy_logs WHERE alias = ? AND toolName = 'echo'").get(ALIAS) as { n: number }).n;
    expect(after).toBe(before + 1);

    const row = db
      .query("SELECT toolName, isError FROM proxy_logs WHERE alias = ? AND toolName = 'echo' ORDER BY rowid DESC LIMIT 1")
      .get(ALIAS) as { toolName: string; isError: number };
    expect(row.toolName).toBe("echo");
    expect(row.isError).toBe(0);
    db.close();
  });

  test("unknown alias returns a 404 envelope", async () => {
    const res = await fetch(`${proxy.base}/api/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "does-not-exist", tool: "echo", arguments: {} }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  test("unknown tool returns a 404 envelope", async () => {
    const res = await fetch(`${proxy.base}/api/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: ALIAS, tool: "does-not-exist", arguments: {} }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  test("arguments failing the tool's schema return a 400 envelope", async () => {
    const res = await fetch(`${proxy.base}/api/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: ALIAS, tool: "echo", arguments: { text: 123 } }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("bad_request");
  });
});
