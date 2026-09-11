import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";

// Regression check for #4 — sub-servers were connected once at startup and
// never revived. A stdio child that died left every call to its tools failing
// permanently, so "always warm" held only until something fell over.

const REPO = process.cwd();
const PORT = 14392;
const PROXY_ALIAS = "reconnect-probe";

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

/** Kills the echo-server child the proxy spawned for the `dummy` alias. */
async function killEchoChild(): Promise<void> {
  await Bun.spawn(["pkill", "-f", "echo-server.ts"]).exited;
}

describe("proxy sub-server reconnect", () => {
  beforeAll(async () => {
    await fleetmcp("config", "remove", "dummy");
    await fleetmcp("config", "add", "dummy", "-t", "stdio", "-c", "bun",
                   "-a", join(REPO, "test/echo-server.ts"));
    await fleetmcp("config", "remove", PROXY_ALIAS);
    await fleetmcp("config", "add", PROXY_ALIAS, "-t", "http",
                   "-u", `http://localhost:${PORT}/mcp`);

    proxy = Bun.spawn(["bun", "run", join(REPO, "src/index.ts"), "proxy", "--port", String(PORT)], {
      cwd: REPO, stdout: "pipe", stderr: "pipe",
    });

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

  test("a tool call succeeds while the child is alive", async () => {
    const res = await fleetmcp("call", PROXY_ALIAS, "dummy_echo", "text=first");
    expect(res.exitCode).toBe(0);
    expect(res.out).toContain("first");
  }, 30_000);

  test("after the child is killed, the next call reconnects and succeeds", async () => {
    await killEchoChild();
    await Bun.sleep(1500); // let the child's 'close' event reach client.onclose

    // Before the fix this failed permanently until the proxy was restarted.
    const res = await fleetmcp("call", PROXY_ALIAS, "dummy_echo", "text=second");
    expect(res.exitCode).toBe(0);
    expect(res.out).toContain("second");
  }, 30_000);
});
