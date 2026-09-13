import { api } from "@/ui/shared/api/index.ts";

/**
 * RTK Query endpoints for the test screen.
 *
 * injectEndpoints keeps these out of the base slice, so screens built in
 * parallel never edit a shared file. It cannot introduce new tagTypes --
 * those are declared on the base slice in shared/api/base.ts.
 */

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

/** Just enough of servers/api.ts's ServerEntry for the alias picker -- fetched
 * from the shared /api/servers endpoint directly (queryFn, like Traffic's
 * streamTraffic) rather than importing the servers slice's module, which FSD
 * forbids across screens. */
export interface ServerAlias {
  alias: string;
}

export const testApi = api.injectEndpoints({
  endpoints: (build) => ({
    // Fetched once on mount -- lets the page show the five check names as
    // soon as a run starts, without waiting on the (slow) run itself.
    getTestChecks: build.query<CheckMeta[], void>({
      query: () => "api/test/checks",
    }),

    getServerAliases: build.query<ServerAlias[], void>({
      queryFn: async () => {
        const res = await fetch("/api/servers");
        if (!res.ok) return { error: { status: res.status, data: await res.text() } };
        const body = (await res.json()) as { servers: ServerAlias[] };
        return { data: body.servers };
      },
    }),

    runTest: build.mutation<TestResult, string>({
      query: (alias) => ({ url: `api/test/${alias}`, method: "POST" }),
    }),
  }),
  overrideExisting: false,
});

export const { useGetTestChecksQuery, useGetServerAliasesQuery, useRunTestMutation } = testApi;
