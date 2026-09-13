import { useEffect, useMemo, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/ui/shared/api/index.ts";
import {
  useGetTrafficQuery,
  useStreamTrafficQuery,
  type GetTrafficArgs,
  type TrafficRow,
  type TrafficStats,
} from "../api.ts";
import {
  selectExpandedId,
  selectFilter,
  selectStreamStatus,
  selectView,
  setFilter,
  setView,
  toggleExpanded,
  type TrafficFilter,
} from "../model.ts";
import { TrafficTable } from "./traffic-table.tsx";

function filterArgsFor(filter: TrafficFilter): GetTrafficArgs {
  if (filter === "all") return {};
  if (filter === "errors") return { failures: true };
  return { alias: filter };
}

function applyFilter(rows: TrafficRow[], filter: TrafficFilter): TrafficRow[] {
  return rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "errors") return r.isError;
    return r.alias === filter;
  });
}

function percentileMs(sortedDurations: number[], q: number): string {
  if (sortedDurations.length === 0) return "—";
  const idx = Math.min(sortedDurations.length - 1, Math.floor(sortedDurations.length * q));
  return `${sortedDurations[idx]}ms`;
}

interface FooterStats {
  p50: string;
  p95: string;
  failures: number;
  total: number;
}

/** Client-side stats over an already-filtered row window -- used for the live
 * view, where the server's one-shot `stats` snapshot goes stale the moment the
 * SSE stream unshifts a new row. */
function clientStats(rows: TrafficRow[]): FooterStats {
  const durations = rows.map((r) => r.durationMs).sort((a, b) => a - b);
  return {
    p50: percentileMs(durations, 0.5),
    p95: percentileMs(durations, 0.95),
    failures: rows.filter((r) => r.isError).length,
    total: rows.length,
  };
}

/** The server's stats are raw ms numbers; the footer wants the same "Xms"/"—"
 * formatting client-side stats already use. */
function formatServerStats(stats: TrafficStats): FooterStats {
  return {
    p50: stats.p50 === null ? "—" : `${stats.p50}ms`,
    p95: stats.p95 === null ? "—" : `${stats.p95}ms`,
    failures: stats.failures,
    total: stats.total,
  };
}

/** History view: pages backward over getTraffic via the `before` cursor.
 * Kept local to this component -- the least state that is still correct. */
function useHistoryPages(filter: TrafficFilter) {
  const args = filterArgsFor(filter);
  const key = `${args.alias ?? ""}:${args.failures ?? false}`;
  const [before, setBefore] = useState<number | undefined>(undefined);
  const [accumulated, setAccumulated] = useState<TrafficRow[]>([]);
  const prevKey = useRef(key);

  const { data, isFetching, refetch } = useGetTrafficQuery({ ...args, before, limit: 100 });

  useEffect(() => {
    if (prevKey.current === key) return;
    prevKey.current = key;
    setBefore(undefined);
    setAccumulated([]);
  }, [key]);

  useEffect(() => {
    if (!data) return;
    setAccumulated((prev) => (before === undefined ? data.rows : [...prev, ...data.rows]));
  }, [data, before]);

  const loadOlder = () => {
    const last = accumulated[accumulated.length - 1];
    if (last) setBefore(last.seq);
  };

  const reset = () => {
    setBefore(undefined);
    setAccumulated([]);
    void refetch();
  };

  return { rows: accumulated, stats: data?.stats, isFetching, loadOlder, reset };
}

