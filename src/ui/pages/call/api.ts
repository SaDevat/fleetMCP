import { api } from "@/ui/shared/api/index.ts";

/**
 * RTK Query endpoints for the call screen.
 *
 * injectEndpoints keeps these out of the base slice, so screens built in
 * parallel never edit a shared file. It cannot introduce new tagTypes --
 * those are declared on the base slice in shared/api/base.ts.
 */
export const callApi = api.injectEndpoints({
  endpoints: () => ({}),
  overrideExisting: false,
});
