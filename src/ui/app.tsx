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
import { ServersView } from "@/ui/views/servers";
import { InspectView } from "@/ui/views/inspect";
import { CallView } from "@/ui/views/call";
import { TrafficView } from "@/ui/views/traffic";
import { TestView } from "@/ui/views/test";
import { store } from "@/ui/store";
// Imported for effect: each module injects its endpoints into the api slice.
import "@/ui/api/traffic";
import "@/ui/api/servers";
import "@/ui/api/call";
import "@/ui/api/test";

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

// Landing on /ui with no hash is the common case, not a wrong turn -- it must
// resolve to a real view rather than the not-found state.
const DEFAULT_ROUTE: Route = "servers";

function Main() {
  const hash = useHashRoute();
  const route = hash === "" ? DEFAULT_ROUTE : hash;
  const View = isRoute(route) ? VIEWS[route] : null;

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
                {NAV.map(({ route: navRoute, label }) => (
                  <SidebarMenuItem key={navRoute}>
                    <SidebarMenuButton asChild isActive={route === navRoute}>
                      <a href={`#/${navRoute}`}>{label}</a>
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
