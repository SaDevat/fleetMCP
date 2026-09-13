/**
 * Call screen. Owned by its own issue's branch -- app.tsx already lazy-loads
 * this page's index.ts, so building the screen means editing files under
 * pages/call/, nothing else.
 */
export function CallPage() {
  return (
    <div className="p-8">
      <h1 className="font-display text-xl text-ink">Call</h1>
      <p className="mt-2 text-graphite">Invoke a tool call and inspect its result.</p>
    </div>
  );
}
