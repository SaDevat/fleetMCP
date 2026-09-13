import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { REPO, testHome, fleetmcp, startProxy, type RunningProxy } from "./helpers.ts";

// #9 — prompts were invisible through the proxy. They namespace like tools
// (`<alias>_<name>`), so this is the simple half of #5.

const PROXY_ALIAS = "prompts-probe";

let env: Record<string, string>;
let proxy: RunningProxy;

describe("proxy forwards prompts", () => {
  beforeAll(async () => {
    env = testHome();
    await fleetmcp({ env }, "config", "add", "dummy", "-t", "stdio", "-c", "bun",
                   "-a", join(REPO, "test/echo-server.ts"));

    proxy = await startProxy(env);

    await fleetmcp({ env }, "config", "add", PROXY_ALIAS, "-t", "http",
                   "-u", `${proxy.base}/mcp`);
  }, 60_000);

  afterAll(() => {
    proxy.stop();
  });

  test("prompts appear through the proxy, namespaced by alias", async () => {
    // Before this change the proxy declared no prompts capability at all,
    // so inspect reported zero.
    const res = await fleetmcp({ env }, "inspect", PROXY_ALIAS);
    expect(res.exitCode).toBe(0);
    expect(res.stdout + res.stderr).toContain("dummy_greet");
  }, 30_000);
});
