import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";

// #9 — prompts were invisible through the proxy. They namespace like tools
// (`<alias>_<name>`), so this is the simple half of #5.

const REPO = process.cwd();
const PORT = 14393;
const PROXY_ALIAS = "prompts-probe";

let proxy: ReturnType<typeof Bun.spawn> | undefined;

async function fleetmcp(...args: string[]) {
  const proc = Bun.spawn(["bun", "run", join(REPO, "src/index.ts"), ...args], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out: stdout + stderr, exitCode };
}

describe("proxy forwards prompts", () => {
  beforeAll(async () => {
    await fleetmcp("config", "remove", "dummy");
    await fleetmcp("config", "add", "dummy", "-t", "stdio", "-c", "bun",
                   "-a", join(REPO, "test/echo-server.ts"));
    await fleetmcp("config", "remove", PROXY_ALIAS);
    await fleetmcp("config", "add", PROXY_ALIAS, "-t", "http",
                   "-u", `http://localhost:${PORT}/mcp`);

    proxy = Bun.spawn(
      ["bun", "run", join(REPO, "src/index.ts"), "proxy", "--port", String(PORT)],
      { cwd: REPO, stdout: "pipe", stderr: "pipe" },
    );

    for (let i = 0; i < 60; i++) {
      try {
        await fetch(`http://localhost:${PORT}/`);
        return;
      } catch {
        await Bun.sleep(500);
      }
    }
    throw new Error("proxy did not come up");
  }, 60_000);

  afterAll(async () => {
    proxy?.kill();
    await fleetmcp("config", "remove", PROXY_ALIAS);
  });

  test("prompts appear through the proxy, namespaced by alias", async () => {
    // Before this change the proxy declared no prompts capability at all,
    // so inspect reported zero.
    const res = await fleetmcp("inspect", PROXY_ALIAS);
    expect(res.exitCode).toBe(0);
    expect(res.out).toContain("dummy_greet");
  }, 30_000);
});
