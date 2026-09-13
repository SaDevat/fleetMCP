/**
 * Call screen. Owned by its issue's branch -- app.tsx already imports this, so
 * building the screen means editing this file and its api module, nothing else.
 */
export function CallView() {
  return (
    <div className="p-8">
      <h1 className="font-display text-xl text-ink">Call</h1>
      <p className="mt-2 text-graphite">Invoke a tool call and inspect its result.</p>
    </div>
  );
}
