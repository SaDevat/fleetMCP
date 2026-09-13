import type { ProxyRuntime } from "./types.ts";
import { trafficRoutes } from "./traffic.ts";
import { serversRoutes } from "./servers.ts";
import { callRoutes } from "./call.ts";
import { testRoutes } from "./test.ts";

/**
 * Every /api/* route, assembled over the running proxy.
 *
 * Bun matches `routes` before `fetch` and supports `:param` plus per-method
 * objects, so a screen adds endpoints by editing only its own module here.
 */
export function apiRoutes(rt: ProxyRuntime): Record<string, unknown> {
  return {
    ...trafficRoutes(rt),
    ...serversRoutes(rt),
    ...callRoutes(rt),
    ...testRoutes(rt),
  };
}
