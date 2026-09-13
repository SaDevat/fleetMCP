/**
 * Inspect screen. Owned by its own issue's branch -- app.tsx already lazy-loads
 * this page's index.ts, so building the screen means editing files under
 * pages/inspect/, nothing else.
 */
export function InspectPage() {
  return (
    <div className="p-8">
      <h1 className="font-display text-xl text-ink">Inspect</h1>
      <p className="mt-2 text-graphite">Browse tools, resources, and prompts exposed by a server.</p>
    </div>
  );
}
