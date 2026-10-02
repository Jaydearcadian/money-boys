# QUARANTINE — nothing in this folder is performance evidence

Every artifact here is derived from `FRIDAY_CLOSE_SNAPSHOT`, a **hardcoded
table** in `packages/engine/src/agents/benchmarks.ts`, combined with
hand-authored scenario inputs and a seeded PRNG. **No market data was used.**

`alpha_factory_summary.json` reported `winRatePct: 100` and
`maxDrawdownPct: 0` across 29 trades. Those figures are properties of the
fixture's P&L arithmetic, not of any strategy. Its baseline
(`rNVDAUSDT: 128.8`, dated 2026-09-18) also disagrees with the live market
(NVDA ~234.6 on 2026-10-02), so the dislocation it measures is an artifact of a
wrong constant.

`live_paper_daemon.jsonl` records `priceSource: "LOCAL_SNAPSHOT"` with
`tokenPrice: 130.73` — stale and not venue-derived.

| File | What it is | Admissible as validation? |
|---|---|---|
| `alpha_factory_summary.json` | Scenario-replay metrics over a fabricated baseline | **No** |
| `alpha_factory_backtest.jsonl` | The 42 deliberations behind those metrics | **No** |
| `live_paper_daemon.jsonl` | Unattended PAPER daemon, snapshot-priced, wrong level | **No** |
| `paper_trades.jsonl` | Paper trades from the same synthetic pipeline | **No** |
| `performance_summary.json` | Same pipeline | **No** |

None of these satisfies Track 1's requirement for a backtest record
(≥60 days, ≥30 days out-of-sample). **Do not submit any of them.**

Replaced-by work is tracked as GAP-021: a real historical data pipeline, an
honest out-of-sample split, and Sharpe/Sortino/maxDrawdown/turnover computed
from actual rToken and underlying prices.
