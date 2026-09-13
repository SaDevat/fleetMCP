import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";

import { Sidebar, SidebarInset, SidebarProvider } from "@/ui/components/ui/sidebar.tsx";
import { NotFound } from "@/ui/components/not-found.tsx";
import { store } from "@/ui/store.ts";

const ROUTES = ["servers", "inspect", "call", "traffic", "test"] as const;
type Route = (typeof ROUTES)[number];

const NAV: { route: Route; label: string }[] = [
  { route: "servers", label: "Servers" },
  { route: "inspect", label: "Inspect" },
  { route: "call", label: "Call" },
  { route: "traffic", label: "Traffic" },
  { route: "test", label: "Test" },
];

// A page's own ui imports its ./api -- injection happens when the lazy chunk
// loads, so nothing here imports pages/*/api.ts for effect.
const LAZY_PAGES: Record<Route, ComponentType> = {
  servers: lazy(() => import("@/ui/pages/servers/index.ts").then((m) => ({ default: m.ServersPage }))),
  inspect: lazy(() => import("@/ui/pages/inspect/index.ts").then((m) => ({ default: m.InspectPage }))),
  call: lazy(() => import("@/ui/pages/call/index.ts").then((m) => ({ default: m.CallPage }))),
  traffic: lazy(() => import("@/ui/pages/traffic/index.ts").then((m) => ({ default: m.TrafficPage }))),
  test: lazy(() => import("@/ui/pages/test/index.ts").then((m) => ({ default: m.TestPage }))),
};

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash.replace(/^#\/?/, ""));

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash.replace(/^#\/?/, ""));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return hash;
}

function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value);
}

// Landing on /ui with no hash is the common case, not a wrong turn -- it must
// resolve to a real view rather than the not-found state.
const DEFAULT_ROUTE: Route = "servers";

/** { servers, totalRequests } from the proxy's existing GET / summary --
 * no dedicated endpoint exists yet for this, so the sidebar footer reuses it. */
function useFleetStatus(): { servers: number | null; retained: number | null } {
  const [status, setStatus] = useState<{ servers: number | null; retained: number | null }>({
    servers: null,
    retained: null,
  });

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/");
        if (!res.ok) return;
        const body = (await res.json()) as { servers: number; totalRequests: number };
        if (!cancelled) setStatus({ servers: body.servers, retained: body.totalRequests });
      } catch {
        // Sidebar chrome degrades to "—"; not worth surfacing an error for.
      }
    };
    void poll();
    const id = setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return status;
}

function PageFallback() {
  return (
    <div className="mono" style={{ padding: "2rem", color: "var(--graphite)" }}>
      loading…
    </div>
  );
}

function Main() {
  const hash = useHashRoute();
  const route = hash === "" ? DEFAULT_ROUTE : hash;
  const Page = isRoute(route) ? LAZY_PAGES[route] : null;
  const status = useFleetStatus();

  return (
    <SidebarProvider
      style={{ "--sidebar-width": "186px" } as React.CSSProperties}
      className="min-h-screen"
    >
      <div className="plate" style={{ margin: "clamp(.7rem,2.2vw,1.6rem)", flex: 1 }}>
        <span className="plate-tick plate-tick-tl" />
        <span className="plate-tick plate-tick-tr" />
        <span className="plate-tick plate-tick-bl" />
        <span className="plate-tick plate-tick-br" />

        <div className="shell">
          {/* Sidebar: collapsible="none" -- the prototype's responsive behavior is
           * a CSS media-query rail (below), not an overlay drawer, so the
           * shadcn Sheet mobile mode isn't used here. */}
          <Sidebar collapsible="none" className="sidebar">
            <div>
              <div style={{ paddingLeft: "1.15rem" }}>
                <div className="sidebar-wordmark">FleetMCP</div>
                <div className="mono sidebar-caption">fleetmcp ui · :{window.location.port}</div>
              </div>
              <div className="rule-h" style={{ margin: "1.2rem 0 1rem" }} />
              <nav style={{ display: "flex", flexDirection: "column" }}>
                {NAV.map(({ route: navRoute, label }) => (
                  <a key={navRoute} className="nav-i" data-on={route === navRoute ? "" : undefined} href={`#/${navRoute}`}>
                    {label}
                  </a>
                ))}
              </nav>
            </div>
            <div style={{ paddingLeft: "1.15rem" }}>
              <div className="rule-h" style={{ marginBottom: ".85rem" }} />
              <div className="mono sidebar-stats">
                <div>{status.servers ?? "—"} servers up</div>
                <div>
                  sqlite · <span style={{ color: "var(--ink)" }}>{status.retained ?? "—"}</span> retained
                </div>
              </div>
            </div>
          </Sidebar>

          {/* mobile nav -- shown only at <=880px via .navbar's media query */}
          <div className="navbar" style={{ padding: "1.1rem clamp(1.1rem,2.4vw,1.9rem) 0" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem" }}>
              <span className="font-display" style={{ fontSize: "1rem", color: "var(--ink)" }}>
                FleetMCP
              </span>
              <span className="mono" style={{ fontSize: ".645rem", color: "var(--graphite)" }}>
                :{window.location.port} · {status.retained ?? "—"} retained
              </span>
            </div>
            <nav style={{ marginTop: ".5rem" }}>
              {NAV.map(({ route: navRoute, label }) => (
                <a key={navRoute} className="nav-i" data-on={route === navRoute ? "" : undefined} href={`#/${navRoute}`}>
                  {label}
                </a>
              ))}
            </nav>
            <div className="rule-h-strong" style={{ marginTop: ".2rem" }} />
          </div>

          <SidebarInset className="main" style={{ minWidth: 0 }}>
            {Page ? (
              <Suspense fallback={<PageFallback />}>
                <Page />
              </Suspense>
            ) : (
              <NotFound title="Not found" detail={`No view for "#/${hash}".`} />
            )}
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

createRoot(rootEl).render(
  <Provider store={store}>
    <Main />
  </Provider>,
);