export function TrafficPage() {
  const dispatch = useAppDispatch();
  const view = useAppSelector(selectView);
  const filter = useAppSelector(selectFilter);
  const expandedId = useAppSelector(selectExpandedId);
  const streamStatus = useAppSelector(selectStreamStatus);

  // Subscribed whenever this page is mounted, regardless of which view is
  // showing -- the header's live dot reflects the connection, not the view.
  const { data: liveData } = useStreamTrafficQuery();

  const aliases = useMemo(
    () => Array.from(new Set((liveData?.rows ?? []).map((r) => r.alias))).sort(),
    [liveData],
  );

  const liveRows = useMemo(() => applyFilter(liveData?.rows ?? [], filter), [liveData, filter]);
  const history = useHistoryPages(filter);

  const rows = view === "live" ? liveRows : history.rows;
  const stats = view === "live"
    ? clientStats(liveRows)
    : history.stats
      ? formatServerStats(history.stats)
      : clientStats(history.rows);
  const shown = rows.length;
  const total = stats.total;

  const onToggle = (id: string) => dispatch(toggleExpanded(id));
  const onFilter = (f: TrafficFilter) => dispatch(setFilter(f));

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, height: "100%" }}>
      {/* header */}
      <div style={{ padding: "1.5rem clamp(1.1rem, 2.4vw, 1.9rem) 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: ".85rem", flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: ".72rem", letterSpacing: ".16em", textTransform: "uppercase", color: "var(--graphite)" }}>
            §4
          </span>
          <h1 className="font-display" style={{ margin: 0, fontSize: "1.42rem", letterSpacing: "-.008em", color: "var(--ink)" }}>
            Traffic
          </h1>
          <span className="mono" style={{ fontSize: ".7rem", color: "var(--graphite)" }}>
            — tool calls through the proxy
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: ".44rem" }}>
            <span
              className={streamStatus === "live" ? "beat" : undefined}
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                display: "inline-block",
                background: streamStatus === "live" ? "var(--success)" : "var(--graphite)",
              }}
            />
            <span className="mono" style={{ fontSize: ".7rem", color: "var(--ink)" }}>
              {streamStatus === "live" ? "live" : "waiting"}
            </span>
          </span>
        </div>
        <p style={{ margin: ".7rem 0 0", color: "var(--graphite)", fontSize: ".95rem", lineHeight: 1.55, maxWidth: "40rem" }}>
          Every tool call routed through the aggregated endpoint, as it happens.{" "}
          <span style={{ color: "var(--ink)" }}>{shown}</span> of {total} rows shown; older rows stay queryable in
          SQLite.
        </p>
      </div>

      {/* filter rail */}
      <div style={{ padding: "1.2rem clamp(1.1rem, 2.4vw, 1.9rem) 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1.45rem", flexWrap: "wrap", paddingBottom: ".7rem" }}>
          <span className="cap">server</span>
          <button type="button" className="fchip" data-on={filter === "all" ? "" : undefined} onClick={() => onFilter("all")}>
            all
          </button>
          {aliases.map((alias) => (
            <button
              key={alias}
              type="button"
              className="fchip"
              data-on={filter === alias ? "" : undefined}
              onClick={() => onFilter(alias)}
            >
              {alias}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button type="button" className="fchip" data-on={view === "live" ? "" : undefined} onClick={() => dispatch(setView("live"))}>
            live
          </button>
          <button
            type="button"
            className="fchip"
            data-on={view === "history" ? "" : undefined}
            onClick={() => dispatch(setView("history"))}
          >
            history
          </button>
          <button type="button" className="fchip" data-on={filter === "errors" ? "" : undefined} onClick={() => onFilter("errors")}>
            failures only
          </button>
        </div>
        <div className="rule-h-strong" />
      </div>

      {rows.length > 0 ? (
        <TrafficTable rows={rows} expandedId={expandedId} onToggle={onToggle} />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "3.2rem clamp(1.1rem, 2.4vw, 1.9rem)" }}>
          <div style={{ maxWidth: "30rem" }}>
            <div className="font-display-italic" style={{ color: "var(--ink)", lineHeight: 1.45 }}>
              The proxy is up. Nothing has been called yet.
            </div>
            <p style={{ margin: ".85rem 0 0", color: "var(--graphite)", fontSize: ".95rem", lineHeight: 1.6 }}>
              Point a client at the aggregated endpoint and calls will appear here as they route. Every tool call is
              written to SQLite whether this pane is open or not.
            </p>
            <div className="rule-h" style={{ margin: "1.4rem 0 1rem" }} />
            <div className="mono" style={{ fontSize: ".715rem", lineHeight: 1.9, color: "var(--graphite)" }}>
              <div>
                endpoint &nbsp;<span style={{ color: "var(--ink)" }}>{window.location.origin}/mcp</span>
              </div>
              <div>
                log &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: "var(--ink)" }}>~/.fleetmcp/logs.db</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {view === "history" && (
        <div style={{ padding: "0 clamp(1.1rem, 2.4vw, 1.9rem) .8rem", display: "flex", gap: "1.2rem" }}>
          <button type="button" className="fchip" onClick={history.loadOlder} disabled={history.isFetching}>
            load older
          </button>
          <button type="button" className="fchip" onClick={history.reset} disabled={history.isFetching}>
            refetch
          </button>
        </div>
      )}

      {/* footer */}
      <div className="footer-stats">
        <span className="mono">
          p50 <span style={{ color: "var(--ink)" }}>{stats.p50}</span>
        </span>
        <span className="mono">
          p95 <span style={{ color: "var(--ink)" }}>{stats.p95}</span>
        </span>
        <span className="mono">
          failures <span style={{ color: "var(--ink)" }}>{stats.failures}</span>
        </span>
        <span style={{ flex: 1 }} />
        <span className="mono">virtualized · newest first</span>
      </div>
    </div>
  );
}
