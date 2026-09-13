import { useAppDispatch, useAppSelector } from "@/ui/shared/api/index.ts";
import { Button } from "@/ui/components/ui/button.tsx";
import {
  useGetServerAliasesQuery,
  useGetTestChecksQuery,
  useRunTestMutation,
  type CheckMeta,
  type CheckResult,
} from "../api.ts";
import { selectAlias, selectExpandedCheck, setAlias, toggleExpandedCheck } from "../model.ts";
import "./test.css";

/** Pairs a known check's metadata with its result, once one exists. */
function rowFor(check: CheckMeta, checks: CheckResult[] | undefined): CheckResult | undefined {
  return checks?.find((c) => c.name === check.name);
}

interface CheckRowProps {
  check: CheckMeta;
  result: CheckResult | undefined;
  pending: boolean;
  expanded: boolean;
  onToggle: () => void;
}

function CheckRow({ check, result, pending, expanded, onToggle }: CheckRowProps) {
  const failed = result !== undefined && !result.passed;

  const cells = (
    <>
      <span className="caret" style={{ color: expanded ? "var(--ink)" : "var(--graphite)", opacity: failed ? (expanded ? 1 : 0.55) : 0 }}>
        {failed ? (expanded ? "−" : "+") : ""}
      </span>
      <span className="mono" style={{ fontSize: ".735rem", color: "var(--ink)" }}>
        {check.name}
      </span>
      <span className="mono" style={{ fontSize: ".735rem", color: "var(--graphite)" }}>
        {result ? `${result.durationMs}ms` : "—"}
      </span>
      {pending ? (
        <span className="mono" style={{ fontSize: ".71rem", color: "var(--graphite)" }}>
          running…
        </span>
      ) : result ? (
        <span className={`mark ${result.passed ? "mark-ok" : "mark-err"}`}>{result.passed ? "ok" : "err"}</span>
      ) : (
        <span className="mark mark-ok" style={{ opacity: 0.4 }}>
          {"—"}
        </span>
      )}
    </>
  );

  if (failed) {
    return (
      <div className="trow-wrap" data-err="">
        <button type="button" className="trow" data-open={expanded ? "" : undefined} data-err="" onClick={onToggle}>
          {cells}
        </button>
        {expanded && (
          <div className="drawer">
            <pre>{result?.error ?? "No detail was returned for this failure."}</pre>
            <div className="drawer-meta mono">
              {check.name} · {result?.durationMs}ms
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="trow-wrap">
      <div className="trow" style={{ cursor: "default" }}>
        {cells}
      </div>
    </div>
  );
}

export function TestPage() {
  const dispatch = useAppDispatch();
  const alias = useAppSelector(selectAlias);
  const expandedCheck = useAppSelector(selectExpandedCheck);

  const { data: serversData, isLoading: serversLoading } = useGetServerAliasesQuery();
  const { data: checksMeta } = useGetTestChecksQuery();
  const [runTest, runState] = useRunTestMutation();

  const aliases = serversData?.map((s) => s.alias) ?? [];
  const hasStarted = !runState.isUninitialized;
  const pending = runState.isLoading;
  const result = runState.data;

  const onSelectAlias = (next: string) => {
    if (next !== alias) {
      dispatch(setAlias(next));
      runState.reset();
    }
  };

  const onRun = () => {
    if (!alias || pending) return;
    void runTest(alias);
  };

  const onToggle = (name: string) => dispatch(toggleExpandedCheck(name));

  const passed = result?.checks.filter((c) => c.passed).length;
  const total = checksMeta?.length ?? 5;

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, height: "100%" }}>
      {/* header */}
      <div style={{ padding: "1.5rem clamp(1.1rem, 2.4vw, 1.9rem) 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: ".85rem", flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: ".72rem", letterSpacing: ".16em", textTransform: "uppercase", color: "var(--graphite)" }}>
            §5
          </span>
          <h1 className="font-display" style={{ margin: 0, fontSize: "1.42rem", letterSpacing: "-.008em", color: "var(--ink)" }}>
            Test
          </h1>
          <span className="mono" style={{ fontSize: ".7rem", color: "var(--graphite)" }}>
            — compliance checks against a configured server
          </span>
          <span style={{ flex: 1 }} />
          <Button
            type="button"
            variant="outline"
            className="run-action run-action-primary"
            disabled={!alias || pending}
            onClick={onRun}
          >
            {pending ? "running…" : "run checks"}
          </Button>
        </div>
        <p style={{ margin: ".7rem 0 0", color: "var(--graphite)", fontSize: ".95rem", lineHeight: 1.55, maxWidth: "40rem" }}>
          Runs the same five checks as <span className="mono">fleetmcp test &lt;alias&gt;</span>: a connection
          handshake, tool discovery, schema integrity, error resilience, and unknown-tool rejection.
        </p>
      </div>

      {/* alias selector */}
      {aliases.length > 0 && (
        <div style={{ padding: "1.2rem clamp(1.1rem, 2.4vw, 1.9rem) 0" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "1.45rem", flexWrap: "wrap", paddingBottom: ".7rem" }}>
            <span className="cap">server</span>
            {aliases.map((a) => (
              <button
                key={a}
                type="button"
                className="fchip"
                data-on={alias === a ? "" : undefined}
                onClick={() => onSelectAlias(a)}
              >
                {a}
              </button>
            ))}
          </div>
          <div className="rule-h-strong" />
        </div>
      )}

      <div className="test-page" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        {!serversLoading && aliases.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "3.2rem clamp(1.1rem, 2.4vw, 1.9rem)" }}>
            <div style={{ maxWidth: "30rem" }}>
              <div className="font-display-italic" style={{ color: "var(--ink)", lineHeight: 1.45 }}>
                No servers registered. There is nothing to test yet.
              </div>
              <p style={{ margin: ".85rem 0 0", color: "var(--graphite)", fontSize: ".95rem", lineHeight: 1.6 }}>
                Register one from the Servers screen, then come back here.
              </p>
            </div>
          </div>
        ) : !hasStarted || !alias ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "3.2rem clamp(1.1rem, 2.4vw, 1.9rem)" }}>
            <div style={{ maxWidth: "30rem" }}>
              <div className="font-display-italic" style={{ color: "var(--ink)", lineHeight: 1.45 }}>
                Pick a server and run the checks. Nothing has been tested yet.
              </div>
              <div className="rule-h" style={{ margin: "1.4rem 0 1rem" }} />
              <div className="mono" style={{ fontSize: ".715rem", color: "var(--graphite)" }}>
                <span style={{ color: "var(--ink)" }}>fleetmcp test {alias ?? "<alias>"}</span>
              </div>
            </div>
          </div>
        ) : runState.isError ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "3.2rem clamp(1.1rem, 2.4vw, 1.9rem)" }}>
            <div style={{ maxWidth: "30rem" }}>
              <div className="font-display-italic" style={{ color: "var(--ink)", lineHeight: 1.45 }}>
                The run itself could not be reached.
              </div>
              <p style={{ margin: ".85rem 0 0", color: "var(--graphite)", fontSize: ".95rem", lineHeight: 1.6 }}>
                Check that the proxy is still up, then try again.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div style={{ padding: "0 clamp(1.1rem, 2.4vw, 1.9rem)" }}>
              <div className="thead">
                <span className="cap" />
                <span className="cap">check</span>
                <span className="cap">duration</span>
                <span className="cap">mark</span>
              </div>
              <div className="rule-h" />
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 clamp(1.1rem, 2.4vw, 1.9rem) 1rem", minHeight: 0 }}>
              {(checksMeta ?? []).map((check) => (
                <CheckRow
                  key={check.name}
                  check={check}
                  result={rowFor(check, result?.checks)}
                  pending={pending}
                  expanded={expandedCheck === check.name}
                  onToggle={() => onToggle(check.name)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* footer */}
      <div className="footer-stats">
        <span className="mono">
          <span style={{ color: "var(--ink)" }}>{passed ?? "—"}</span> of {total} passed
        </span>
        <span className="mono">
          total <span style={{ color: "var(--ink)" }}>{result ? `${result.totalDurationMs}ms` : "—"}</span>
        </span>
        <span style={{ flex: 1 }} />
        <span className="mono">mirrors fleetmcp test --ci</span>
      </div>
    </div>
  );
}
