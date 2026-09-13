import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { testHome, fleetmcp, startProxy, type RunningProxy } from "./helpers.ts";

const ALIAS = "servers-probe";

let env: Record<string, string>;
let proxy: RunningProxy;

beforeAll(async () => {
  env = testHome();

  // Seed one real, connectable stdio server before the proxy starts.
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

describe("GET /api/servers", () => {
  test("returns the seeded server with health and connection state", async () => {
    const res = await fetch(`${proxy.base}/api/servers`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { servers: { alias: string; type: string; health: string; connected: boolean }[] };
    const seeded = body.servers.find((s) => s.alias === ALIAS);
    expect(seeded).toBeDefined();
    expect(seeded?.type).toBe("stdio");
    expect(seeded?.health).toBe("ok"); // `bun` is on PATH wherever this suite runs
    expect(seeded?.connected).toBe(true); // the proxy warms every configured server on boot
  });
});

describe("POST /api/servers", () => {
  test("adds a server, persists it, and pins a relative arg to an absolute path", async () => {
    const res = await fetch(`${proxy.base}/api/servers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        alias: "added-server",
        type: "stdio",
        command: "bun",
        args: ["test/echo-server.ts"],
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { args?: string[] };
    expect(created.args?.[0]).toEndWith("test/echo-server.ts");
    expect(created.args?.[0]?.startsWith("/")).toBe(true);

    const list = (await (await fetch(`${proxy.base}/api/servers`)).json()) as { servers: { alias: string }[] };
    expect(list.servers.some((s) => s.alias === "added-server")).toBe(true);
  });

  test("duplicate alias is rejected with a 409 envelope", async () => {
    const res = await fetch(`${proxy.base}/api/servers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: ALIAS, type: "http", url: "https://example.com/mcp" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("bad_request");
  });
});

describe("PATCH /api/servers/:alias", () => {
  test("unknown alias returns a 404 envelope", async () => {
    const res = await fetch(`${proxy.base}/api/servers/does-not-exist`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "http", url: "https://example.com/mcp" }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  test("edits an existing server", async () => {
    const res = await fetch(`${proxy.base}/api/servers/added-server`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "http", url: "https://example.com/mcp" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; url?: string };
    expect(body.type).toBe("http");
    expect(body.url).toBe("https://example.com/mcp");
  });
});

describe("DELETE /api/servers/:alias", () => {
  test("removes the server", async () => {
    const res = await fetch(`${proxy.base}/api/servers/added-server`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const list = (await (await fetch(`${proxy.base}/api/servers`)).json()) as { servers: { alias: string }[] };
    expect(list.servers.some((s) => s.alias === "added-server")).toBe(false);
  });

  test("unknown alias returns a 404 envelope", async () => {
    const res = await fetch(`${proxy.base}/api/servers/does-not-exist`, { method: "DELETE" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });
});

describe("GET /api/servers/export", () => {
  test("returns the Claude Desktop mcpServers shape", async () => {
    const res = await fetch(`${proxy.base}/api/servers/export?target=claude`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mcpServers: Record<string, { command?: string }> };
    expect(body.mcpServers[ALIAS]?.command).toBe("bun");
  });

  test("bad target is rejected with a 400 envelope", async () => {
    const res = await fetch(`${proxy.base}/api/servers/export?target=nonsense`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("bad_request");
  });
});
