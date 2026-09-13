import { api } from "@/ui/shared/api/index.ts";

/**
 * RTK Query endpoints for the Call console. Mirrors traffic/servers api.ts:
 * injectEndpoints keeps these out of the base slice, so screens built in
 * parallel never edit a shared file.
 *
 * getCallServers duplicates servers/api.ts's getServers query under a
 * different endpoint name rather than importing across a page boundary --
 * pages don't import each other's modules here (steiger/FSD), and it's one
 * query definition, not a route. Both hit the same GET /api/servers.
 */

export interface CallServerEntry {
  alias: string;
  type: "stdio" | "http";
  health: "ok" | "missing" | "http";
  connected: boolean;
}

export interface CallToolEntry {
  name: string;
  description?: string;
  inputSchema: unknown;
  namespaced: string;
}

export interface CallToolBody {
  alias: string;
  tool: string;
  arguments: Record<string, unknown>;
}

/**
 * Two shapes come back: an MCP CallToolResult (has `content`, optionally
 * `isError`/`structuredContent`) or a transport failure thrown before the
 * sub-server produced a result (`{ error }`, no `content`). Same two shapes
 * Traffic's drawer already renders -- see traffic-table.tsx's formatResponse.
 */
export type CallToolResponse =
  | { content: unknown[]; isError?: boolean; structuredContent?: unknown }
  | { error: string };

export const callApi = api.injectEndpoints({
  endpoints: (build) => ({
    getCallServers: build.query<{ servers: CallServerEntry[] }, void>({
      query: () => "api/servers",
      providesTags: [{ type: "Servers", id: "LIST" }],
    }),

    getServerTools: build.query<{ tools: CallToolEntry[] }, string>({
      query: (alias) => `api/servers/${alias}/tools`,
      providesTags: (_result, _error, alias) => [{ type: "Tools", id: alias }],
    }),

    callTool: build.mutation<CallToolResponse, CallToolBody>({
      query: (body) => ({ url: "api/call", method: "POST", body }),
    }),
  }),
  overrideExisting: false,
});

export const { useGetCallServersQuery, useGetServerToolsQuery, useCallToolMutation } = callApi;
