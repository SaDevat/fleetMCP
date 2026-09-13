import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/ui/components/ui/sidebar";
import { NotFound } from "@/ui/components/not-found";
import { store } from "@/ui/store";

const ROUTES = ["servers", "inspect", "call", "traffic", "test"] as const;
type Route = (typeof ROUTES)[number];

const NAV: { route: Route; label: string }[] = [
  { route: "servers", label: "Servers" },
  { route: "inspect", label: "Inspect" },
  { route: "call", label: "Call" },
  { route: "traffic", label: "Traffic" },
  { route: "test", label: "Test" },
];

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash.replace(/^#\/?/, ""));

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash.replace(/^#\/?/, ""));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return hash;
}

function ServersView() {
  return (
    <div className="p-8">
      <h1 className="font-display text-xl text-ink">Servers</h1>
      <p className="mt-2 text-graphite">Connected MCP servers will be listed here.</p>
    </div>
  );
}

function InspectView() {
  return (
    <div className="p-8">
      <h1 className="font-display text-xl text-ink">Inspect</h1>
      <p className="mt-2 text-graphite">Browse tools, resources, and prompts exposed by a server.</p>
    </div>
  );
}

function CallView() {
  return (
    <div className="p-8">
      <h1 className="font-display text-xl text-ink">Call</h1>
      <p className="mt-2 text-graphite">Invoke a tool call and inspect its result.</p>
    </div>
  );
}

function TrafficView() {
  return (
    <div className="p-8">
      <h1 className="font-display text-xl text-ink">Traffic</h1>
      <p className="mt-2 text-graphite">A live log of calls proxied through FleetMCP.</p>
    </div>
  );
}

function TestView() {
  return (
    <div className="p-8">
      <h1 className="font-display text-xl text-ink">Test</h1>
      <p className="mt-2 text-graphite">Run compliance checks against a configured server.</p>
    </div>
  );
}

const VIEWS: Record<Route, () => React.JSX.Element> = {
  servers: ServersView,
  inspect: InspectView,
  call: CallView,
  traffic: TrafficView,
  test: TestView,
};

function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value);
}

function Main() {
  const hash = useHashRoute();
  const View = isRoute(hash) ? VIEWS[hash] : null;

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <span className="font-display px-2 text-lg text-ink">FleetMCP</span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map(({ route, label }) => (
                  <SidebarMenuItem key={route}>
                    <SidebarMenuButton asChild isActive={hash === route}>
                      <a href={`#/${route}`}>{label}</a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <main>
          {View ? (
            <View />
          ) : (
            <NotFound title="Not found" detail={`No view for "#/${hash}".`} />
          )}
        </main>
      </SidebarInset>
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
