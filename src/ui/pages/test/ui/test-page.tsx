/**
 * Test screen. Owned by its own issue's branch -- app.tsx already lazy-loads
 * this page's index.ts, so building the screen means editing files under
 * pages/test/, nothing else.
 */
export function TestPage() {
  return (
    <div className="p-8">
      <h1 className="font-display text-xl text-ink">Test</h1>
      <p className="mt-2 text-graphite">Run compliance checks against a configured server.</p>
    </div>
  );
}
