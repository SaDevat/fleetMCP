import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { testHome, fleetmcp, startProxy, type RunningProxy } from "./helpers.ts";

const ALIAS = "test-probe";

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

describe("GET /api/test/checks", () => {
  test("lists the five checks before any run", async () => {
    const res = await fetch(`${proxy.base}/api/test/checks`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; description: string }[];
    expect(body.length).toBe(5);
    for (const check of body) {
      expect(typeof check.name).toBe("string");
      expect(typeof check.description).toBe("string");
    }
  });
});

describe("POST /api/test/:alias", () => {
  test(
    "runs the five checks against a configured server",
    async () => {
      const res = await fetch(`${proxy.base}/api/test/${ALIAS}`, { method: "POST" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        alias: string;
        passed: boolean;
        checks: { name: string; passed: boolean; durationMs: number }[];
        totalDurationMs: number;
      };
      expect(body.alias).toBe(ALIAS);
      expect(body.checks.length).toBe(5);
      for (const check of body.checks) {
        expect(typeof check.name).toBe("string");
        expect(typeof check.passed).toBe("boolean");
        expect(typeof check.durationMs).toBe("number");
      }
      expect(typeof body.totalDurationMs).toBe("number");
    },
    60_000,
  );

  test("unknown alias returns a 404 envelope", async () => {
    const res = await fetch(`${proxy.base}/api/test/does-not-exist`, { method: "POST" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });
});
