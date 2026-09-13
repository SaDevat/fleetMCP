import { api } from "@/ui/shared/api/index.ts";
import { setStreamStatus } from "./model.ts";

/**
 * RTK Query endpoints for the traffic screen.
 *
 * injectEndpoints keeps these out of the base slice, so screens built in
 * parallel never edit a shared file. It cannot introduce new tagTypes --
 * those are declared on the base slice in shared/api/base.ts.
 */

export interface TrafficRow {
  seq: number;
  id: string;
  timestamp: string;
  alias: string;
  toolName: string;
  durationMs: number;
  isError: boolean;
  requestTokens: number;
  responseTokens: number;
}

export interface TrafficStats {
  p50: number | null;
  p95: number | null;
  failures: number;
  total: number;
  dbBytes: number;
}

export interface TrafficListResponse {
  rows: TrafficRow[];
  stats: TrafficStats;
}

export interface TrafficDetailResponse extends TrafficRow {
  request: unknown;
  response: unknown;
}

export interface GetTrafficArgs {
  alias?: string | undefined;
  failures?: boolean | undefined;
  before?: number | undefined;
  limit?: number | undefined;
}

function trafficQuery(args: GetTrafficArgs): string {
  const params = new URLSearchParams();
  if (args.alias) params.set("alias", args.alias);
  if (args.failures) params.set("failures", "true");
  if (args.before !== undefined) params.set("before", String(args.before));
  if (args.limit !== undefined) params.set("limit", String(args.limit));
  const qs = params.toString();
  return qs ? `api/traffic?${qs}` : "api/traffic";
}

export const trafficApi = api.injectEndpoints({
  endpoints: (build) => ({
    getTraffic: build.query<TrafficListResponse, GetTrafficArgs>({
      query: trafficQuery,
      providesTags: [{ type: "Traffic", id: "LIST" }],
    }),

    // Fetched on expand only.
    getTrafficRow: build.query<TrafficDetailResponse, string>({
      query: (id) => `api/traffic/${id}`,
    }),

    // The "live" view: an initial page, kept fresh by an SSE subscription
    // rather than polling.
    streamTraffic: build.query<TrafficListResponse, void>({
      queryFn: async () => {
        const res = await fetch("/api/traffic?limit=200");
        if (!res.ok) {
          return { error: { status: res.status, data: await res.text() } };
        }
        return { data: (await res.json()) as TrafficListResponse };
      },
      async onCacheEntryAdded(_arg, { updateCachedData, cacheDataLoaded, cacheEntryRemoved, dispatch }) {
        await cacheDataLoaded;

        const source = new EventSource("/api/traffic/stream");
        source.onopen = () => dispatch(setStreamStatus("live"));
        source.onerror = () => dispatch(setStreamStatus("waiting"));
        source.onmessage = (event) => {
          const row = JSON.parse(event.data) as TrafficRow;
          updateCachedData((draft) => {
            draft.rows.unshift(row);
            if (draft.rows.length > 200) draft.rows.length = 200;
          });
        };
        // ponytail: gap possible across a dropped stream; catch up via ?after=<seq> if it ever matters

        await cacheEntryRemoved;
        source.close();
      },
    }),
  }),
  overrideExisting: false,
});

export const { useGetTrafficQuery, useGetTrafficRowQuery, useStreamTrafficQuery } = trafficApi;
