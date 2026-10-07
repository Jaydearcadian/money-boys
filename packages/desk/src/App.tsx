import { useEffect, useState } from "react";
import { fetchState, type DeskState } from "./lib/api";
import { LandingPage } from "./pages/Landing";
import { DeskPage } from "./pages/Desk";
import { EvidencePage } from "./pages/Evidence";
import { LandingV2 } from "./pages/landing-v2/LandingV2";
import { Track1Page } from "./pages/track1/Track1Page";
import { Track2Page } from "./pages/track2/Track2Page";
import { Track3Page } from "./pages/track3/Track3Page";
import { ReproPage } from "./pages/repro/ReproPage";

type Route = "desk" | "evidence" | "landing" | "v1" | "track1" | "track2" | "track3" | "copilot" | "repro";

function route(): Route {
  const h = window.location.hash;
  if (h.startsWith("#/desk")) return "desk";
  if (h.startsWith("#/evidence")) return "evidence";
  if (h.startsWith("#/track1")) return "track1";
  if (h.startsWith("#/track2")) return "track2";
  if (h.startsWith("#/track3")) return "track3";
  if (h.startsWith("#/copilot")) return "copilot";
  if (h.startsWith("#/repro")) return "repro";
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
  if (r === "track1") return <Track1Page />;
  if (r === "track2") return <Track2Page />;
  if (r === "track3" || r === "copilot") return <Track3Page />;
  if (r === "repro") return <ReproPage />;
  if (r === "v1") return <LandingPage latest={desk?.latestReceipt ?? null} />;
  return <LandingV2 desk={desk} />;
}
