// ---------------------------------------------------------------------------
// Shared result types used across cli/ modules.
// Plain TypeScript interfaces — internal runtime types, not user-facing config.
// ---------------------------------------------------------------------------

export interface CheckResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

export interface TestResult {
  alias: string;
  passed: boolean;
  checks: CheckResult[];
  totalDurationMs: number;
}

export interface ProxyLogEntry {
  /**
   * SQLite rowid. Ordering and cursors key on this, never on `id` (a random
   * uuid, so it does not order) or `timestamp` (not unique -- real logs already
   * contain collisions, which would skip or repeat rows at a page boundary).
   */
  seq: number;
  /** Stable public handle, used for deep links. */
  id: string;
  timestamp: string; // ISO 8601
  alias: string;
  toolName: string;
  request: unknown;
  response: unknown;
  durationMs: number;
  isError: boolean;
  requestTokens: number;
  responseTokens: number;
}

/** A traffic row without its payloads -- what list endpoints return. */
export type ProxyLogRow = Omit<ProxyLogEntry, "request" | "response">;
