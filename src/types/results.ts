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
  id: string;
  timestamp: string; // ISO 8601
  alias: string;
  toolName: string;
  request: unknown;
  response: unknown;
  durationMs: number;
  isError: boolean;
}
