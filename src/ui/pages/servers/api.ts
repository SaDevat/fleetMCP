import { api } from "@/ui/shared/api/index.ts";

/**
 * RTK Query endpoints for the servers screen. Mirrors traffic/api.ts:
 * injectEndpoints keeps these out of the base slice so screens built in
 * parallel never edit a shared file.
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

export interface StdioServerBody {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HttpServerBody {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export type ServerBody = StdioServerBody | HttpServerBody;
export type AddServerBody = ServerBody & { alias: string };

export interface ImportResult {
  added: string[];
  skipped: string[];
}

export const serversApi = api.injectEndpoints({
  endpoints: (build) => ({
    getServers: build.query<ServersListResponse, void>({
      query: () => "api/servers",
      providesTags: [{ type: "Servers", id: "LIST" }],
    }),

    addServer: build.mutation<ServerEntry, AddServerBody>({
      query: (body) => ({ url: "api/servers", method: "POST", body }),
      invalidatesTags: [{ type: "Servers", id: "LIST" }],
    }),

    editServer: build.mutation<ServerEntry, { alias: string; body: ServerBody }>({
      query: ({ alias, body }) => ({ url: `api/servers/${alias}`, method: "PATCH", body }),
      invalidatesTags: [{ type: "Servers", id: "LIST" }],
    }),

    deleteServer: build.mutation<{ ok: boolean }, string>({
      query: (alias) => ({ url: `api/servers/${alias}`, method: "DELETE" }),
      invalidatesTags: [{ type: "Servers", id: "LIST" }],
    }),

    importServers: build.mutation<ImportResult, { mcpServers: Record<string, unknown> }>({
      query: (body) => ({ url: "api/servers/import", method: "POST", body }),
      invalidatesTags: [{ type: "Servers", id: "LIST" }],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetServersQuery,
  useAddServerMutation,
  useEditServerMutation,
  useDeleteServerMutation,
  useImportServersMutation,
} = serversApi;
