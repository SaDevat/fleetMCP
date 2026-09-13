/**
 * One error envelope for the whole /api/* surface, so the UI has a single
 * branch to write.
 *
 * `not_found` is a first-class view in the UI, never a toast: ids travel in the
 * URL, so an invented, stale, or retention-pruned one is a normal way to
 * arrive, not an exception.
 */
export type ApiErrorCode = "not_found" | "bad_request" | "upstream_unavailable";

export function apiError(status: number, code: ApiErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}
