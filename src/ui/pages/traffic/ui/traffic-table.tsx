import { useMemo, useRef } from "react";
import { flexRender, tableFeatures, useTable, type ColumnDef } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useGetTrafficRowQuery, type TrafficRow } from "../api.ts";
import { LatencyCell } from "./latency-cell.tsx";

// v9: no built-in feature (sorting/filtering/pagination) is used -- filtering
// and paging are done ourselves in traffic-page.tsx -- so the registry is empty.
const features = tableFeatures({});

/**
 * Split so the milliseconds can be dropped on narrow viewports. The mobile
 * column budget is 350px of fixed tracks in ~340px of space, which starved the
 * `tool` column to zero width -- hiding `.t-ms` buys back the ~30px without
 * dropping a column the design says to keep.
 */
function fmtTime(ts: string): { hms: string; ms: string } {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return {
    hms: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    ms: `.${pad(d.getMilliseconds(), 3)}`,
  };
}

function fmtN(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Two payload shapes reach this drawer: an MCP tool result `{ content, isError }`
 * and a transport-level failure `{ error: "…" }` (thrown before the sub-server
 * ever produced a result). Each is rendered in its own voice rather than as
 * raw JSON soup.
 */
function formatResponse(response: unknown): string {
  if (response && typeof response === "object") {
    if ("content" in response) {
      const mcp = response as { content?: { type: string; text?: string }[] };
      const text = mcp.content?.map((c) => c.text ?? JSON.stringify(c)).join("\n");
      if (text) return text;
    } else if ("error" in response) {
      const transport = response as { error?: string };
      if (transport.error) return transport.error;
    }
  }
  return JSON.stringify(response, null, 2);
}

function TrafficDrawer({ row }: { row: TrafficRow }) {
  const { data, isFetching } = useGetTrafficRowQuery(row.id);
  const loading = isFetching || !data;

  return (
    <div className="drawer">
      <div className="drawer-grid">
        <div>
          <div className="cap" style={{ marginBottom: ".4rem" }}>
            request
          </div>
          <pre>{loading ? "loading…" : JSON.stringify(data.request, null, 2)}</pre>
        </div>
        <div>
          <div className="cap" style={{ marginBottom: ".4rem" }}>
            response
          </div>
          <pre>{loading ? "loading…" : formatResponse(data.response)}</pre>
        </div>
      </div>
      <div className="drawer-meta mono">
        alias {row.alias} · {row.timestamp} · {row.durationMs}ms · {fmtN(row.requestTokens)} in /{" "}
        {row.isError ? "0" : fmtN(row.responseTokens)} out
        {row.isError ? " · isError true" : ""}
      </div>
    </div>
  );
}

interface TrafficTableProps {
  rows: TrafficRow[];
  expandedId: string | null;
  onToggle: (id: string) => void;
}

export function TrafficTable({ rows, expandedId, onToggle }: TrafficTableProps) {
  const columns = useMemo<ColumnDef<typeof features, TrafficRow>[]>(
    () => [
      {
        id: "caret",
        header: "",
        cell: ({ row }) => {
          const isOpen = expandedId === row.original.id;
          return (
            <span
              className="caret"
              style={{ color: isOpen ? "var(--ink)" : "var(--graphite)", opacity: isOpen ? 1 : 0.55 }}
            >
              {isOpen ? "−" : "+"}
            </span>
          );
        },
      },
      {
        id: "time",
        header: "time",
        cell: ({ row }) => (
          <span className="mono" style={{ fontSize: ".735rem", color: "var(--graphite)" }}>
            {fmtTime(row.original.timestamp).hms}
            <span className="t-ms">{fmtTime(row.original.timestamp).ms}</span>
          </span>
        ),
      },
      {
        id: "alias",
        header: "server",
        cell: ({ row }) => (
          <span className="mono" style={{ fontSize: ".735rem", color: "var(--ink)" }}>
            {row.original.alias}
          </span>
        ),
      },
      {
        id: "tool",
        header: "tool",
        cell: ({ row }) => (
          <span
            className="mono"
            style={{
              fontSize: ".755rem",
              color: "var(--ink)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.original.toolName}
          </span>
        ),
      },
      {
        id: "latency",
        header: "latency",
        cell: ({ row }) => <LatencyCell durationMs={row.original.durationMs} />,
      },
      {
        id: "tokens",
        header: "tokens",
        cell: ({ row }) => (
          <span className="mono tok" style={{ fontSize: ".735rem", color: "var(--graphite)" }}>
            {fmtN(row.original.requestTokens)}
            <span style={{ color: "var(--rule-strong)" }}> / </span>
            <span style={{ color: "var(--ink)" }}>
              {row.original.isError ? "—" : fmtN(row.original.responseTokens)}
            </span>
          </span>
        ),
      },
      {
        id: "mark",
        header: "mark",
        cell: ({ row }) => (
          <span className={`mark ${row.original.isError ? "mark-err" : "mark-ok"}`}>
            {row.original.isError ? "err" : "ok"}
          </span>
        ),
      },
    ],
    [expandedId],
  );

  const table = useTable({ features, data: rows, columns, getRowId: (r) => r.id });

  const parentRef = useRef<HTMLDivElement>(null);
  const tableRows = table.getRowModel().rows;
  const headerCells = table.getHeaderGroups()[0]?.headers ?? [];

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 12,
    // Rows resize when their drawer opens/closes, so measure rather than assume a fixed height.
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  return (
    <>
      <div style={{ padding: "0 clamp(1.1rem, 2.4vw, 1.9rem)" }}>
        <div className="thead">
          {headerCells.map((header) => (
            <span
              key={header.id}
              className={header.column.id === "tokens" ? "cap tok" : "cap"}
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {flexRender(header.column.columnDef.header, header.getContext())}
            </span>
          ))}
        </div>
        <div className="rule-h" />
      </div>

      <div
        ref={parentRef}
        style={{ flex: 1, overflowY: "auto", padding: "0 clamp(1.1rem, 2.4vw, 1.9rem) 1rem" }}
      >
        <div style={{ position: "relative", height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = tableRows[virtualRow.index];
            if (!row) return null;
            const data = row.original;
            const isOpen = expandedId === data.id;

            return (
              <div
                key={row.id}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                className="trow-wrap"
                data-err={data.isError ? "" : undefined}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <button
                  type="button"
                  className="trow rowin"
                  data-open={isOpen ? "" : undefined}
                  data-err={data.isError ? "" : undefined}
                  onClick={() => onToggle(data.id)}
                >
                  {row.getAllCells().map((cell) => (
                    // display:contents keeps this wrapper (needed only for the
                    // React key) out of the grid -- its child becomes the real
                    // grid item, same as the prototype's un-wrapped cells. A
                    // wrapper that stayed a grid item shrank to the tool
                    // column's near-zero mobile width without clipping its
                    // text, since only the un-styled wrapper -- not the styled
                    // child -- actually sat in that track.
                    <span
                      key={cell.id}
                      className={cell.column.id === "tokens" ? "tok" : undefined}
                      style={{ display: "contents" }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </span>
                  ))}
                </button>
                {isOpen && <TrafficDrawer row={data} />}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
