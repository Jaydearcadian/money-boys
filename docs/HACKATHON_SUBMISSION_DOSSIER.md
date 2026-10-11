# Money Boys — Bitget AI Trading Competition (Hackathon S2) Submission Dossier

> **Ready-to-Submit Reference:** Copy-paste fields directly into the Bitget Hackathon / Devpost submission portal.

---

## 1. Core Submission Metadata

* **Project Title:** Money Boys
* **Short Tagline (under 120 chars):** Autonomous 24/7 agentic desk for tokenized US equities (rTokens on Bitget API v2) with deterministic risk gates.
* **Live Web Cockpit URL:** [https://money-boys-neon.vercel.app](https://money-boys-neon.vercel.app)
* **Secondary Tunnel Mirror:** [https://blacks-andreas-alto-feet.trycloudflare.com](https://blacks-andreas-alto-feet.trycloudflare.com)
* **Public GitHub Repository:** [https://github.com/Jaydearcadian/money-boys](https://github.com/Jaydearcadian/money-boys)
* **Demo Video Link:** *(Insert your 2–3 min Loom / YouTube recording here)*
* **License:** MIT

---

## 2. Competition Track Selection & Mapping

Money Boys addresses all three competition tracks with dedicated, verifiable modules:

| Track Entered | Module & Route | Core Proven Metric |
| :--- | :--- | :--- |
| **Track 1: Alpha Factory** *(Strategy & Backtest)* | [`#/strategy`](https://money-boys-neon.vercel.app/#/strategy) | **+$1,228.83 Net PnL** (+4.92%), **3.89 OOS Sharpe** vs 1.47 floor (**1.32× retention**), **48 OOS Trades** (clears ≥ 30 gate), $\rho = 0.197$ correlation. |
| **Track 2: Agentic Trading** *(50/50 Strategy & Execution)* | [`#/audit`](https://money-boys-neon.vercel.app/#/audit) | Three-Beat timeline (`dispatched: false` on Beat 1, deterministic hard veto on Beat 2), live Bitget v2 order fill (**Order ID `1491906882204499969`**, 126.1ms fill), **76,980+ autonomous 24/7 daemon cycles**. |
| **Track 3: Portfolio Copilot** *(Feature Depth & Risk)* | [`#/copilot`](https://money-boys-neon.vercel.app/#/copilot) | Institutional risk ceilings (**Net Beta ≤ 2.50**, **Sector concentration ≤ 60%**) and live interactive pre-trade **Blast Radius evaluation**. |

---

## 3. Executive Summary / Long Description

```markdown
### What is Money Boys?
Money Boys is an autonomous 24/7 agentic trading desk for tokenized US equities (Real World Assets / rTokens on Bitget API v2). 

Traditional US equity venues (NYSE/Nasdaq) trade only 32.5 hours per week (09:30–16:00 ET, Mon–Fri). Tokenized equities (rNVDA, rTSLA, rAAPL, rMSFT, rGOOGL) on Bitget trade 168 hours per week (24/7/365). During off-hours, earnings surprises, macro announcements, and global crypto liquidity drive dislocations between the 24/7 token price and the frozen TradFi close. Money Boys exploits this structural off-hours basis dislocation.

### Two-Speed Agentic Architecture:
Rather than letting an unconstrained LLM call exchange APIs directly, Money Boys enforces a strict architectural boundary:
1. Warm Path (Async): Macro Boy (Qwen-Plus on Alibaba Cloud) and Quant Boy ingest catalysts and orderbooks, proposing trades with `executable: false` (Zero direct LLM keys).
2. Hot Path (<50ms): Risk Boy enforces deterministic mathematical HARD_VETO rules (>65% margin util, >$5k single trade, negative net edge). A cryptographic SHA-256 ReasoningReceipt is sealed before any order is dispatched. When vetoed, zero network calls touch Bitget.

### Authentic Quantitative Evidence:
- Track 1 (Alpha Factory): 89-day venue walk-forward backtest joining genuine Bitget futures candles with Alpha Vantage equity closes. Realized +$1,228.83 USD net PnL across 150 trades (48 OOS trades, clearing the ≥ 30 gate). OOS Sharpe 3.89 exceeds the 0.5× In-Sample decay floor (1.47), demonstrating 1.32× alpha retention with 56.3% OOS win rate and 0.49% OOS drawdown.
- Track 2 (Agentic Execution): Proven live on Bitget Demo (paptrading: 1) with Order ID 1491906882204499969 filled in 126.1ms and closed flat. A continuous autonomous background daemon has executed 76,980+ live deliberation cycles across 5 assets over 3+ days of uptime with 100% fail-closed safety.
- Track 3 (Portfolio Copilot): Institutional factor ceilings hard-capping Net Portfolio Beta ≤ 2.50 and Sector Concentration ≤ 60%, with an interactive Blast Radius simulation engine classifying pre-trade factor impacts into PERMITTED, HARD_VETO, or DE_RISKING.
```

---

## 4. Suggested 2.5-Minute Video Recording Script

Follow this click-through script when recording your submission video:

* **0:00 – 0:35 (The Problem & Thesis):**
  * Start on the Landing Page ([`https://money-boys-neon.vercel.app`](https://money-boys-neon.vercel.app)).
  * Highlight the US market status pill: *"NYSE is closed 135.5 hours a week, but tokenized equities on Bitget trade 24/7. Retail drift and weekend news create basis dislocations that Money Boys captures."*
  * Click the white pill **"Try the sandbox"** to enter the Trading Cockpit.

* **0:35 – 1:05 (Track 1: Alpha Factory):**
  * Click the **"Track 1 Alpha"** button in the sidebar rail (or [`#/strategy`](https://money-boys-neon.vercel.app/#/strategy)).
  * Show the 89-day equity curve: *"Notice the Out-of-Sample Sharpe of 3.89 comfortably clears the 0.5× IS decay floor of 1.47, proven over 48 out-of-sample trades across 5 assets with low correlation ($\rho = 0.197$)."*

* **1:05 – 1:35 (Track 2: Agentic Execution):**
  * Click **"Track 2 Agentic"** in the sidebar rail (or [`#/audit`](https://money-boys-neon.vercel.app/#/audit)).
  * Point to the Three-Beat timeline: *"Macro Boy proposes with zero keys. Risk Boy vetoes deterministically. Only approved cycles reach Bitget."*
  * Point to the Live Bitget Lifecycle Proof card showing genuine Order ID `1491906882204499969` filled in 126ms.
  * Show the 24/7 Daemon Monitor showing 76,980+ continuous cycles across 3+ days of active uptime.

* **1:35 – 2:05 (Track 3: Portfolio Copilot):**
  * Click **"Track 3 Copilot"** in the sidebar rail (or [`#/copilot`](https://money-boys-neon.vercel.app/#/copilot)).
  * Click the preset button **"+$7k rNVDA"**: show the immediate `HARD_VETO` (breaching the 60% sector ceiling).
  * Click **"+$2k rNVDA"**: show `PERMITTED` as projected beta remains under 2.50.

* **2:05 – 2:30 (Interactive Sandbox Lab & Tamper Proof):**
  * Click **"Sandbox Lab"** (or [`#/sandbox`](https://money-boys-neon.vercel.app/#/sandbox)).
  * Click **"Run scenario"** to seal a live Web Crypto SHA-256 receipt.
  * Click **"Try tampering"** to demonstrate the cryptographic security check rejecting the payload with `MISMATCH`.
  * Conclude: *"Money Boys is live, verified with 18 Playwright tests and 770 engine tests, and running on Bitget API v2."*
