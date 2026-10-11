# Money Boys — Master Product Context & Multi-Track Alignment Guide

> **Target Audience:** Coding Agent / Lead Engineer / Evaluator  
> **Mission:** Align the In-App Dashboard & Landing Page with the true Money Boys product, its exact Bitget Hackathon S2 track submissions, authoritative evidence, and the unified Onion AI / Moneliq luxury obsidian design system.

---

## 1. What is Money Boys? (The True Product)

**Money Boys** is an **Autonomous 24/7 Agentic Trading Desk for Tokenized US Equities (Reality rTokens on Bitget API v2)**.

### The Market Dislocation It Exploits:
* **The Problem:** Traditional US equities (NYSE/Nasdaq) trade only **32.5 hours per week** (09:30–16:00 ET, Mon–Fri). Tokenized equities (`rNVDA`, `rAAPL`, `rTSLA`, `rMSFT`, `rGOOGL`) on Bitget trade **168 hours per week (24/7/365)**.
* **The Dislocation:** During off-market hours (nights, weekends, holidays), off-hours news, earnings leaks, macro announcements, and global crypto liquidity drive dislocations between the 24/7 token price and the traditional equity benchmark close.
* **The Solution:** Money Boys captures this off-hours basis spread continuously, governed by a 4-agent cognitive council, bounded by deterministic mathematical risk gates, and sealed with tamper-proof cryptographic receipts before dispatch to Bitget API v2.

---

## 2. The 3 Official Hackathon Tracks Money Boys Submits For

