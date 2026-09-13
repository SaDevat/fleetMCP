import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { createMcpClient } from "../src/core/client.ts";
import { REPO, testHome, fleetmcp, startProxy, type RunningProxy } from "./helpers.ts";

// #7/#8 — resources and templates were invisible through the proxy.
//
// The collision case is the reason #6 exists: the same echo server registered
// under two aliases exposes the identical URI (file:///README.md) twice. Both
// must stay independently readable, which only works because the alias travels
// inside the fleet:// handle.

const PROXY_ALIAS = "resources-probe";
const A = "twinone";
const B = "twintwo";

let env: Record<string, string>;
let proxy: RunningProxy;

describe("proxy forwards resources", () => {
  beforeAll(async () => {
    env = testHome();
    // Same server, two aliases → the same resource URI from both.
    for (const alias of [A, B]) {
      await fleetmcp({ env }, "config", "add", alias, "-t", "stdio", "-c", "bun",
                     "-a", join(REPO, "test/echo-server.ts"));
    }

    proxy = await startProxy(env);

    await fleetmcp({ env }, "config", "add", PROXY_ALIAS, "-t", "http",
                   "-u", `${proxy.base}/mcp`);
  }, 90_000);

  afterAll(() => {
    proxy.stop();
  });

  test("colliding URIs surface as two distinct fleet:// handles", async () => {
    // Assert on the wire data, not rendered CLI output — inspect's tree shows
    // resource names, and the URI is what actually has to be unambiguous.
    const client = await createMcpClient({
      serverConfig: { type: "http", url: `${proxy.base}/mcp`, headers: {} },
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
