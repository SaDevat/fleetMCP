import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { REPO, testHome, fleetmcp as runFleetmcp, startProxy, type RunningProxy } from "./helpers.ts";

let env: Record<string, string>;

/** Thin wrapper matching this file's original call shape: args in, stdout out. */
async function fleetmcp(...args: string[]): Promise<string> {
  const { stdout, stderr, exitCode } = await runFleetmcp({ env }, ...args);
  if (exitCode !== 0) {
    throw new Error(`fleetmcp exited with code ${exitCode}\nstderr: ${stderr}`);
  }
  return stdout;
}

beforeAll(() => {
  env = testHome();
});

describe("fleetmcp config", () => {
  beforeAll(async () => {
    await fleetmcp("config", "add", "dummy", "-t", "stdio", "-c", "bun", "-a", join(REPO, "test/echo-server.ts"));
  });

  test("config list shows table", async () => {
    const out = await fleetmcp("config", "list");
    expect(out).toContain("Alias");
    expect(out).toContain("dummy");
  });

  test("config add + remove roundtrip", async () => {
    await fleetmcp("config", "add", "test-temp", "-t", "stdio", "-c", "echo", "-a", "hello");
    const list = await fleetmcp("config", "list");
    expect(list).toContain("test-temp");

    await fleetmcp("config", "remove", "test-temp");
    const list2 = await fleetmcp("config", "list");
    expect(list2).not.toContain("test-temp");
  });

  test("config check validates env vars", async () => {
    const out = await fleetmcp("config", "check");
    expect(out).toContain("dummy");
    expect(out).toMatch(/✓|✗/);
  });
});

describe("fleetmcp inspect", () => {
  test("inspect shows echo tool", async () => {
    const out = await fleetmcp("inspect", "dummy");
    expect(out).toContain("echo");
    expect(out).toContain("echo-test-server");
  });

  test("inspect with --filter narrows results", async () => {
    const out = await fleetmcp("inspect", "dummy", "--filter", "echo");
    expect(out).toContain("echo");
  });

  test("inspect bad alias exits with code 2", async () => {
    const { exitCode } = await runFleetmcp({ env }, "inspect", "nonexistent");
    expect(exitCode).toBe(2);
  });
});

describe("fleetmcp call", () => {
  test("call echo with key=value args", async () => {
    const out = await fleetmcp("call", "dummy", "echo", "text=hello");
    expect(out).toContain("hello");
  });

  test("call echo with JSON arg", async () => {
    const out = await fleetmcp("call", "dummy", "echo", '{"text":"world"}');
    expect(out).toContain("world");
  });

  test("call with multiple args", async () => {
    const out = await fleetmcp("call", "dummy", "echo", "text=test", "data=value");
    expect(out).toContain("test");
    expect(out).toContain("value");
  });
});

describe("fleetmcp test", () => {
  test("test passes all checks", async () => {
    const out = await fleetmcp("test", "dummy");
    expect(out).toContain("All checks passed");
    expect(out).toContain("Connection handshake");
    expect(out).toContain("PASS");
  });

  test("test --ci exits 0 on pass", async () => {
    const { exitCode } = await runFleetmcp({ env }, "test", "dummy", "--ci");
    expect(exitCode).toBe(0);
  });

  test("test nonexistent alias fails", async () => {
    const { exitCode } = await runFleetmcp({ env }, "test", "nonexistent");
    // Config/connection errors exit with code 1 or 2
    expect(exitCode).toBeGreaterThan(0);
  });
});

describe("fleetmcp proxy", () => {
  let proxy: RunningProxy;

  afterAll(() => {
    proxy?.stop();
  });

  test("proxy starts and responds to health check", async () => {
    proxy = await startProxy(env);

    const health = await fetch(`${proxy.base}/`);
    expect(health.status).toBe(200);

    const data = (await health.json()) as Record<string, unknown>;
    expect(data["name"]).toBe("fleetmcp-proxy");
    expect(data["tools"]).toBeGreaterThan(0);
  });
});
