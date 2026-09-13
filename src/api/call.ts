import type { ProxyRuntime } from "./types.ts";

/**
 * Routes for the call screen. Owned by its screen's branch -- no other module
 * should need editing to add endpoints here.
 */
export function callRoutes(_rt: ProxyRuntime): Record<string, unknown> {
  return {};
}
