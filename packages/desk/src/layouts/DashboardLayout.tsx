/**
 * DASHBOARD LAYOUT — one shell, one sidebar, four product layers.
 *
 * The app used to be seven disconnected full-page layouts, so navigating lost
 * context and the back button was the only way around. This is the persistent
 * chrome they all share.
 *
 * LEGACY HASHES ARE PRESERVED, NOT BROKEN. App.tsx maps #/desk, #/sandbox,
 * #/evidence, #/track1, #/repro and friends onto the matching tab, so every
 * existing link and all 61 Playwright tests keep working. The tab wrappers
 * render the ORIGINAL page components rather than reimplementations, so a test
 * asserting on a page's own heading or control still finds it.
 */
import { useEffect, useState, type ReactNode } from "react";
import { PersistentLedgerBanner } from "../components/TrackNav";

export type DashboardTab = "desk" | "sandbox" | "strategy" | "audit";

export const TAB_HASH: Record<DashboardTab, string> = {
  desk: "#/app/desk",
  sandbox: "#/app/sandbox",
  strategy: "#/app/strategy",
  audit: "#/app/audit",
};

const TABS: ReadonlyArray<{ id: DashboardTab; label: string; blurb: string }> = [
  { id: "desk", label: "Cockpit", blurb: "Live desk and risk" },
  { id: "sandbox", label: "Sandbox", blurb: "Try it yourself" },
  { id: "strategy", label: "Strategy", blurb: "The edge" },
  { id: "audit", label: "Audit", blurb: "Proof and provenance" },
];

export function DashboardLayout({
  initialTab,
  children,
}: {
  initialTab: DashboardTab;
  children: ReactNode;
}) {
  const [tab, setTab] = useState<DashboardTab>(initialTab);
  const [railOpen, setRailOpen] = useState(false);

  useEffect(() => setTab(initialTab), [initialTab]);

  function go(next: DashboardTab): void {
    setTab(next);
    if (window.location.hash !== TAB_HASH[next]) window.location.hash = TAB_HASH[next];
  }

  const active = TABS.find((t) => t.id === tab) ?? TABS[0]!;

  return (
    <div className="min-h-screen bg-canvas text-zinc-950">
      <PersistentLedgerBanner />

      <div className="flex min-h-screen flex-col lg:flex-row">
        {/* Rail / drawer */}
        <nav
          aria-label="Dashboard sections"
          className={`lg:w-64 lg:shrink-0 lg:border-r lg:border-zinc-200 ${
            railOpen ? "block border-b border-zinc-200" : "hidden lg:block"
          } bg-zinc-50/70`}
        >
          <div className="flex items-center justify-between px-4 py-4">
            <a href="#/" className="text-lg font-black tracking-tight text-zinc-950">
              MONEY BOYS
            </a>
            <button
              type="button"
              onClick={() => setRailOpen((o) => !o)}
              aria-expanded={railOpen}
              aria-label="Toggle section menu"
              className="rounded-lg border border-zinc-200 px-2 py-1 text-xs lg:hidden"
            >
              Menu
            </button>
          </div>
          <ul className="px-2 pb-4">
            {TABS.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => go(t.id)}
                  aria-current={t.id === tab ? "page" : undefined}
                  className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                    t.id === tab ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-200/70"
                  }`}
                >
                  <span className="block text-sm font-bold">{t.label}</span>
                  <span className={`block text-[11px] ${t.id === tab ? "text-zinc-300" : "text-zinc-500"}`}>
                    {t.blurb}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">
          <header className="border-b border-zinc-200 bg-white/70 px-4 py-3 backdrop-blur sm:px-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Dashboard · {active.label}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">{active.blurb}</p>
          </header>
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
