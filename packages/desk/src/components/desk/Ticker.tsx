const TICKER = [
  { t: "rNVDAUSDT", mid: 132.5, close: 128.8, raw: 2.87, drag: 0.73, edge: 2.14, badge: "SELL BASIS", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  { t: "rTSLAUSDT", mid: 214.2, close: 218.0, raw: -1.74, drag: 0.72, edge: 1.02, badge: "BUY BASIS", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  { t: "rAAPLUSDT", mid: 224.1, close: 224.2, raw: -0.04, drag: 0.38, edge: -0.42, badge: "NEUTRAL", cls: "border-zinc-200 bg-zinc-100 text-zinc-600" },
  { t: "rMSFTUSDT", mid: 432.8, close: 428.5, raw: 1.0, drag: 0.45, edge: 0.55, badge: "NEUTRAL", cls: "border-zinc-200 bg-zinc-100 text-zinc-600" },
];

export function BasisTickerboard() {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Live synthetic basis spreads (24/7 tokenized equities)</h2>
        <span className="inline-flex items-center gap-2 font-mono text-xs text-orange-600"><span className="inline-block h-2 w-2 animate-pulse rounded-full bg-orange-500" />LIVE</span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full font-mono text-xs tabular-nums text-zinc-950">
          <thead><tr className="text-left text-zinc-500"><th>TICKER</th><th>TOKEN MID</th><th>FRIDAY CLOSE (MCP)</th><th>RAW BASIS %</th><th>HURDLE DRAG %</th><th>NET EDGE</th><th>STATUS ACTION</th></tr></thead>
          <tbody>
            {TICKER.map((r) => (
              <tr key={r.t} className="border-t border-zinc-200">
                <td className="py-2 font-bold">{r.t}</td>
                <td>${r.mid.toFixed(2)}</td><td>${r.close.toFixed(2)}</td>
                <td>{r.raw > 0 ? "+" : ""}{r.raw.toFixed(2)}%</td><td>{r.drag.toFixed(2)}%</td>
                <td>{r.edge > 0 ? "+" : ""}{r.edge.toFixed(2)}%</td>
                <td><span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${r.cls}`}>{r.badge}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
