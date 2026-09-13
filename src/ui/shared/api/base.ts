import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

/**
 * The base RTK Query slice every page injects its endpoints into.
 *
 * Every tag any screen will use must be declared here: injectEndpoints cannot
 * add tag types (only enhanceEndpoints({ addTagTypes }) can), and screens are
 * built in parallel against this slice.
 */
export const api = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({ baseUrl: "/" }),
  tagTypes: ["Traffic", "Servers", "Tools", "Test"],
  endpoints: () => ({}),
});
