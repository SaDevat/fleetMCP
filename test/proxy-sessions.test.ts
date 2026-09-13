import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { REPO, testHome, fleetmcp, startProxy, type RunningProxy } from "./helpers.ts";

// Regression check for #2 — proxy sessions were never removed from the session
// map, so it grew for the lifetime of the process. The map is closure-local,
// but GET / reports its size, which is enough to assert on.

let env: Record<string, string>;
let proxy: RunningProxy;

async function sessionCount(): Promise<number> {
  const res = await fetch(`${proxy.base}/`);
  const body = (await res.json()) as { sessions: number };
  return body.sessions;
}

/** Completes an MCP initialize handshake, returns the assigned session id. */
async function openSession(): Promise<string> {
  const res = await fetch(`${proxy.base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "session-leak-check", version: "0" },
      },
    }),
  });

  const id = res.headers.get("mcp-session-id");
  if (!id) throw new Error(`no session id; status ${res.status}`);
  return id;
}

async function closeSession(id: string): Promise<Response> {
  return fetch(`${proxy.base}/mcp`, {
    method: "DELETE",
    headers: { "mcp-session-id": id, "mcp-protocol-version": "2025-06-18" },
  });
}

describe("proxy session reaping", () => {
  beforeAll(async () => {
    env = testHome();
    // The proxy refuses to start with zero servers configured; this test
    // only needs the process up, not this particular server's tools.
    await fleetmcp({ env }, "config", "add", "dummy", "-t", "stdio", "-c", "bun",
                   "-a", join(REPO, "test/echo-server.ts"));
    proxy = await startProxy(env);
  }, 60_000);

  afterAll(() => {
    proxy.stop();
  });

  test("starts with no sessions", async () => {
    expect(await sessionCount()).toBe(0);
  });

  test("N sessions open, N register, all close, map returns to empty", async () => {
    const ids = await Promise.all([openSession(), openSession(), openSession()]);
    expect(new Set(ids).size).toBe(3); // distinct ids
    expect(await sessionCount()).toBe(3);

    for (const id of ids) {
      const res = await closeSession(id);
      expect(res.ok).toBe(true);
    }

    // Before the fix this stayed at 3 — nothing ever removed the entry.
    expect(await sessionCount()).toBe(0);
  });
});
