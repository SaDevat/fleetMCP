import { test, expect, describe, afterAll } from "bun:test";
import { parse as parseYaml } from "yaml";
import { tmpdir, homedir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join, isAbsolute } from "node:path";

// Regression check for #3 — a relative path in a stdio server's command/args
// resolved against whatever CWD fleetmcp happened to run from, so an alias that
// worked from the project root failed everywhere else.

const REPO = process.cwd();
const ALIAS = "pathcheck";

async function fleetmcp(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(["bun", "run", join(REPO, "src/index.ts"), ...args], {
    cwd,
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

describe("stdio path pinning", () => {
  afterAll(async () => {
    await fleetmcp(REPO, "config", "remove", ALIAS);
  });

  test("a relative path registered from the repo root is stored absolute", async () => {
    await fleetmcp(REPO, "config", "remove", ALIAS); // may not exist; ignore

    const add = await fleetmcp(
      REPO,
      "config", "add", ALIAS,
      "-t", "stdio", "-c", "bun", "-a", "test/echo-server.ts",
    );
    expect(add.exitCode).toBe(0);

    // Assert against the stored config, not rendered table output — the table
    // wraps long paths across lines and its layout is not a contract.
    const raw = await Bun.file(join(homedir(), ".fleetmcp", "config.yml")).text();
    const stored = parseYaml(raw) as { servers: Record<string, { args?: string[] }> };

    const args = stored.servers[ALIAS]?.args ?? [];
    expect(args).toHaveLength(1);
    expect(isAbsolute(args[0] ?? "")).toBe(true);
    expect(args[0]).toEndWith("test/echo-server.ts");
  });

  test("the same alias connects from an unrelated directory", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "fleetmcp-cwd-"));
    try {
      // Before the fix this failed with: Module not found "test/echo-server.ts"
      const res = await fleetmcp(elsewhere, "inspect", ALIAS);
      expect(res.exitCode).toBe(0);
      expect(res.stdout + res.stderr).toContain("echo-test-server");
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });
});
