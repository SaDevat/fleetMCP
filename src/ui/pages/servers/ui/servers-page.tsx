import { useRef, useState } from "react";
import { PenLine, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/ui/shared/api/index.ts";
import { Button } from "@/ui/components/ui/button.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/components/ui/alert-dialog.tsx";
import { useDeleteServerMutation, useGetServersQuery, useImportServersMutation, type ServerEntry } from "../api.ts";
import { closeDeleteConfirm, openAddForm, openDeleteConfirm, openEditForm, selectDeleteAlias } from "../model.ts";
import { ServerFormDialog } from "./server-form-dialog.tsx";
import "./servers.css";

function dotColor(entry: ServerEntry): string {
  if (entry.connected) return "var(--success)";
  if (entry.health === "missing") return "var(--warning)";
  return "var(--graphite)";
}

function connectionString(entry: ServerEntry): string {
  if (entry.type === "http") return entry.url ?? "";
  return [entry.command, ...(entry.args ?? [])].filter(Boolean).join(" ");
}

export function ServersPage() {
  const dispatch = useAppDispatch();
  const { data, isLoading } = useGetServersQuery();
  const [deleteServer] = useDeleteServerMutation();
  const [importServers] = useImportServersMutation();
  const deleteAlias = useAppSelector(selectDeleteAlias);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const servers = data?.servers ?? [];
  const connectedCount = servers.filter((s) => s.connected).length;

  const onExport = async (target: "claude" | "cursor") => {
    const res = await fetch(`/api/servers/export?target=${target}`);
    const body = await res.json();
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fleetmcp-${target}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { mcpServers?: Record<string, unknown> };
      const result = await importServers({ mcpServers: parsed.mcpServers ?? {} }).unwrap();
      setImportMsg(`imported ${result.added.length}, skipped ${result.skipped.length}`);
    } catch {
      setImportMsg("import failed — expected a Claude/Cursor config file");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, height: "100%" }}>
      {/* header */}
      <div style={{ padding: "1.5rem clamp(1.1rem, 2.4vw, 1.9rem) 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: ".85rem", flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: ".72rem", letterSpacing: ".16em", textTransform: "uppercase", color: "var(--graphite)" }}>
            §1
          </span>
          <h1 className="font-display" style={{ margin: 0, fontSize: "1.42rem", letterSpacing: "-.008em", color: "var(--ink)" }}>
            Servers
          </h1>
          <span className="mono" style={{ fontSize: ".7rem", color: "var(--graphite)" }}>
            — the registry both the CLI and the UI read
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="fchip" data-on="" onClick={() => dispatch(openAddForm())}>
            + add server
          </button>
        </div>
        <p style={{ margin: ".7rem 0 0", color: "var(--graphite)", fontSize: ".95rem", lineHeight: 1.55, maxWidth: "40rem" }}>
          Every sub-server fleetmcp knows about, in one place. Edits here write straight to{" "}
          <span style={{ color: "var(--ink)" }}>~/.fleetmcp/config.yml</span> — the same file{" "}
          <span className="mono">fleetmcp config</span> uses.
        </p>
      </div>

      <div className="servers-page" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div style={{ padding: "1.2rem clamp(1.1rem, 2.4vw, 1.9rem) 0" }}>
          <div className="thead">
            <span className="cap" />
            <span className="cap">alias</span>
            <span className="cap th-type">type</span>
            <span className="cap">connection</span>
            <span className="cap" />
          </div>
          <div className="rule-h" />
        </div>

        {!isLoading && servers.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "3.2rem clamp(1.1rem, 2.4vw, 1.9rem)" }}>
            <div style={{ maxWidth: "30rem" }}>
              <div className="font-display-italic" style={{ color: "var(--ink)", lineHeight: 1.45 }}>
                No servers registered. The fleet is empty.
              </div>
              <p style={{ margin: ".85rem 0 0", color: "var(--graphite)", fontSize: ".95rem", lineHeight: 1.6 }}>
                Add one above, or from the CLI.
              </p>
              <div className="rule-h" style={{ margin: "1.4rem 0 1rem" }} />
              <div className="mono" style={{ fontSize: ".715rem", color: "var(--graphite)" }}>
                <span style={{ color: "var(--ink)" }}>fleetmcp config add my-server -t stdio -c bunx -a "-y @some/mcp-server"</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", padding: "0 clamp(1.1rem, 2.4vw, 1.9rem) 1rem", minHeight: 0 }}>
            {servers.map((entry) => (
              <div key={entry.alias} className="trow-wrap rowin">
                <div className="trow" style={{ cursor: "default" }}>
                  <span
                    style={{ width: 6, height: 6, borderRadius: "50%", display: "inline-block", background: dotColor(entry) }}
                  />
                  <span className="mono" style={{ fontSize: ".735rem", color: "var(--ink)" }}>
                    {entry.alias}
                  </span>
                  <span className="mark t-type">{entry.type}</span>
                  <span className="mono connection" style={{ fontSize: ".735rem", color: "var(--graphite)" }}>
                    {connectionString(entry)}
                  </span>
                  <span className="row-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`edit ${entry.alias}`}
                      onClick={() => dispatch(openEditForm(entry.alias))}
                    >
                      <PenLine size={13} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`delete ${entry.alias}`}
                      onClick={() => dispatch(openDeleteConfirm(entry.alias))}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* footer */}
      <div className="footer-stats">
        <span className="mono">
          <span style={{ color: "var(--ink)" }}>{servers.length}</span> registered
        </span>
        <span className="mono">
          <span style={{ color: "var(--ink)" }}>{connectedCount}</span> connected
        </span>
        <span style={{ flex: 1 }} />
        {importMsg && <span className="mono" style={{ color: "var(--graphite)" }}>{importMsg}</span>}
        <input ref={fileInputRef} type="file" accept="application/json" hidden onChange={onImportChange} />
        <button type="button" className="fchip" onClick={() => fileInputRef.current?.click()}>
          import
        </button>
        <button type="button" className="fchip" onClick={() => onExport("claude")}>
          export
        </button>
      </div>

      <ServerFormDialog />

      <AlertDialog open={deleteAlias !== null} onOpenChange={(open) => !open && dispatch(closeDeleteConfirm())}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteAlias}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes it from ~/.fleetmcp/config.yml. The proxy needs a restart to drop an active connection.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteAlias) void deleteServer(deleteAlias);
                dispatch(closeDeleteConfirm());
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
