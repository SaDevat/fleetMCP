import type { Database } from "bun:sqlite";
import type { createMcpClient } from "../core/client.ts";

/**
 * A live sub-server connection held by the proxy's warm pool.
 */
export interface SubClient {
  alias: string;
  client: Awaited<ReturnType<typeof createMcpClient>>;
  /** Set when the transport closes; cleared on a successful reconnect. */
  dead: boolean;
  /** Epoch ms of the last reconnect attempt, for backoff. */
  lastAttempt: number;
  /** Consecutive failed reconnects; widens the backoff window. */
  failures: number;
}

/**
 * The proxy's running state, handed to each route module.
 *
 * Passed explicitly rather than held in module scope: the pool is per-proxy,
 * and a module-level singleton would leak between any two tests that ran in the
 * same process. Route modules are factories over this handle, which also makes
 * them testable without standing up a real proxy.
 */
export interface ProxyRuntime {
  /** Every sub-server, live or dead. */
  subClients: SubClient[];
  /** Alias -> sub-client, for direct lookup. */
  clientMap: Map<string, SubClient>;
  /** Reconnects a dead sub-server, respecting its backoff window. */
  ensureLive: (sub: SubClient) => Promise<boolean>;
  /** Wraps a sub-server URI as fleet://<alias>/<uri>. */
  wrapUri: (alias: string, uri: string) => string;
  /** Undoes wrapUri; undefined if the handle is malformed or the alias unknown. */
  unwrapUri: (wrapped: string) => { sub: SubClient; uri: string } | undefined;
  /** The proxy log, or undefined when logging is unavailable. */
  db: Database | undefined;
}

/** What each route module exports: routes built over the running proxy. */
export type RouteFactory = (rt: ProxyRuntime) => Record<string, unknown>;
