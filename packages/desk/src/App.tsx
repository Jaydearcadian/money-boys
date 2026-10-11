import { useEffect, useState } from "react";
import { HomePage } from "./pages/home/HomePage";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import type { TabId } from "./pages/dashboard/state";

type Route = { page: "home" } | { page: "dashboard"; tab: TabId };

function parseRoute(): Route {
  const h = window.location.hash;
  if (h.startsWith("#/sandbox")) return { page: "dashboard", tab: "sandbox" };
  if (h.startsWith("#/strategy") || h.startsWith("#/alpha")) return { page: "dashboard", tab: "strategy" };
  if (h.startsWith("#/copilot")) return { page: "dashboard", tab: "copilot" };
  if (h.startsWith("#/audit") || h.startsWith("#/receipts") || h.startsWith("#/logs")) return { page: "dashboard", tab: "audit" };
  if (h.startsWith("#/council") || h.startsWith("#/app") || h.startsWith("#/dashboard") || h.startsWith("#/cockpit")) {
    return { page: "dashboard", tab: "cockpit" };
  }
  return { page: "home" };
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseRoute());

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (route.page === "dashboard") {
    return <DashboardPage initialTab={route.tab} />;
  }
  return <HomePage />;
}
