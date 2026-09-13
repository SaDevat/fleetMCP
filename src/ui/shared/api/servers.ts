import { api } from "./base.ts";

/**
 * The server registry, shared by every screen that needs it.
 *
 * This lives in `shared` rather than in `pages/servers` because three slices
 * consume it and FSD forbids one page importing another's module. The three
 * previously fetched `/api/servers` separately -- two of them untagged -- so
 * adding a server refreshed only the Servers screen and left the Call and Test
 * pickers stale until a reload. One tagged query fixes that for all of them.
 */
export interface ServerEntry {
  alias: string;
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  health: "ok" | "missing" | "http";
  connected: boolean;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface ServersListResponse {
  servers: ServerEntry[];
}

export const serversSharedApi = api.injectEndpoints({
  endpoints: (build) => ({
    getServers: build.query<ServersListResponse, void>({
      query: () => "api/servers",
      providesTags: [{ type: "Servers", id: "LIST" }],
    }),
  }),
  overrideExisting: false,
});

export const { useGetServersQuery } = serversSharedApi;
