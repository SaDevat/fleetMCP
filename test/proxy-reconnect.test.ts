import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { REPO, testHome, fleetmcp, startProxy, type RunningProxy } from "./helpers.ts";

// Regression check for #4 — sub-servers were connected once at startup and
// never revived. A stdio child that died left every call to its tools failing
// permanently, so "always warm" held only until something fell over.

const PROXY_ALIAS = "reconnect-probe";

let env: Record<string, string>;
let proxy: RunningProxy;

/**
 * Finds the pid of a descendant process of `rootPid` whose command matches
 * `pattern`, by walking the process tree via `ps`.
 *
 * Every concurrently-running suite spawns an identical `bun run
 * .../test/echo-server.ts` command line, so a bare `pkill -f echo-server.ts`
 * would kill every suite's echo child, not just this one's. Matching on the
 * actual pid spawned under this test's own proxy process is what keeps the
 * kill scoped to this suite.
 */
async function findDescendantPid(rootPid: number, pattern: RegExp): Promise<number | undefined> {
  const proc = Bun.spawn(["ps", "-eo", "pid,ppid,command"]);
  const out = await new Response(proc.stdout).text();
  await proc.exited;

  const rows: { pid: number; ppid: number; cmd: string }[] = [];
  for (const line of out.trim().split("\n").slice(1)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] ?? "" });
  }

  let frontier = [rootPid];
  const seen = new Set<number>(frontier);
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const pid of frontier) {
      for (const row of rows) {
        if (row.ppid !== pid || seen.has(row.pid)) continue;
        seen.add(row.pid);
        if (pattern.test(row.cmd)) return row.pid;
        next.push(row.pid);
      }
    }
    frontier = next;
  }
  return undefined;
}

/** Kills the echo-server child that this suite's own proxy process spawned. */
async function killEchoChild(): Promise<void> {
  const pid = await findDescendantPid(proxy.proc.pid, /echo-server\.ts/);
  if (!pid) {
    throw new Error(`could not find an echo-server.ts descendant of proxy pid ${proxy.proc.pid}`);
  }
  await Bun.spawn(["kill", "-9", String(pid)]).exited;
}

describe("proxy sub-server reconnect", () => {
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

  test("a tool call succeeds while the child is alive", async () => {
    const res = await fleetmcp({ env }, "call", PROXY_ALIAS, "dummy_echo", "text=first");
    expect(res.exitCode).toBe(0);
    expect(res.stdout + res.stderr).toContain("first");
  }, 30_000);

  test("after the child is killed, the next call reconnects and succeeds", async () => {
    await killEchoChild();
    await Bun.sleep(1500); // let the child's 'close' event reach client.onclose

    // Before the fix this failed permanently until the proxy was restarted.
    const res = await fleetmcp({ env }, "call", PROXY_ALIAS, "dummy_echo", "text=second");
    expect(res.exitCode).toBe(0);
    expect(res.stdout + res.stderr).toContain("second");
  }, 30_000);
});
