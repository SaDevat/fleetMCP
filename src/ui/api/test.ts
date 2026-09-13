import { api } from "../store.ts";

/**
 * RTK Query endpoints for the test screen.
 *
 * injectEndpoints keeps these out of store.ts, so screens built in parallel
 * never edit a shared file. Note that it cannot introduce new tagTypes -- those
 * are declared on the base slice.
 */
export const testApi = api.injectEndpoints({
  endpoints: () => ({}),
  overrideExisting: false,
});