The dashboard and landing page **must directly capture and showcase the three official competition tracks** with authentic evidence from `foundry/evidence/`:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                                MONEY BOYS MULTI-TRACK DESK                                   │
├──────────────────────────────┬──────────────────────────────┬────────────────────────────────┤
│           TRACK 1            │           TRACK 2            │            TRACK 3             │
│        Alpha Factory         │       Agentic Trading        │       Portfolio Copilot        │
│   (Strategy & Backtest)      │ (Autonomous Venue Execution) │  (Feature Depth & Risk Caps)   │
├──────────────────────────────┼──────────────────────────────┼────────────────────────────────┤
│ • 89-Day Venue Backtest      │ • Three-Beat Timeline        │ • Factor Risk Ceilings         │
│ • OOS Sharpe: 3.89           │ • Zero Direct AI Keys (I-01) │   - Net Beta ≤ 2.50            │
│ • OOS Sortino: 9.15          │ • Deterministic Veto (I-02)  │   - Sector Cap ≤ 60%           │
│ • Net PnL: +$1,228.83 USD    │ • Live Bitget v2 Fills       │   - Single Asset ≤ 40%         │
│ • 150 Trades (48 OOS ≥ 30)   │ • A/B Qwen-Plus Campaign     │ • Interactive Blast Radius     │
│ • Pair Correlation: ρ=0.197  │ • SHA-256 Sealed Receipts    │ • 4 Cooperating Agents         │
└──────────────────────────────┴──────────────────────────────┴────────────────────────────────┘
```

---

### Track 1: Alpha Factory (Strategy & Walk-Forward Backtest)
* **Official Evidence File:** [`foundry/evidence/backtest/venue_backtest_summary.json`](../foundry/evidence/backtest/venue_backtest_summary.json) & [`venue_backtest_daily_series.json`](../foundry/evidence/backtest/venue_backtest_daily_series.json).
* **Core Metrics:**
  * **Net Realized PnL:** **+$1,228.83 USD** (+4.92%) over 89 days; **+$433.35 USD** (+1.73%) Out-of-Sample.
  * **Trade Count:** **150 completed trades**; **48 Out-of-Sample trades** (clears the Track 1 minimum gate of $\ge 30$ OOS trades).
  * **Out-of-Sample Sharpe Ratio:** **3.89** (1.32× retention vs In-Sample 2.94, surpassing the 0.5× decay floor).
  * **Sortino Ratio:** **9.15** (extremely low downside volatility).
  * **Win Rate:** **56.3%** OOS (57.3% across full campaign).
  * **Max Drawdown:** **0.49%** OOS (1.27% total).
  * **Multi-Asset Dispersion:** 5 tokenized pairs (NVDA, TSLA, AAPL, MSFT, GOOGL) with mean pairwise correlation $\rho = 0.197$ and $N_{\text{eff}} = 2.80$ effective assets.
* **UI Features Needed:**
  * Interactive 89-day equity curve toggleable between In-Sample and Out-of-Sample.
  * 5x5 asset correlation matrix heatmap ($\rho = 0.197$).
  * Transparent decay and straddling disclosures table.

---

### Track 2: Agentic Trading (50/50 Strategy & Autonomous Execution)
* **Official Evidence File:** [`foundry/evidence/p13/rwa_trade_lifecycle.json`](../foundry/evidence/p13/rwa_trade_lifecycle.json) & [`foundry/evidence/ab-campaign/ab_metrics_summary.json`](../foundry/evidence/ab-campaign/ab_metrics_summary.json).
* **The Three-Beat Timeline:**
  1. **Beat 1 (Perception/Proposal):** Macro Boy ingests news and Bitget L2 orderbooks, proposing trade packets with `executable: false`. Holds zero API keys (`I-01`).
  2. **Beat 2 (Deterministic Gate):** Deterministic Risk Boy checks margin util ($<65\%$), trade cap ($<\$5\text{k}$), and available collateral. Generates SHA-256 ReasoningReceipt before dispatch (`I-02`, `I-03`). When vetoed, **zero venue network calls are made**.
  3. **Beat 3 (Venue Execution):** Signed REST order dispatched to Bitget API v2 (`paptrading: 1`), followed by fill read-back and flat position closure.
* **Live Venue Execution Proof:**
  * Real Bitget order ID (`1491906882204499969`), filled in 126.1ms, closed in 129.2ms, residual 0.
* **A/B Inference Campaign:**
  * Macro Boy (Qwen-Plus on Alibaba Cloud) vs Naive Baseline across live network round-trips with cryptographic SHA-256 payload provenance.
* **UI Features Needed:**
  * Visual Three-Beat timeline animator.
  * Live Bitget v2 order lifecycle card with real order IDs and fill timestamps.
  * A/B model comparison panel.

---

### Track 3: Feature Depth & Portfolio Copilot (Factor Ceilings & Blast Radius)
* **Official Implementation:** [`packages/engine/src/skills/igraph-guard/security.ts`](../packages/engine/src/skills/igraph-guard/security.ts) & [`portfolio-copilot.ts`](../packages/engine/src/skills/igraph-guard/portfolio-copilot.ts).
* **Institutional Risk Ceilings (Hard Capped):**
  * **Net Portfolio Beta Ceiling:** $\le 2.50$ across the multi-asset universe.
  * **Sector Concentration Ceiling:** $\le 60\%$ (Semiconductors, Auto Tech, Consumer Tech, Enterprise Software, Cash).
  * **Single-Asset Concentration Ceiling:** $\le 40\%$.
* **Interactive Blast Radius Engine:**
  * Calculates projected $\Delta\text{Beta}$, sector weight, and asset concentration before trade submission, classifying decisions into `PERMITTED`, `HARD_VETO`, or `DE_RISKING`.
* **UI Features Needed:**
  * Interactive Factor Ceilings gauges (Portfolio Beta $\le 2.50$, Sector $\le 60\%$).
  * Blast Radius pre-trade simulator with sliders for trade size and market beta.

---

## 3. Design System & Aesthetic Continuity (Onion AI / Moneliq Obsidian)

The dashboard and landing page **must share the exact same luxury dark aesthetic** rather than looking like two different apps.

### Design Tokens to Use Everywhere:
```css
:root {
  /* Surface palette */
  --bg-base: #000000;                     /* Pure deep obsidian */
  --card-gradient: linear-gradient(180deg, #121212 0%, #070707 100%);
  --card-elevated: #161616;
  --line: rgba(255, 255, 255, 0.09);
  --line-subtle: rgba(255, 255, 255, 0.05);

  /* Typography */
  --text-primary: #ffffff;
  --text-secondary: #cfcfcf;
  --text-muted: #8d8d8d;

  /* Tactical Accents */
  --accent-emerald: #34d399;              /* Safety, approved, net edge */
  --accent-amber: #f59e0b;                /* Off-hours, warning */
  --accent-rose: #fb7185;                 /* Hard veto, failure */
  --accent-cyan: #06b6d4;                 /* Math, quant, basis */

  /* Buttons & Micro-components */
  --pill-bg: #ffffff;
  --pill-color: #000000;
  --pill-radius: 999px;
  --tile-bg: #161616;
  --tile-border: rgba(255, 255, 255, 0.14);
}
```

### Visual Motifs:
* **Pill Buttons:** Pure `#ffffff` background with `#000000` text, rounded `999px`, with soft glow on hover.
* **Micro-Tiles:** Square round-corner tiles (`40px`, radius `10px`, background `#161616`, border `1px solid rgba(255,255,255,0.14)`).
* **Cards:** Dark matte vertical gradient `linear-gradient(180deg, #121212 0%, #070707 100%)` with hairline border `rgba(255, 255, 255, 0.09)`.
* **Chart Hatching:** Shaded diagonal emerald hatch (`#34d399` at `45deg`) for the Net Edge Arbitrage area.

---

## 4. In-App Dashboard Tab Architecture

The in-app dashboard should be organized into **4 primary operational tabs** corresponding to the tracks and operations:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [Logo] Money Boys Desk    │  [● Track 1: Alpha Factory] [● Track 2: Agentic] [● Track 3: Copilot]│
├───────────────────────────┴────────────────────────────────────────────────────────────┤
│ TABS:                                                                                  │
│ 1. [COCKPIT]     - Real-Time Desk Overview, 4-Agent Council, Live Tickers, Margin Gauge│
│ 2. [SANDBOX]     - Interactive Scenario Runner, Custom Trade Builder, WebCrypto Sealer │
│ 3. [STRATEGY]    - Track 1 Backtest Curves (OOS Sharpe 3.89), Convergence, Matrix     │
│ 4. [COPILOT]     - Track 3 Institutional Risk Ceilings (Beta ≤ 2.50, Sector ≤ 60%)     │
│ 5. [AUDIT]       - Track 2 Bitget v2 Execution Proof, SHA-256 Receipts, CSV Export     │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Tab Breakdown:
1. **Cockpit (`#/app/desk` or `#/app`):**
   * Real-time 4-Agent node matrix (Macro, Quant, Risk, Execution).
   * 5 RWA asset cards (`rNVDA`, `rTSLA`, `rAAPL`, `rMSFT`, `rGOOGL`).
   * Live Margin Utilization gauge ($<65\%$ limit).
   * Fail-Closed Emergency Halt switch (`I-01` / `I-02`).
2. **Sandbox (`#/sandbox`):**
   * Preset scenario buttons (Weekend Earnings Dislocation, Thin Orderbook Drag, Margin Surge Veto, Trade Size Cap Veto).
   * Sliders for custom price, notional size, and account margin.
   * Client-side SHA-256 seal generator & interactive tamper verifier.
3. **Strategy / Alpha Factory (`#/strategy` - Track 1):**
   * 89-day venue walk-forward backtest equity curve (+4.92% net return, 3.89 OOS Sharpe, 1.27% max DD).
   * 5x5 pairwise correlation matrix ($\rho = 0.197$, $N_{\text{eff}} = 2.80$).
   * Basis convergence chart showing weekend drift snapping back at Monday open.
4. **Portfolio Copilot (`#/copilot` - Track 3):**
   * Net Portfolio Beta gauge ($\le 2.50$).
   * Sector concentration chart ($\le 60\%$).
   * Interactive Blast Radius calculation engine.
5. **Audit & Receipts (`#/audit` - Track 2):**
   * Searchable trade & fill ledger from Bitget API v2 (`money_boys_paper_trades.csv`).
   * Slide-over SHA-256 ReasoningReceipt drawer with full JSON inspector.
   * Live Bitget API v2 lifecycle proof card (Order ID, fill latency, flat read-back).
   * Direct CSV download buttons.

---

## 5. Non-Negotiable Operating Invariants

Any code written by the agent must preserve the 5 foundational charter invariants:
* **I-01 (Zero Direct LLM Authority):** LLMs propose hypotheses; they never hold Bitget private keys or dispatch orders directly.
* **I-02 (Deterministic Hard Veto):** Hard-coded mathematical veto on $>65\%$ margin utilization, $>\$5\text{k}$ trade size, or negative net edge.
* **I-03 (SHA-256 ReasoningReceipt):** An unforgeable cryptographic receipt must be sealed before any order is dispatched.
* **I-04 (Sub-50ms Hot Path):** Execution routing executes in $<50\text{ms}$; LLM reasoning runs asynchronously in the warm path.
* **I-05 (Zero Framework Bloat):** Pure TypeScript + Zod + Web Crypto API. No LangChain, CrewAI, or AutoGen.
