# Money Boys

> **Research proposes. Quant calculates. Risk vetoes. Council decides. A receipt seals.
> Money Boys dispatches. The venue is read back.**

[![Live Web Cockpit](https://img.shields.io/badge/Live%20Cockpit-money--boys--neon.vercel.app-emerald?style=flat-square)](https://money-boys-neon.vercel.app)
[![Bitget API v2](https://img.shields.io/badge/Bitget%20API-v2%20Spot%2FMargin-cyan?style=flat-square)](https://www.bitget.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-Pure%20Zod%20%2B%20WebCrypto-blue?style=flat-square)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

Money Boys is an **autonomous 24/7 agentic trading desk for tokenized US equities (Real World Assets) on Bitget**.

👉 **Live Production URL:** [https://money-boys-neon.vercel.app](https://money-boys-neon.vercel.app)  
👉 **Live Tunnel Fallback:** [https://actress-scored-texture-bureau.trycloudflare.com](https://actress-scored-texture-bureau.trycloudflare.com)

*Warm-path cognitive research · Hot-path <50ms deterministic execution · Zero direct LLM keys*

Built for **quantitative desks, RWA basis arbitrageurs, risk auditors, and autonomous-systems evaluators.**

It is **not** an unconstrained LLM prompt. It is **not** a black-box bot. It is **not** a script trading without economic justification.

---

## 1. The Problem

**The structural 24/7 RWA dislocation.** TradFi cash equities (NYSE/Nasdaq) trade ~6.5h/day, 5 days/week. Tokenized equities (rTokens on Bitget) trade 24/7. Across the **65.5-hour weekend window** (Friday 16:00 ET → Monday 09:30 ET) the TradFi benchmark is frozen while the tokenized contract drifts — and retail flows move it.

**The agentic trading dilemma.**

- **Direct LLM execution fails.** LLMs hallucinate, are prompt-injectable, lack sub-second latency, and must never hold signing keys (**I-01**).
- **Naive scripts fail too.** Unconstrained mean-reversion without trend filtering suffers severe adverse-selection asymmetry: a high win rate can coexist with structurally negative expectancy.

**The resolution is a decoupled two-speed architecture** — LLM macro perception on the warm path; deterministic mathematics and hard risk ceilings on the sub-50ms hot path.

---

## 2. How It Works

The question the system answers on every cycle:

> Given a live tokenized-equity orderbook and a static TradFi benchmark — is there a genuine, cost-resilient basis dislocation? Does the regime support convergence? Does exposure clear deterministic risk limits? And can an immutable cryptographic receipt be sealed **before** any order touches Bitget?

```
┌─ WARM PATH ────────────────────────────────────────────────────────────┐
│  Macro Boy (Qwen / DashScope)   research, catalysts, macro regime      │
│  Quant Boy                      basis, friction hurdle, net edge       │
│         │                                                            │
│         ▼                                                            │
│  StrategyPacket { executable: false }   ← a PROPOSAL, never an order │
└────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─ HOT PATH ─────────────────────────────────────────────────────────────┐
│  Risk Boy      HARD_VETO — checked FIRST, returns early, unoutvoteable │
│  Council       4-node reducer + quorum                                │
│  Receipt       SHA-256 ReasoningReceipt sealed over canonical JSON     │
│  Dispatcher    verifies the seal, then calls Bitget v2                │
│  Venue         order placed → read back → position read back           │
└────────────────────────────────────────────────────────────────────────┘
```

**A vetoed packet can never reach the venue.** The Risk veto is evaluated before any scoring and returns early, so it is unreachable *by construction* — not checked-and-overridden.

---

## 3. Verified Quantitative Evidence

Anchored to a reproducible **89-day venue walk-forward backtest** over 5 rToken/equity pairs, real Bitget v2 daily candles matched to Alpha Vantage daily equity closes, with an explicit in-sample / out-of-sample split.

Source: `foundry/evidence/backtest/venue_backtest_summary.json`

| Metric | Full campaign (89d) | Out-of-sample (30d) | Verification |
|---|---|---|---|
| **Net realized P&L** | **+$1,228.83** (+4.92%) | **+$433.35** (+1.73%) | Reconciled to the exact cent across 150 trades |
| **Trade count** | 150 completed | 48 completed | Clears the ≥30 OOS observation gate |
| **Win rate** | 57.3% (86W / 64L) | 56.3% (27W / 21L) | Consistent with in-sample 57.8% |
| **Sharpe (daily, √252)** | 3.21 | **3.89** | Sortino 7.58 / 9.15 · decay **1.32×** vs the 0.5× IS floor |
| **Max drawdown** | 1.27% | 0.49% | Peak-to-trough, strictly bounded |
| **Turnover** | 24.00 (2,400%) | 7.68 | Costs modelled, not assumed |
| **Direct AI keys** | **0** | **0** | 100% of dispatches gated by a SHA-256 ReasoningReceipt |
| **Asset dispersion** | 5 pairs (NVDA, TSLA, AAPL, MSFT, GOOGL) | ρ̄ = 0.197, N_eff = 2.80 | See caveats |

### Caveats, stated before you find them

1. **Out-of-sample Sharpe exceeds in-sample** (3.89 vs 2.94). Atypical. The likely mechanism is **variance compression** from adding low-volatility pairs, not skill.
2. **Rolling 30-day Sharpe dispersion is 1.13–7.31** (6.5× spread, 34/34 windows positive). Regime-sensitive, **not stable**.
3. Sharpe is annualised from **64 daily observations** — a small sample.
4. **ρ̄ = 0.197 reflects asynchronous entry timing, not risk diversification.** All five pairs are long US mega-cap tech; **tail risk remains fully correlated.**
5. **N_eff = 2.80 is a derived heuristic**, not proof of orthogonal risk.
6. **Straddler sensitivity:** 5 trades entered in-sample and exited out-of-sample contributed **+$224.49**. Out-of-sample is **+$433.35 with them, +$208.86 without**.
7. 26 rToken dates had **no equity counterpart** (weekends/holidays) and were excluded rather than forward-filled — forward-filling would have manufactured basis.

### What the live monitor actually observed

Across a live monitoring run of **7,675 cycles** (snapshot as of 2026-10-08 10:02:32Z): **7,675 decisions, 0 dispatches, 100% vetoed.** Live basis never cleared the friction hurdle, so the desk did not trade. That is the system working, not failing.

---

## 4. Authority Model

| Component | May propose | May veto | May dispatch | Holds keys |
|---|---|---|---|---|
| **Macro Boy** (LLM) | Yes | No | **No** | **No** |
| **Quant Boy** | Yes | No | **No** | **No** |
| **Risk Boy** | No | **Yes — absolute** | **No** | **No** |
| **Council** | No | Yes (quorum) | **No** | **No** |
| **Dispatcher** | No | No | **Yes, only on a verified sealed receipt** | No — signs nothing itself |
| **Operator UI** | No | Yes (halt) | Authorises campaigns | **No** |

**Boundary vocabulary — the distinctions this project is built to keep:**

```
IMPLEMENTED        ≠ VERIFIED
VERIFIED LOCALLY   ≠ PROVEN LIVE
DEPLOYED           ≠ WORKING
DOCUMENTED         ≠ TRUE
PROPOSAL           ≠ AUTHORIZATION
SEALED RECEIPT     ≠ FILLED ORDER
PAPER              ≠ LIVE CAPITAL
```

---

## 4b. Independent Audit

A **Bitget GetAgent Studio audit** (`foundry/evidence/audit/andrew_studio_signoff.json`) signed off on **2026-10-08**.

**Disposition: APPROVED** for public Studio publication and continued Paper observation.

| Pillar | Status |
|---|---|
| Package identity (SHA-256 fingerprint vs published entity) | **PASS** — byte-level confirmed |
| Fee resilience (12bps round-trip taker, 2bps slippage) | **PASS** — net PF 1.735 clears modelled friction |
| Public Studio registry visibility | **PASS** |
| Statistical integrity | **CONDITIONAL_PASS** |

**Read the conditional honestly.** On a sample of **20 trades** (11 in holdout): net realized P&L **+$15.0067**, win rate **60.0%**, net profit factor **1.735**, expectancy **+$0.75/trade**. Edge persisted after dropping the largest winner (+$4.79, PF 1.44).

**This is a 20-trade Studio sample, not the 89-day backtest in §3, and it is not a substitute for it.** The auditor's own qualification: *"Small sample size (11 holdout trades); frozen 500-bar walk-forward remains validation boundary."*

**Operational constraints carried into publication:**

- No rebinding or version switching while the Paper account holds an open 1.26 NVDA contract
- Preserve Paper capital balance; do not reset capital during monitoring
- Active Paper position outperforming benchmark by +87bps

---

## 5. Product Surfaces & Hackathon Tracks

| Surface | Live Route | Track Alignment & Functionality |
|---|---|---|
| **Landing Page** | [`#/`](https://money-boys-neon.vercel.app/#/) | Moneliq obsidian hero, market hours gap clock, and 3-track overview |
| **Cockpit** | [`#/app`](https://money-boys-neon.vercel.app/#/app) | Live telemetry, 5 RWA asset cards (`rNVDA`, `rTSLA`, `rAAPL`, `rMSFT`, `rGOOGL`), 4-agent node matrix, and margin utilization gauge (<65%) |
| **Track 1: Alpha Factory** | [`#/strategy`](https://money-boys-neon.vercel.app/#/strategy) | **Track 1 (Quant / Alpha Factory):** 89-day walk-forward curve (+4.92% net return, +$1,228.83 USD), 3.89 OOS Sharpe vs 1.47 decay floor ($1.32\times$ retention), 48 OOS trades (clears $\ge 30$ gate), and 5x5 $\rho = 0.197$ correlation matrix |
| **Track 2: Agentic Trading** | [`#/audit`](https://money-boys-neon.vercel.app/#/audit) | **Track 2 (Agentic Execution):** Three-Beat timeline visualizer (`dispatched: false` on Beat 1, deterministic hard veto on Beat 2), live Bitget API v2 lifecycle proof card (Order ID `1491906882204499969`, 126.1ms fill), and verifiable SHA-256 receipt drawer |
| **Track 3: Portfolio Copilot** | [`#/copilot`](https://money-boys-neon.vercel.app/#/copilot) | **Track 3 (Portfolio Copilot):** Institutional factor ceilings ($\text{Beta} \le 2.50$, Sector concentration $\le 60\%$) and interactive pre-trade Blast Radius simulator powered live by `PortfolioCopilot.evaluateImpact` |
| **Interactive Sandbox Lab** | [`#/sandbox`](https://money-boys-neon.vercel.app/#/sandbox) | 4 preset scenarios, custom token price/size/margin sliders, real in-browser engine deliberation, and live Web Crypto SHA-256 sealing and tamper detection |

Legacy hashes (`#/desk`, `#/sandbox`, `#/evidence`, `#/track1`, `#/track2`, `#/track3`, `#/repro`) remain supported via hash router fallbacks.

---

## 6. Reproduce It

```bash
pnpm install
pnpm verify          # engine unit tests + Playwright E2E + typecheck + build + secret scan
pnpm check-foundry   # validates the claims / gaps ledgers
```

Regenerate the venue backtest:

```bash
set -a; . ./.env; set +a          # Bitget Demo credentials
pnpm exec tsx scripts/run-venue-backtest.ts
```

---

## 7. Document Map

| Document | What it holds |
|---|---|
| [`PRD.md`](PRD.md) | Product thesis and requirements |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System design |
| [`BUILD_FOUNDRY.md`](BUILD_FOUNDRY.md) | The operating standard — evidence gates, ledger discipline |
| [`AGENTS.md`](AGENTS.md) | Invariants I-01 … I-05 |
| `foundry/claims.jsonl` | Every claim and its promotion state |
| `foundry/gaps.jsonl` | Every gap and its residual closure condition |
| `foundry/evidence/` | On-disk evidence, including the quarantine |

---

## 8. Non-Goals

- **No real capital has moved.** Bitget Demo (`paptrading: 1`) only.
- **Synthetic fixtures are quarantined, not deleted** — see `foundry/evidence/paper-trading/QUARANTINE.md`. A previous backtest reported a 100% win rate; it was a hardcoded price table with hand-authored scenarios and no market data. It is stamped, quarantined, and superseded.
- **GAP-019 remains `BLOCKED_EXTERNAL`.** One data provider's terms are ambiguous about automated reads. No AI signed that acceptance, and none will.

---

## License

MIT.