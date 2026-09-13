import { api } from "../store.ts";

/**
 * RTK Query endpoints for the traffic screen.
 *
 * injectEndpoints keeps these out of store.ts, so screens built in parallel
 * never edit a shared file. Note that it cannot introduce new tagTypes -- those
 * are declared on the base slice.
 */
export const trafficApi = api.injectEndpoints({
  endpoints: () => ({}),
  overrideExisting: false,
});
