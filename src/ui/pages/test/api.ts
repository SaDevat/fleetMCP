import { api } from "@/ui/shared/api/index.ts";

export interface CheckMeta {
  name: string;
  description: string;
}

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

export const testApi = api.injectEndpoints({
  endpoints: (build) => ({
    // Fetched once on mount -- lets the page show the five check names as
    // soon as a run starts, without waiting on the (slow) run itself.
    getTestChecks: build.query<CheckMeta[], void>({
      query: () => "api/test/checks",
    }),

    runTest: build.mutation<TestResult, string>({
      query: (alias) => ({ url: `api/test/${alias}`, method: "POST" }),
    }),
  }),
  overrideExisting: false,
});

export const { useGetTestChecksQuery, useRunTestMutation } = testApi;
