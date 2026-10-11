# HANDOFF: Money Boys README Specification

> **Target File:** `README.md` (root)  
> **Source Standard:** Cleara Reference Model ([`github.com/etvjay/cleara`](https://github.com/etvjay/cleara/blob/main/README.md))  
> **Governing Charter:** [`AGENTS.md`](../AGENTS.md), [`BUILD_FOUNDRY.md`](../BUILD_FOUNDRY.md)  
> **Target Audience:** Bitget AI Hackathon Judges, Quant Researchers, External Auditors  
> **Primary Rule:** Implemented ≠ Verified · Verified Locally ≠ Proven Live · Deployed ≠ Working · Documented ≠ True

---

## 1. Executive Summary & Required Structure

The root `README.md` must be rewritten following the structural precision, rigorous boundary vocabulary, and authoritative evidence modeling seen in Cleara's README.

### Required Structural Outline:
1. **Header, Definition & Core Principle**
2. **The Problem Statement** (The RWA 24/7 Dislocation & The Agentic Trading Dilemma)
3. **How Money Boys Works** (Two-Speed Architecture & Pipeline)
4. **The Economic Relationship & Verified Quantitative Evidence** (89-Day Venue Backtest Table)
5. **Bitget GetAgent Studio AI Audit Sign-Off** (Andrew's Formal Verification)
6. **Authority Model & Boundary Vocabulary**
7. **Product Surfaces & Dashboard Layers**
8. **Explicit Non-Goals & Limitations**
9. **Verification & Judge Reproduction Commands**
10. **Documentation & Evidence Map**

---

## 2. Section-by-Section Specifications

### Section 1: Header, Definition & Core Principle
- **Title:** `# Money Boys`
- **One-Liner Definition:**
  > **Money Boys is an autonomous 24/7 agentic trading desk for tokenized US equities (Real World Assets) on Bitget.**
- **Tagline / Principle:**
  > **Research proposes. Quant calculates. Risk vetoes. Council decides. A receipt seals. Money Boys dispatches. The venue is read back.**
- **Operational Cadence:**
  > *Warm path cognitive research · Hot path <50ms deterministic execution · Zero direct LLM keys.*
- **Audience Qualification:**
  Designed for quantitative desks, RWA basis arbitrageurs, risk auditors, and autonomous systems evaluators. It is not an unconstrained LLM prompt, not a black-box bot, and not a script trading without economic justification.

---

### Section 2: The Problem Statement

#### 1. The Market Opportunity & Structural Dislocation
Traditional US equity markets (NYSE/Nasdaq) trade 6.5 hours a day, 5 days a week. Tokenized US equities (Reality rTokens on Bitget) trade 24/7/365. During the **65.5-hour weekend window** (Friday 16:00 ET to Monday 09:30 ET), TradFi cash equities are static, but tokenized contracts experience synthetic liquidity dislocations and retail basis divergence.

#### 2. The Agentic Trading Dilemma
- **Direct LLM Execution Fails (The Prompt Injection / Hallucination Trap):** An LLM that holds signing keys or directly submits orders will eventually execute hallucinations, miscalculate position sizes under pressure, or be vulnerable to adversarial prompt inputs. `I-01: Zero direct LLM authority`.
- **Naive Scripts Fail (Negative Asymmetry in Trending Regimes):** As proven in Bitget Cloud Replay (`pbrun-49207de5f579`), unconstrained mean-reversion without trend filtering achieves high win rates (64.9%) but suffers catastrophic 2:1 adverse loss asymmetry (-$27.40 net loss on 74 trades) by fading persistent momentum breakouts.
- **The Solution:** A decoupled two-speed architecture: LLM agents analyze macro catalysts asynchronously on the warm path, while deterministic mathematical algorithms and hard risk ceilings govern sub-50ms order gating on the hot path.

---

### Section 3: How Money Boys Works (Two-Speed Architecture)

In product terms, Money Boys answers a high-consequence question:
> *Given real-time tokenized equity orderbooks and static TradFi benchmarks, is there a genuine cost-resilient basis dislocation, does market regime support convergence, does exposure clear deterministic risk limits, and can an immutable cryptographic receipt be sealed before any order touches Bitget?*

#### Architectural Flowchart (ASCII):
```text
WARM PATH (Async Cognitive Research, 1–3s)
  Bitget Market Data (v2 Futures/Spot) + TradFi Benchmarks (Robinhood / Alpha Vantage)
    │
    ├── Macro Boy (Qwen-Plus / DashScope): Catalyst classification, macro trend filter
    └── Quant Boy: 20-bar fair-value equilibrium, basis hurdle, taker fee + slippage threshold
    │
    ▼
  StrategyProposalPacket (Typed Zod schema; literal `executable: false`; zero keys)

HOT PATH (Deterministic Sub-50ms Risk & Execution)
    │
    ├── Risk Boy HARD_VETO (Deterministic: >65% margin util, >$5k trade, or insufficient free margin)
    ├── Council Reducer (Deterministic quorum vote, 50% position scale-down on dissent)
    │
    ▼
  SHA-256 ReasoningReceipt (Sealed digest: no verified receipt = dispatcher rejects)
    │
    ▼
  Money Boys Dispatcher (The ONLY component with Bitget API v2 credentials)
    │
    ├── Bitget Venue Execution (Demo / Paper futures & spot)
    └── Read-Back & Foundry Evidence Ledger (Fills, PnL, position verification)
```

---

### Section 4: Verified Quantitative Evidence (The Real Numbers Table)

> **CRITICAL:** Do NOT cite the synthetic sandbox numbers. Anchor 100% to the verified 89-day venue walk-forward backtest (`foundry/evidence/backtest/venue_backtest_summary.json` & `venue_backtest_daily_series.json`).

| Metric | Full Campaign (89 Calendar Days) | Out-of-Sample (30 Calendar Days) | Verification & Reproducibility |
| :--- | :--- | :--- | :--- |
| **Net Realized P&L** | **+$1,228.83 USD** (+4.92%) | **+$433.35 USD** (+1.73%) | Reconciled to the exact cent across all fills |
| **Trade Count** | 150 completed trades | 48 completed trades | Clears Track 1 minimum gate (≥ 30 OOS trades) |
| **Win Rate** | **57.3%** (86W / 64L) | **56.3%** (27W / 21L) | Consistent across In-Sample (57.8%) and OOS |
| **Sharpe Ratio** | **3.21** (Annualized) | **3.89** (Annualized) | Sortino ratio: 9.15; 0.48% decay vs 0.5× IS floor |
| **Max Drawdown** | **1.27%** | **0.49%** | Peak-to-trough equity decline strictly bounded |
| **Direct AI Keys** | **0** | **0** | 100% orders gated by SHA-256 ReasoningReceipt |
| **Asset Dispersion** | 5 tokenized pairs (NVDA, TSLA, AAPL, MSFT, GOOGL) | Mean pairwise correlation $\rho = 0.197$; $N_{\text{eff}} = 2.80$ effective assets | Dampens single-stock momentum runs |

#### Transparent Methodological Disclosures:
- **Straddling Trade Sensitivity:** 5 trades entered In-Sample and exited Out-of-Sample contributed $224.49 to OOS PnL. Strictly excluding straddlers, pure OOS PnL is **+$208.86 (+0.83%, Sharpe 2.41)**. Both numbers are disclosed in the summary.
- **Rolling Stability:** Rolling 30-day Sharpe dispersion ranges between 1.13 and 7.31 (mean 4.04).

---

### Section 5: Multi-Track Hackathon Rubric Alignment (Tracks 1, 2, and 3)

Money Boys addresses all three competitive tracks of the Bitget AI Hackathon with dedicated evidence:

```text
Track 1 (Alpha Factory)       → 89-Day Venue Walk-Forward Backtest (OOS Sharpe 3.89, 5 Pairs)
Track 2 (Agentic Trading)     → Three-Beat Pipeline, Zero Direct Keys, A/B Qwen Campaign, Live Venue Fills
Track 3 (Portfolio Copilot)   → Multi-Asset Factor Ceilings (Net Beta ≤ 2.50, Sector ≤ 60%), Blast Radius
```

#### Track 1: Strategy & Backtest (Alpha Factory)
- **Evaluation Criteria:** Quantitative rigor, out-of-sample decay testing, transaction cost resilience, reproducible data.
- **Evidence & Implementation:**
  - 89-day venue walk-forward test (`foundry/evidence/backtest/venue_backtest_summary.json` & `venue_backtest_daily_series.json`).
  - Clears Track 1 minimum-observation gate: 48 Out-of-Sample trades (floor is 30 trades).
  - Out-of-Sample Sharpe of **3.89** (1.32× retention vs In-Sample 2.94, surpassing the 0.5× decay floor) and Sortino of **9.15**.
  - Reconciled to the exact cent: +$1,228.83 USD total, +$433.35 USD OOS across 150 trades.
  - Multi-asset dispersion across 5 tokenized pairs (NVDA, TSLA, AAPL, MSFT, GOOGL) with mean pairwise correlation $\rho = 0.197$ and $N_{\text{eff}} = 2.80$.
  - Full transparency disclosures: 6.5× rolling 30-day Sharpe dispersion (1.13–7.31) and straddling trade sensitivity ($224.49 from 5 straddlers; pure OOS without straddlers is +$208.86 / Sharpe 2.41).
  - Surface: `#/app/strategy` (or `#/track1`).

#### Track 2: Agentic Trading (50/50 Strategy & Autonomous Execution)
- **Evaluation Criteria:** Event → Decision → Execution pipeline, risk isolation, cognitive safety, proof on venue.
- **Evidence & Implementation:**
  - **The Three-Beat Timeline:**
    - *Beat 1 (Perception/Event):* Macro Boy ingests TradFi close data and Bitget orderbook spreads, proposing trade packets with literal `executable: false`. Holds zero API keys (`I-01`).
    - *Beat 2 (Deterministic Decision):* Deterministic Risk Boy checks margin util (<65%), trade cap (<$5k), and free margin. Sealed with SHA-256 ReasoningReceipt before dispatch (`I-02`, `I-03`). A vetoed proposal makes **zero** venue network calls (verified via client spy).
    - *Beat 3 (Venue Execution):* Signed REST order dispatched to Bitget API v2 (`paptrading: 1`), followed by immediate fill read-back, position confirmation, and flat closure.
  - **Live Venue Evidence:** Real order IDs, real fills, and flat read-backs on Bitget v2 Demo (`rNVDAUSDT` filled in 135.8ms, closed in 123.8ms, residual 0; resting limit order detail read-back and cancel path; `p13/rwa_trade_lifecycle.json`).
  - **A/B Agent Performance Campaign:** Macro Boy (Qwen-guided catalyst/trend filter) vs. Naive Baseline bot, proving +14.2% higher edge and complete elimination of false breakout churn during trending days (`foundry/evidence/ab-campaign/ab_metrics_summary.json`).
  - Surface: `#/track2`.

#### Track 3: Feature Depth & Portfolio Copilot (Factor Ceilings & Blast Radius)
- **Evaluation Criteria:** Architectural breadth, multi-agent coordination, institutional portfolio risk controls.
- **Evidence & Implementation:**
  - **Institutional Factor Ceilings (Hard Capped):**
    - Net Portfolio Beta Ceiling: $\le 2.50$ across multi-asset tokenized universe.
    - Sector Concentration Ceiling: $\le 60\%$ (Semiconductors, Automotive Tech, Consumer Tech, Enterprise Software, Cash).
    - Single-Asset Concentration Ceiling: $\le 40\%$.
  - **Interactive Blast Radius Engine:** Real-time pre-trade simulation calculating $\Delta \text{Beta}$, projected sector weight, and asset concentration before trade submission, classifying decisions into `PERMITTED`, `HARD_VETO`, or `DE_RISKING`.
  - **Multi-Agent Coordination Desk:** 4 Cooperating Agents (Macro Boy, Quant Boy, Risk Boy, Council) + Dispatcher + Audit Verifier.
  - Surface: `#/track3` (or `#/copilot`).

---

### Section 6: Bitget GetAgent Studio AI Audit Sign-Off (Andrew)

On October 8, 2026, Bitget GetAgent Studio's resident auditor (Andrew) completed a comprehensive quantitative and platform audit of the Money Boys RWA Basis Desk Playbook and issued an official **Final Audit Sign-Off Summary: APPROVED for public Studio publication and continued Paper observation**.

#### Audited Findings:
1. **Failure Accounting Verified (v0.0.1):** Andrew confirmed that the initial negative expectancy (-$27.40 USDT across 74 round trips) was caused by unhedged mean-reversion absorbing 2:1 adverse loss asymmetry (-$20.58 avg loss vs +$10.58 avg win) against 12 bps taker fees.
2. **Repair Accounting Verified (v0.0.2):** Andrew reconciled that the repaired version flipped expectancy positive: +$15.01 net PnL, 60.0% win rate (12W/8L), 1.74 net profit factor (2.26 gross), and +$0.75 expectancy per trade.
3. **Holdout Sensitivity Passed:** Andrew verified that on the 11-trade chronological holdout, edge survives removing the largest winner (+4.79 USDT net PnL, 1.44 net PF).
4. **Platform Publication Passed:** Studio Playbook (`3010803e-9b57-4eec-8d2d-99f9377bc88a` / `dc8435f0-5b54-4293-b778-790439bd422e`) verified as `Public`, `Ready`, `Listed` on the leaderboard, with the 64-character package fingerprint (`13ac8ecb...6654f53`) matching the local build manifest.
5. **Live Paper Trading Execution:** Active long position (1.26 contracts `NVDAUSDT` @ $237.31) monitored in Paper trading, outperforming the underlying NVDA benchmark by **+87 bps (+0.87 pp)**.

---

### Section 6: Authority Model & Boundary Vocabulary

#### Authority Matrix:
| Component | Permitted Authority | Explicit Limitation (What It CANNOT Do) |
| :--- | :--- | :--- |
| **Macro Boy** | Proposes macro regime, catalyst weight, and directional bias | Cannot sign orders, hold API keys, or authorize execution (`I-01`) |
| **Quant Boy** | Computes 20-bar fair-value equilibrium and cost hurdles | Cannot override risk limits or alter venue balances |
| **Risk Boy** | Hard deterministic veto on margin util (>65%), trade size (>$5k), free margin | Cannot generate trading proposals or modify entry prices |
| **Council Reducer**| Evaluates quorum vote, applies 50% scale-down on soft dissent | Cannot bypass a Risk Boy `HARD_VETO` |
| **ReasoningReceipt**| Cryptographically seals approved proposal digest with SHA-256 | Cannot execute trades; serves as immutable audit proof |
| **Dispatcher** | Sole component holding Bitget API credentials; dispatches orders | Dispatches ONLY if presented with a valid, sealed APPROVED receipt |
| **Desk / Web UI** | Visualizes telemetry, receipts, orderbook, and audit ledgers | Cannot dispatch orders or hold execution credentials |

#### Boundary Vocabulary:
- **`IMPLEMENTED ≠ VERIFIED`** — Code existing in a repository is not evidence that it operates correctly.
- **`VERIFIED LOCALLY ≠ PROVEN LIVE`** — A passing local mock test is not proof of venue execution.
- **`DEPLOYED ≠ WORKING`** — A running process or published URL is not proof of economic validity.
- **`DOCUMENTED ≠ TRUE`** — Written claims in documentation require immutable evidence ledgers.
- **`PROPOSAL ≠ AUTHORIZATION`** — LLM research proposals carry literal `executable: false`.
- **`SEALED RECEIPT ≠ FILLED ORDER`** — A sealed receipt proves cryptographic intent, not venue execution.
- **`PAPER ≠ LIVE CAPITAL`** — All demonstrated venue trades use Bitget Demo Trading (`paptrading: 1`).

---

### Section 7: Product Surfaces & Dashboard Navigation

The unified desk application is served on port 3000 (proxied via Cloudflare Tunnel) with four dedicated operational tabs:

- **Cockpit (`#/app/desk` or `#/desk`):** Live 24/7 telemetry stream (SSE), current node statuses, orderbook basis tracker, active positions, and real-time execution log.
- **Council Sandbox (`#/app/sandbox` or `#/sandbox`):** Interactive browser playground allowing judges to manipulate price dislocations, test Risk Boy veto thresholds, and inspect real-time quorum voting.
- **Strategy Layer (`#/app/strategy` or `#/track1`):** Complete walk-forward backtest analytics, daily returns curve, rolling Sharpe dispersion, and pairwise correlation matrices.
- **Audit & Evidence (`#/app/audit` or `#/evidence`, `#/repro`):** Cryptographic receipt verification tool, provable benchmark freshness gates, and live Foundry claims/gaps ledger.

---

### Section 8: Explicit Non-Goals & Limitations

*Read this before trusting any number in this repository:*
- **No real capital has moved:** Every order was executed on Bitget Demo Trading (`paptrading: 1`) using Demo-scoped API keys.
- **The strategy has not run as an unbounded multi-week live capital campaign:** Tested extensively in walk-forward backtests and Paper daemons, but not live production margin.
- **Single-name sandbox vs multi-asset engine:** The 1-hour single-name Playbook sandbox on GetAgent Studio demonstrates single-asset convergence dynamics; multi-asset portfolio dispersion is demonstrated in the core engine.
- **No funding rate arbitrage claimed:** Basis trades target structural spot/perp dislocations during TradFi closures, not continuous 8-hour funding rate harvesting.
- **Synthetic fixtures quarantined:** Early synthetic demo fixtures under `foundry/evidence/paper-trading/` are flagged under `GAP-021` and superseded by the 89-day venue candle dataset.

---

### Section 9: Judge Reproduction Commands

Judges can verify the entire repository locally without needing live exchange credentials:

```bash
# 1. Install dependencies
pnpm install

# 2. Run the canonical verification ladder (takes ~60 seconds)
# Executes: 770 engine unit tests + 61 Playwright browser E2E tests + 
#           TypeCheck + Desk production build + Secret scan + Foundry check
pnpm verify

# 3. Verify Foundry evidence and ledger consistency
pnpm check-foundry

# 4. (Optional) Run the Phase 01 Bitget Auth test (requires Bitget Demo API keys in .env)
pnpm --filter @money-boys/engine test:auth
```

---

### Section 10: Documentation Map

| Document | Purpose |
| :--- | :--- |
| [`PRD.md`](../PRD.md) | Product Requirements Document and judge evaluation scope |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | System components, two-speed architecture, and data contracts |
| [`BUILD_FOUNDRY.md`](../BUILD_FOUNDRY.md) | Foundry lightweight evidence kernel, claim states, and stop conditions |
| [`AGENTS.md`](../AGENTS.md) | Operating charter, invariants I-01 through I-05 |
| [`foundry/claims.jsonl`](../foundry/claims.jsonl) | Canonical machine-readable claims ledger |
| [`foundry/gaps.jsonl`](../foundry/gaps.jsonl) | Active gap tracking ledger (all non-closed gaps disclosed) |
| [`foundry/evidence/backtest/venue_backtest_summary.json`](../foundry/evidence/backtest/venue_backtest_summary.json) | Full 89-day walk-forward venue backtest evidence |
| [`foundry/evidence/p01/auth_test.json`](../foundry/evidence/p01/auth_test.json) | Authenticated private Bitget read-back evidence |
| [`foundry/evidence/p13/rwa_trade_lifecycle.json`](../foundry/evidence/p13/rwa_trade_lifecycle.json) | Live tokenized RWA equity (`rNVDAUSDT`) order fill and flat read-back |
| [`public/money_boys_89d_trades.csv`](../packages/desk/public/money_boys_89d_trades.csv) | Downloadable CSV of all 150 venue backtest trades |
| [`public/money_boys_paper_trades.csv`](../packages/desk/public/money_boys_paper_trades.csv) | Downloadable CSV of live Paper trading fills |
