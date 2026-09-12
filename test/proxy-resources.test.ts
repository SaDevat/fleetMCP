import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { createMcpClient } from "../src/core/client.ts";

// #7/#8 — resources and templates were invisible through the proxy.
//
// The collision case is the reason #6 exists: the same echo server registered
// under two aliases exposes the identical URI (file:///README.md) twice. Both
// must stay independently readable, which only works because the alias travels
// inside the fleet:// handle.

const REPO = process.cwd();
const PORT = 14394;
const PROXY_ALIAS = "resources-probe";
const A = "twinone";
const B = "twintwo";

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

describe("proxy forwards resources", () => {
  beforeAll(async () => {
    for (const alias of [A, B, PROXY_ALIAS]) {
      await fleetmcp("config", "remove", alias);
    }
    // Same server, two aliases → the same resource URI from both.
    for (const alias of [A, B]) {
      await fleetmcp("config", "add", alias, "-t", "stdio", "-c", "bun",
                     "-a", join(REPO, "test/echo-server.ts"));
    }
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
  }, 90_000);

  afterAll(async () => {
    proxy?.kill();
    for (const alias of [A, B, PROXY_ALIAS]) {
      await fleetmcp("config", "remove", alias);
    }
  });

  test("colliding URIs surface as two distinct fleet:// handles", async () => {
    // Assert on the wire data, not rendered CLI output — inspect's tree shows
    // resource names, and the URI is what actually has to be unambiguous.
    const client = await createMcpClient({
      serverConfig: { type: "http", url: `http://localhost:${PORT}/mcp`, headers: {} },
    });

    try {
      const { resources } = await client.listResources();
      const uris = resources.map((r) => r.uri);

      // Both servers expose file:///README.md; without the wrapper one would
      // hide the other.
      expect(uris).toContain(`fleet://${A}/file:///README.md`);
      expect(uris).toContain(`fleet://${B}/file:///README.md`);

      // And each handle reads back independently.
      const read = await client.readResource({ uri: `fleet://${A}/file:///README.md` });
      expect(read.contents[0]?.text).toBe("echo-server readme");
      // The echoed URI keeps the handle the client was given.
      expect(read.contents[0]?.uri).toBe(`fleet://${A}/file:///README.md`);
    } finally {
      await client.close();
    }
  }, 30_000);
});
