import { useState } from "react";
import { OnboardingModal } from "./OnboardingModal";

export function PersistentLedgerBanner() {
  return (
    <div className="border-b border-[var(--line)] bg-[oklch(0.12_0.012_265)] px-4 py-1.5 text-xs">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
          <span className="inline-flex h-2 w-2 rounded-full bg-[var(--accent)] animate-pulse" />
          <span className="mono font-semibold text-white">GOVERNANCE LEDGER:</span>
          <span className="mono text-[var(--text-muted)]">
            <strong className="text-white">17</strong> CLOSED · <strong className="text-[var(--warn)]">5</strong> OPEN/PARTIAL · <strong className="text-rose-400">1</strong> BLOCKED_EXTERNAL (GAP-019)
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-3">
          <a href="#/repro" className="mono text-[11px] text-[var(--accent)] hover:underline">
            View Provenance Audit →
          </a>
        </div>
      </div>
    </div>
  );
}

export function TrackNav({ current }: { current: "overview" | "track1" | "track2" | "track3" | "copilot" | "repro" | "desk" | "evidence" | "sandbox" }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  const links = [
    { id: "overview", hash: "#/", label: "Dashboard" },
    { id: "sandbox", hash: "#/sandbox", label: "Interactive Test" },
    { id: "track1", hash: "#/track1", label: "Track 1 (Quant)" },
    { id: "track2", hash: "#/track2", label: "Track 2 (Agentic 50/50)" },
    { id: "track3", hash: "#/track3", label: "Track 3 (Copilot)" },
    { id: "repro", hash: "#/repro", label: "Reproducibility" },
    { id: "desk", hash: "#/desk", label: "Trading Cockpit" },
    { id: "evidence", hash: "#/evidence", label: "Market Audit" },
  ] as const;

  return (
    <>
      <header className="sticky top-0 z-40 bg-[oklch(0.15_0.012_265_/_0.88)] backdrop-blur-md border-b border-[var(--line)]">
        <PersistentLedgerBanner />
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <a href="#/" className="flex items-center gap-2 font-extrabold tracking-tight text-white hover:opacity-90">
            <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="8" fill="oklch(0.20 0.015 265)" />
              <path d="M21 4a12 12 0 1 0 7 21.5A10 10 0 0 1 21 4Z" fill="oklch(0.80 0.17 160)" />
              <circle cx="23" cy="9" r="2" fill="oklch(0.82 0.15 80)" />
            </svg>
            <span className="text-base font-black tracking-wider">MONEY BOYS</span>
          </a>

          {/* Desktop nav tabs */}
          <nav aria-label="Track Navigation" className="hidden lg:flex items-center gap-1 rounded-full border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.7)] p-1">
            {links.map((l) => {
              const active = current === l.id;
              return (
                <a
                  key={l.id}
                  href={l.hash}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold transition-all ${
                    active
                      ? "bg-white text-[oklch(0.15_0.012_265)] shadow-sm"
                      : "text-[var(--text-muted)] hover:text-white"
                  }`}
                >
                  {l.label}
                </a>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTourOpen(true)}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[oklch(0.20_0.015_265)] px-3 py-1.5 text-xs font-bold text-zinc-200 hover:border-[var(--accent)] hover:text-white transition-colors cursor-pointer"
            >
              <span>✨</span>
              <span>Tour (60s)</span>
            </button>
            <a
              href="#/desk"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-1.5 text-xs font-bold text-zinc-950 hover:bg-emerald-300 transition-colors"
            >
              Open Cockpit
            </a>

            {/* Mobile hamburger */}
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="lg:hidden rounded-lg border border-[var(--line)] p-2 text-zinc-300 hover:text-white"
              aria-label="Toggle tracks menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {menuOpen ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div className="border-t border-[var(--line)] bg-[oklch(0.16_0.012_265)] px-4 py-3 lg:hidden">
            <nav className="flex flex-col gap-1.5">
              {links.map((l) => (
                <a
                  key={l.id}
                  href={l.hash}
                  onClick={() => setMenuOpen(false)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                    current === l.id ? "bg-white/10 text-white" : "text-[var(--text-muted)] hover:text-white"
                  }`}
                >
                  {l.label}
                </a>
              ))}
            </nav>
          </div>
        )}
      </header>
      <OnboardingModal isOpen={tourOpen} onClose={() => setTourOpen(false)} onOpenSandbox={() => { setTourOpen(false); window.location.hash = "#/sandbox"; }} />
    </>
  );
}
