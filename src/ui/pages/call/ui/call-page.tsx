import { useAppDispatch, useAppSelector } from "@/ui/shared/api/index.ts";
import { useGetCallServersQuery, useGetServerToolsQuery } from "../api.ts";
import { selectServer, selectSelectedAlias, selectSelectedTool, selectTool } from "../model.ts";
import { ArgumentForm } from "./argument-form.tsx";
import "./call.css";

function dotColor(entry: { connected: boolean; health: string }): string {
  if (entry.connected) return "var(--success)";
  if (entry.health === "missing") return "var(--warning)";
  return "var(--graphite)";
}

export function CallPage() {
  const dispatch = useAppDispatch();
  const selectedAlias = useAppSelector(selectSelectedAlias);
  const selectedTool = useAppSelector(selectSelectedTool);

  const { data: serversData, isLoading: serversLoading } = useGetCallServersQuery();
  const { data: toolsData, isLoading: toolsLoading } = useGetServerToolsQuery(selectedAlias ?? "", { skip: !selectedAlias });

  const servers = serversData?.servers ?? [];
  const tools = toolsData?.tools ?? [];
  const activeTool = tools.find((t) => t.name === selectedTool);

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, height: "100%" }}>
      {/* header */}
      <div style={{ padding: "1.5rem clamp(1.1rem, 2.4vw, 1.9rem) 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: ".85rem", flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: ".72rem", letterSpacing: ".16em", textTransform: "uppercase", color: "var(--graphite)" }}>
            §3
          </span>
          <h1 className="font-display" style={{ margin: 0, fontSize: "1.42rem", letterSpacing: "-.008em", color: "var(--ink)" }}>
            Call
          </h1>
          <span className="mono" style={{ fontSize: ".7rem", color: "var(--graphite)" }}>
            — the cURL for MCP, in the browser
          </span>
        </div>
        <p style={{ margin: ".7rem 0 0", color: "var(--graphite)", fontSize: ".95rem", lineHeight: 1.55, maxWidth: "40rem" }}>
          Pick a server, pick a tool, fill in its arguments. Every call routes through the same warm connection pool as{" "}
          <span style={{ color: "var(--ink)" }}>/mcp</span> — it lands in Traffic like any other call.
        </p>
      </div>

      <div className="call-page">
        {/* pane 1: servers */}
        <div className="call-rail call-rail-servers">
          <div style={{ padding: "0 1rem" }}>
            <div className="thead">
              <span className="cap">server</span>
            </div>
            <div className="rule-h" />
          </div>
          <div className="call-rail-list" style={{ padding: "0 1rem" }}>
            {serversLoading && <p className="mono call-meta">loading…</p>}
            {!serversLoading && servers.length === 0 && <p className="mono call-meta">No servers registered.</p>}
            {servers.map((entry) => (
              <button
                key={entry.alias}
                type="button"
                className="trow"
                data-open={selectedAlias === entry.alias ? "" : undefined}
                onClick={() => dispatch(selectServer(entry.alias))}
              >
                <span style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", display: "inline-block", background: dotColor(entry) }} />
                  <span className="mono" style={{ fontSize: ".735rem", color: "var(--ink)" }}>
                    {entry.alias}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* pane 2: tools */}
        <div className="call-rail call-rail-tools">
          <div style={{ padding: "0 1rem" }}>
            <div className="thead">
              <span className="cap">tool</span>
            </div>
            <div className="rule-h" />
          </div>
          <div className="call-rail-list" style={{ padding: "0 1rem" }}>
            {!selectedAlias && <p className="mono call-meta">Select a server.</p>}
            {selectedAlias && toolsLoading && <p className="mono call-meta">loading…</p>}
            {selectedAlias && !toolsLoading && tools.length === 0 && <p className="mono call-meta">No tools.</p>}
            {tools.map((tool) => (
              <button
                key={tool.name}
                type="button"
                className="trow"
                data-open={selectedTool === tool.name ? "" : undefined}
                onClick={() => dispatch(selectTool(tool.name))}
              >
                <span className="mono" style={{ fontSize: ".735rem", color: "var(--ink)" }}>
                  {tool.name}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* pane 3: arguments + result */}
        <div className="call-form-pane">
          {!selectedAlias || !activeTool ? (
            <div style={{ padding: "3.2rem clamp(1.1rem, 2.4vw, 1.9rem)" }}>
              <div className="font-display-italic" style={{ color: "var(--ink)", lineHeight: 1.45, fontSize: "1.24rem" }}>
                {selectedAlias ? "Pick a tool to build the call." : "Nothing to call yet. Pick a server first."}
              </div>
              <p style={{ margin: ".85rem 0 0", color: "var(--graphite)", fontSize: ".95rem", lineHeight: 1.6 }}>
                <span className="mono">fleetmcp call &lt;alias&gt; &lt;tool&gt; key=value</span> works the same way from the CLI.
              </p>
            </div>
          ) : (
            <div style={{ padding: "1.4rem clamp(1.1rem, 2.4vw, 1.9rem) 2rem" }} key={activeTool.namespaced}>
              {activeTool.description && (
                <p className="mono call-meta" style={{ marginTop: 0 }}>
                  {activeTool.description}
                </p>
              )}
              <ArgumentForm alias={selectedAlias} tool={activeTool} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
