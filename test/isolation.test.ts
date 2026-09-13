import { test, expect, describe, beforeAll } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { testHome, fleetmcp, configPath, startProxy } from "./helpers.ts";

// These two properties are what let the suite run concurrently. Both were
// broken, and both failed silently rather than loudly, so they are asserted
// directly rather than left implied by other tests passing.

const ALIAS = "isolation-probe";
let env: Record<string, string>;

beforeAll(() => {
  env = testHome();
});

describe("suite isolation", () => {
  test("-p 0 binds an OS-assigned port, not the 4390 default", async () => {
    await fleetmcp(
      { env },
      "config", "add", ALIAS,
      "-t", "stdio", "-c", "bun", "-a", join(process.cwd(), "test/echo-server.ts"),
    );

    const proxy = await startProxy(env);
    try {
      const port = Number(new URL(proxy.base).port);
      // `parseInt(options.port, 10) || 4390` silently turned 0 into 4390: the
      // fallback fires because parseInt("0") is falsy. A single proxy still
      // came up on 4390 and looked fine — only a second one collided. Asserting
      // the port directly is what makes that regression fail loudly.
      expect(port).not.toBe(4390);
      expect(port).toBeGreaterThan(0);

      const res = await fetch(`${proxy.base}/`);
      expect(res.status).toBe(200);
    } finally {
      proxy.stop();
    }
  }, 60_000);

  test("FLEETMCP_HOME keeps config writes out of the real home", async () => {
    const written = await Bun.file(configPath(env)).text();
    expect(written).toContain(ALIAS);

    // The suite genuinely mutates config, so without the override two runs race
    // the developer's own fleet and the loser is their real setup.
    const realConfig = join(homedir(), ".fleetmcp", "config.yml");
    const real = await Bun.file(realConfig).exists()
      ? await Bun.file(realConfig).text()
      : "";
    expect(real).not.toContain(ALIAS);
  });
});
