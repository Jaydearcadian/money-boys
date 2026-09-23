import { useEffect, useState } from "react";
import { fetchState, type DeskState } from "./lib/api";
import { LandingPage } from "./pages/Landing";
import { DeskPage } from "./pages/Desk";

function route(): string {
  return window.location.hash.startsWith("#/desk") ? "desk" : "landing";
}

export default function App() {
  const [r, setR] = useState(route());
  const [desk, setDesk] = useState<DeskState | null>(null);
  useEffect(() => {
    const onHash = () => setR(route());
    window.addEventListener("hashchange", onHash);
    fetchState().then(setDesk).catch(() => { /* landing renders without engine */ });
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  if (r === "desk") return <DeskPage />;
  return <LandingPage latest={desk?.latestReceipt ?? null} />;
}
