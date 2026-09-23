import { useEffect, useState } from "react";
import { API_BASE, fetchState, toggleHalt, simulateCycle, type DeskState } from "./lib/api";
import { Badge, fmtUsd, shortHash, ReceiptCard } from "./components/cards";
import type { SealedReasoningReceipt } from "./lib/api";

function num(n: unknown): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : "—";
}

export default function App() {
  const [desk, setDesk] = useState<DeskState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<SealedReasoningReceipt[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchState().then((s) => {
      if (cancelled) return;
      setDesk(s);
      if (s.latestReceipt) setFeed([s.latestReceipt]);
    }).catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    const es = new EventSource(API_BASE + "/api/desk/stream");
    es.addEventListener("message", (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
        if (msg["type"] === "INIT" && msg["state"]) setDesk(msg["state"] as DeskState);
        if (msg["type"] === "NEW_RECEIPT" && msg["receipt"]) {
          const r = msg["receipt"] as SealedReasoningReceipt;
          setDesk((prev) => (prev ? { ...prev, latestReceipt: r, recentCount: prev.recentCount + 1 } : prev));
          setFeed((prev) => [r, ...prev].slice(0, 20));
        }
        if (msg["type"] === "HALT_CHANGE") {
          setDesk((prev) => (prev ? { ...prev, systemHalt: Boolean(msg["systemHalt"]) } : prev));
        }
      } catch { /* noop */ }
    });
    return () => { cancelled = true; es.close(); };
  }, []);

  async function onHalt(): Promise<void> {
    if (!desk || busy) return;
    setBusy(true);
    try {
      const out = await toggleHalt(desk.systemHalt);
      setDesk({ ...desk, systemHalt: out.systemHalt });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSimulate(): Promise<void> {
    if (!desk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await simulateCycle();
      setFeed((prev) => [out.receipt, ...prev].slice(0, 20));
      setDesk(await fetchState());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const halt = desk?.systemHalt === true;
  const verdict = desk?.latestReceipt ? desk.latestReceipt.decision : "—";
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950" style={{ backgroundColor: "#FAF9F5" }}>
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">MONEY BOYS <span className="text-orange-600">/ OPERATOR CONSOLE</span></h1>
            <p className="font-mono text-xs text-zinc-500">Milk-and-Orange · engine :3001 · desk :3000</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge verdict={verdict} />
            <span className={halt ? "inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700" : "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700"}>{halt ? "HALTED" : "LIVE"}</span>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-4 px-6 py-6 md:grid-cols-3">
        <section className="rounded-none border border-zinc-200 bg-white p-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Account</h2>
          <div className="mt-2 font-mono text-2xl tabular-nums text-zinc-950">{desk ? fmtUsd(desk.account.equityUsd) : "—"}</div>
          <dl className="mt-3 space-y-1 font-mono text-xs tabular-nums">
            <div className="flex justify-between"><dt className="text-zinc-500">USED MARGIN</dt><dd>{desk ? fmtUsd(desk.account.usedMarginUsd) : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">FREE MARGIN</dt><dd>{desk ? fmtUsd(desk.account.freeMarginUsd) : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">MARGIN UTIL</dt><dd>{desk ? num(desk.account.marginUtilPct) + "%" : "—"}</dd></div>
          </dl>
          <div className="mt-4 flex gap-2">
            <button onClick={onSimulate} disabled={busy || halt} className="bg-orange-500 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white disabled:opacity-40">Simulate cycle</button>
            <button onClick={onHalt} disabled={busy} className="border border-zinc-200 px-3 py-2 text-xs font-bold uppercase tracking-wider">{halt ? "Resume" : "Halt"}</button>
          </div>
          {error && <p className="mt-2 font-mono text-xs text-rose-700">{error}</p>}
        </section>
        <section className="rounded-none border border-zinc-200 bg-white p-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Nodes</h2>
          <ul className="mt-2 space-y-2 font-mono text-xs tabular-nums">
            <li className="flex justify-between"><span>MACRO {desk?.activeNodes.macro.model}</span><span>{desk?.activeNodes.macro.status}</span></li>
            <li className="flex justify-between"><span>QUANT edge</span><span>{desk ? num(desk.activeNodes.quant.lastNetEdgePct) + "%" : "—"}</span></li>
            <li className="flex justify-between"><span>RISK util</span><span>{desk ? num(desk.activeNodes.risk.marginUtilizationPct) + "%" : "—"}</span></li>
            <li className="flex justify-between"><span>EXEC {desk?.activeNodes.exec.venue}</span><span>{desk?.activeNodes.exec.status}</span></li>
          </ul>
          <p className="mt-2 text-xs text-zinc-500">Catalyst: {desk?.activeNodes.macro.lastCatalyst ?? "—"}</p>
        </section>
        <section className="rounded-none border border-zinc-200 bg-white p-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Latest receipt</h2>
          <div className="mt-2"><ReceiptCard receipt={desk?.latestReceipt ?? null} /></div>
        </section>
        <section className="rounded-none border border-zinc-200 bg-white p-4 md:col-span-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Sealed receipt feed ({desk?.recentCount ?? 0})</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full font-mono text-xs tabular-nums">
              <thead><tr className="text-left text-zinc-500"><th className="py-1">SYMBOL</th><th>DECISION</th><th>SCORE</th><th>HASH</th><th>RATIONALE</th></tr></thead>
              <tbody>
                {feed.map((r) => (
                  <tr key={r.receiptId} className="border-t border-zinc-200">
                    <td className="py-1 text-zinc-950">{r.symbol}</td>
                    <td><Badge verdict={r.decision} /></td>
                    <td>{num((r.councilScores as Record<string, number>)["compositeScore"])}</td>
                    <td className="text-zinc-500">{shortHash(r.receiptHash)}</td>
                    <td className="max-w-md truncate text-zinc-600">{r.rationale}</td>
                  </tr>
                ))}
                {feed.length === 0 && <tr><td className="py-2 text-zinc-500">No receipts streamed yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

