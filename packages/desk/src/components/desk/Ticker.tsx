import { TrendingUpIcon, ActivityIcon } from "../icons";

interface TickerRow {
  symbol: string;
  name: string;
  mid: number;
  close: number;
  raw: number;
  drag: number;
  edge: number;
  badge: "SELL BASIS" | "BUY BASIS" | "NEUTRAL";
  actionColor: string;
}

const TICKER_DATA: TickerRow[] = [
  {
    symbol: "rNVDAUSDT",
    name: "NVIDIA Corp. Reality rToken",
    mid: 132.5,
    close: 128.8,
    raw: 2.87,
    drag: 0.73,
    edge: 2.14,
    badge: "SELL BASIS",
    actionColor: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  {
    symbol: "rTSLAUSDT",
    name: "Tesla Inc. Reality rToken",
    mid: 214.2,
    close: 218.0,
    raw: -1.74,
    drag: 0.72,
    edge: 1.02,
    badge: "BUY BASIS",
    actionColor: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  {
    symbol: "rAAPLUSDT",
    name: "Apple Inc. Reality rToken",
    mid: 224.1,
    close: 224.2,
    raw: -0.04,
    drag: 0.38,
    edge: -0.42,
    badge: "NEUTRAL",
    actionColor: "border-zinc-200 bg-zinc-100 text-zinc-600",
  },
  {
    symbol: "rMSFTUSDT",
    name: "Microsoft Corp. Reality rToken",
    mid: 432.8,
    close: 428.5,
    raw: 1.0,
    drag: 0.45,
    edge: 0.55,
    badge: "NEUTRAL",
    actionColor: "border-zinc-200 bg-zinc-100 text-zinc-600",
  },
];

export function BasisTickerboard() {
  return (
    <section 
      aria-labelledby="basis-spreads-heading" 
      className="rounded-3xl border border-zinc-200/80 bg-white p-6 sm:p-8 shadow-sm transition-all duration-300 hover:shadow-md"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-100 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/80 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-700">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              LIVE SYNTHETIC BASIS ENGINE
            </span>
            <span className="font-mono text-xs text-zinc-400 hidden sm:inline">|</span>
            <span className="font-mono text-xs text-zinc-500 hidden sm:inline">Bitget v2 Market Feed</span>
          </div>
          <h2 id="basis-spreads-heading" className="mt-2 text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">
            Tokenized Equity Basis Spreads
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Real-time dislocation tracking against TradFi Friday close benchmark. Orders require positive net edge above execution drag.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="#/desk"
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-2 font-sans text-xs font-semibold text-white shadow-sm transition-all duration-150 hover:bg-zinc-800 active:scale-95"
          >
            <ActivityIcon className="h-3.5 w-3.5 text-emerald-400" />
            Open Orderbook Depth
          </a>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left font-mono text-xs tabular-nums text-zinc-900">
          <thead>
            <tr className="border-b border-zinc-200/80 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              <th scope="col" className="pb-3 pr-4">Ticker / Contract</th>
              <th scope="col" className="pb-3 px-4">Token Mid</th>
              <th scope="col" className="pb-3 px-4">Friday Close (MCP)</th>
              <th scope="col" className="pb-3 px-4">Raw Basis %</th>
              <th scope="col" className="pb-3 px-4">Hurdle Drag</th>
              <th scope="col" className="pb-3 px-4">Net Edge</th>
              <th scope="col" className="pb-3 pl-4 text-right">Status Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {TICKER_DATA.map((row) => (
              <tr 
                key={row.symbol} 
                className="group transition-colors duration-150 hover:bg-zinc-50/80"
              >
                <td className="py-4 pr-4">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-100 font-sans text-xs font-bold text-zinc-800 group-hover:bg-zinc-200">
                      {row.symbol.slice(1, 3)}
                    </div>
                    <div>
                      <span className="block font-bold tracking-tight text-zinc-950">{row.symbol}</span>
                      <span className="block font-sans text-[11px] text-zinc-500">{row.name}</span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 font-semibold text-zinc-900">
                  ${row.mid.toFixed(2)}
                </td>
                <td className="px-4 py-4 text-zinc-600">
                  ${row.close.toFixed(2)}
                </td>
                <td className="px-4 py-4">
                  <span className={`font-semibold ${row.raw > 0 ? "text-emerald-600" : row.raw < 0 ? "text-rose-600" : "text-zinc-600"}`}>
                    {row.raw > 0 ? "+" : ""}{row.raw.toFixed(2)}%
                  </span>
                </td>
                <td className="px-4 py-4 text-zinc-500">
                  {row.drag.toFixed(2)}%
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold ${row.edge > 0.5 ? "text-emerald-700" : "text-zinc-600"}`}>
                      {row.edge > 0 ? "+" : ""}{row.edge.toFixed(2)}%
                    </span>
                    {row.edge > 0.5 && (
                      <span className="inline-flex text-emerald-500">
                        <TrendingUpIcon className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-4 pl-4 text-right">
                  <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide ${row.actionColor}`}>
                    {row.badge}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-zinc-100 pt-4 font-sans text-xs text-zinc-500">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>Hurdle Formula: <code className="font-mono text-[11px] text-zinc-700">VWAP Slippage + 8h Funding + 2× Taker Fee</code></span>
          </span>
        </div>
        <div className="font-mono text-[11px] text-zinc-400">
          Last Snapshot: Fri 20:00 UTC (Wall St Close)
        </div>
      </div>
    </section>
  );
}
