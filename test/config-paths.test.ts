import { test, expect, describe, beforeAll } from "bun:test";
import { parse as parseYaml } from "yaml";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { testHome, fleetmcp, configPath } from "./helpers.ts";

// Regression check for #3 — a relative path in a stdio server's command/args
// resolved against whatever CWD fleetmcp happened to run from, so an alias that
// worked from the project root failed everywhere else.

const ALIAS = "pathcheck";

// Its own throwaway home: this test writes config, and sharing the real one
// makes concurrent runs race each other.
let env: Record<string, string>;
beforeAll(() => {
  env = testHome();
});

describe("stdio path pinning", () => {
  test("a relative path registered from the repo root is stored absolute", async () => {
    const add = await fleetmcp(
      { env },
      "config", "add", ALIAS,
      "-t", "stdio", "-c", "bun", "-a", "test/echo-server.ts",
    );
    expect(add.exitCode).toBe(0);

    // Assert against the stored config, not rendered table output — the table
    // wraps long paths across lines and its layout is not a contract.
    const raw = await Bun.file(configPath(env)).text();
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
      const res = await fleetmcp({ env, cwd: elsewhere }, "inspect", ALIAS);
      expect(res.exitCode).toBe(0);
      expect(res.stdout + res.stderr).toContain("echo-test-server");
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });
});
