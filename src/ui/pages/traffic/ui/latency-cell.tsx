/**
 * Latency bar: sqrt scale with a 6% floor, so a 13ms call still reads and a
 * 1400ms call still pegs (linear crushed the real distribution -- most calls
 * are under 100ms). Magnitude is bar length; a weight lift at 300ms is the
 * only other cue -- color never means severity here, only --graphite/--ink.
 */
export function LatencyCell({ durationMs }: { durationMs: number }) {
  const barWidth = Math.max(6, Math.min(100, Math.round(Math.sqrt(durationMs / 1400) * 100)));
  const barColor = durationMs >= 300 ? "var(--ink)" : "var(--graphite)";

  return (
    <span className="lat">
      <span className="mono lat-ms">{durationMs}ms</span>
      <span className="lat-track">
        <span className="lat-bar" style={{ width: `${barWidth}%`, background: barColor }} />
      </span>
    </span>
  );
}
