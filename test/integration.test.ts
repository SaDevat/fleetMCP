import { test, expect, describe, beforeAll, afterAll } from "bun:test";

async function mcpx(...args: string[]): Promise<string> {
  const proc = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`mcpx exited with code ${exitCode}\nstderr: ${stderr}`);
  }

  return stdout;
}

describe("mcpx config", () => {
  beforeAll(async () => {
    // Ensure dummy server exists for tests
    try {
      await mcpx("config", "add", "dummy", "-t", "stdio", "-c", "bun", "-a", "test/echo-server.ts");
    } catch {
      // May already exist
    }
  });

  test("config list shows table", async () => {
    const out = await mcpx("config", "list");
    expect(out).toContain("Alias");
    expect(out).toContain("dummy");
  });

  test("config add + remove roundtrip", async () => {
    await mcpx("config", "add", "test-temp", "-t", "stdio", "-c", "echo", "-a", "hello");
    const list = await mcpx("config", "list");
    expect(list).toContain("test-temp");

    await mcpx("config", "remove", "test-temp");
    const list2 = await mcpx("config", "list");
    expect(list2).not.toContain("test-temp");
  });

  test("config check validates env vars", async () => {
    const out = await mcpx("config", "check");
    expect(out).toContain("dummy");
    expect(out).toMatch(/✓|✗/);
  });
});

describe("mcpx inspect", () => {
  test("inspect shows echo tool", async () => {
    const out = await mcpx("inspect", "dummy");
    expect(out).toContain("echo");
    expect(out).toContain("echo-test-server");
  });

  test("inspect with --filter narrows results", async () => {
    const out = await mcpx("inspect", "dummy", "--filter", "echo");
    expect(out).toContain("echo");
  });

  test("inspect bad alias exits with code 2", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "inspect", "nonexistent"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(2);
  });
});

describe("mcpx call", () => {
  test("call echo with key=value args", async () => {
    const out = await mcpx("call", "dummy", "echo", "text=hello");
    expect(out).toContain("hello");
  });

  test("call echo with JSON arg", async () => {
    const out = await mcpx("call", "dummy", "echo", '{"text":"world"}');
    expect(out).toContain("world");
  });

  test("call with multiple args", async () => {
    const out = await mcpx("call", "dummy", "echo", "text=test", "data=value");
    expect(out).toContain("test");
    expect(out).toContain("value");
  });
});

describe("mcpx test", () => {
  test("test passes all checks", async () => {
    const out = await mcpx("test", "dummy");
    expect(out).toContain("All checks passed");
    expect(out).toContain("Connection handshake");
    expect(out).toContain("PASS");
  });

  test("test --ci exits 0 on pass", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "test", "dummy", "--ci"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(0);
  });

  test("test nonexistent alias fails", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "test", "nonexistent"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    // Config/connection errors exit with code 1 or 2
    expect(code).toBeGreaterThan(0);
  });
});

describe("mcpx proxy", () => {
  test("proxy starts and responds to health check", async () => {
    const proxyProc = Bun.spawn(["bun", "run", "src/index.ts", "proxy", "-p", "14390"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for proxy to start
    await Bun.sleep(3000);

    try {
      const health = await fetch("http://localhost:14390/");
      expect(health.status).toBe(200);

      const data = (await health.json()) as Record<string, unknown>;
      expect(data["name"]).toBe("mcpx-proxy");
      expect(data["tools"]).toBeGreaterThan(0);
    } finally {
      proxyProc.kill();
      await proxyProc.exited;
    }
  });
});
