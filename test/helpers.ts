import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const REPO = process.cwd();

/**
 * A throwaway FLEETMCP_HOME so a test never reads or writes the developer's
 * real ~/.fleetmcp. Without this, concurrent suite runs race the same
 * config.yml and the loser is the user's actual fleet.
 */
export function testHome(): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    FLEETMCP_HOME: mkdtempSync(join(tmpdir(), "fleetmcp-test-")),
  };
}

/** Where the CLI will write config for a given environment. */
export function configPath(env: Record<string, string>): string {
  return join(env["FLEETMCP_HOME"] ?? join(REPO, "MISSING_HOME"), "config.yml");
}

export interface RunOpts {
  env: Record<string, string>;
  /** Defaults to the repo root; set it to prove path-pinning survives a move. */
  cwd?: string;
}

/** Runs the CLI once and returns its output. */
export async function fleetmcp(
  opts: RunOpts,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", join(REPO, "src/index.ts"), ...args], {
    cwd: opts.cwd ?? REPO,
    env: opts.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

export interface RunningProxy {
  proc: ReturnType<typeof Bun.spawn>;
  /** e.g. http://localhost:53124 -- always the port actually bound. */
  base: string;
  stop: () => void;
}

/**
 * Starts a proxy on port 0 and resolves once it reports the port it bound.
 *
 * Binding 0 is what makes parallel suites safe: there is no fixed range to
 * exhaust and no coordination needed between worktrees.
 */
export async function startProxy(
  env: Record<string, string>,
  timeoutMs = 30_000,
): Promise<RunningProxy> {
  const proc = Bun.spawn(["bun", "run", join(REPO, "src/index.ts"), "proxy", "-p", "0"], {
    cwd: REPO,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let seen = "";

  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value, { stream: true });
    const match = seen.match(/http:\/\/localhost:(\d+)\/mcp/);
    if (match?.[1]) {
      // Keep draining, or the child blocks once the stdout pipe fills.
      void (async () => {
        try {
          while (true) {
            const { done: d } = await reader.read();
            if (d) break;
          }
        } catch {
          // stream closed with the process
        }
      })();
      const base = `http://localhost:${match[1]}`;
      return { proc, base, stop: () => proc.kill() };
    }
  }

  proc.kill();
  throw new Error(`proxy did not report a port within ${timeoutMs}ms:\n${seen}`);
}
