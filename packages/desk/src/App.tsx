import { useEffect, useState } from "react";
import { fetchState, type DeskState } from "./lib/api";
import { LandingPage } from "./pages/Landing";
import { DeskPage } from "./pages/Desk";
import { EvidencePage } from "./pages/Evidence";
import { LandingV2 } from "./pages/landing-v2/LandingV2";

/**
 * Three surfaces, deliberately separate routes rather than tabs: a tab would
 * visually imply one pipeline with two panels, and these are not one pipeline.
 * #/evidence is the read-only benchmark pre-flight. #/desk is the Bitget Demo
 * venue lifecycle. Neither is connected end-to-end to the other.
 */
function route(): "desk" | "evidence" | "landing" | "v1" {
  const h = window.location.hash;
  if (h.startsWith("#/desk")) return "desk";
  if (h.startsWith("#/evidence")) return "evidence";
  if (h.startsWith("#/v1")) return "v1";
  return "landing";
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
  if (r === "evidence") return <EvidencePage />;
  if (r === "v1") return <LandingPage latest={desk?.latestReceipt ?? null} />;
  return <LandingV2 desk={desk} />;
}
