# Money Boys — Landing Page Technical & Product Specification

> **Document Purpose:** Engineering and design blueprint for implementing the official Money Boys landing page. This specification defines the exact product architecture, cognitive agent model, grounding substrate, visual components, interactive features, and copy guidelines required to represent Money Boys accurately.

---

## 1. Executive Summary & Core Product Thesis

### 1.1 What is Money Boys?
**Money Boys** is an autonomous, 24/7 agentic trading desk engineered for tokenized Real-World US Equities (**Reality rTokens on Bitget API v2**).

### 1.2 The Core Market Inefficiency
* **Market Dislocation:** Traditional US equity markets (NYSE/Nasdaq) operate approximately 32.5 hours per week (09:30–16:00 ET, Monday–Friday). Tokenized equities (`rNVDA`, `rAAPL`, `rTSLA`, `rCOIN`, `rSPY`) on Bitget trade **24 hours a day, 7 days a week (168 hours/week)**.
* **The Arbitrage Opportunity:** Outside standard trading hours (nights, weekends, holidays), breaking news, earnings releases, and crypto liquidity drive price dislocations between the 24/7 token price and the benchmark closing price.
* **The Solution:** Money Boys continuously captures this off-hours basis spread using a multi-agent cognitive council grounded in live market telemetry, governed by deterministic risk gates, and sealed with cryptographic proof receipts.

---

## 2. Theoretical & Architectural Foundations

Money Boys synthesizes two core paradigms:

```
                  ┌──────────────────────────────────────────────┐
                  │          CONTEXT7 GROUNDING ENGINE           │
                  │   Bitget v2 L2 · Reality rTokens · Alpha V   │
                  └──────────────────────┬───────────────────────┘
                                         │ Live Verified State (<1000ms)
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │       UNDERSTAND-ANYTHING AGENT COUNCIL      │
                  │  ┌────────────┐ ┌────────────┐ ┌───────────┐ │
                  │  │ Macro Boy  │ │ Quant Boy  │ │ Risk Boy  │ │
                  │  │ (Context)  │ │ (Math/Edge)│ │ (Hard Gate│ │
                  │  └─────┬──────┘ └─────┬──────┘ └─────┬─────┘ │
                  │        └──────────────┼──────────────┘       │
                  │                       ▼                      │
                  │               Execution Boy                  │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │       CRYPTOGRAPHIC REASONING RECEIPTS       │
                  │   SHA-256 Sealed Receipts · Immutable Audit  │
                  └──────────────────────────────────────────────┘
```

### 2.1 The Grounding Substrate (*Context7 Paradigm*)
* **Problem Solved:** Prevents LLM hallucinations, stale quotes, and ungrounded execution.
* **Implementation:**
  * Real-time streaming ingestion of Bitget API v2 L2 orderbooks and Reality rToken pricing.
  * Deterministic freshness gating ($<1000\text{ms}$ maximum data age).
  * Strict mathematical computation of basis spread and hurdle drag:
    $$\text{Raw Basis} = \frac{\text{Token Mid} - \text{Benchmark Close}}{\text{Benchmark Close}} \times 100$$
    $$\text{Net Edge} = |\text{Raw Basis}| - \text{Hurdle Drag (Exchange Fees + Slippage + Funding Drag)}$$

### 2.2 Multi-Agent Cognitive Topology (*Understand-Anything Paradigm*)
* **Problem Solved:** Replaces opaque black-box LLM prompts with an inspectable, specialized agent council.
* **The 4 Council Nodes:**
  1. **Macro Boy (Context & Regime Analyst):** Synthesizes off-hours macroeconomic news, corporate earnings, and sentiment using Alibaba Cloud DashScope (Qwen-Plus).
  2. **Quant Boy (Edge & Sizing Engine):** Calculates mathematical basis spread, hurdle clearance, and Kelly-adjusted trade sizing.
  3. **Risk Boy (Deterministic Hard Gate):** Mathematical safety engine with absolute veto authority over margin utilization ($>65\%$), maximum trade size ($>\$5\text{k}$), and available collateral.
  4. **Execution Boy (Hot-Path Dispatcher):** Sub-50ms execution pipeline signing and routing orders directly to Bitget v2 Spot/Margin endpoints.

### 2.3 Non-Negotiable Invariants (I-01 through I-05)
* **I-01 (Zero Direct LLM Authority):** LLMs propose hypotheses; they never hold private keys or dispatch unvalidated trades.
* **I-02 (Deterministic Hard Veto):** Hard-coded mathematical veto on $>65\%$ margin utilization, $>\$5\text{k}$ single trade, or negative net edge.
* **I-03 (SHA-256 ReasoningReceipt):** An immutable, sealed receipt containing the full decision graph is generated before any order is submitted.
* **I-04 (Sub-50ms Hot Path):** Execution routing executes in $<50\text{ms}$; reasoning runs asynchronously in the warm path.
* **I-05 (Zero Heavy Framework Bloat):** Pure TypeScript, Zod schemas, and Web Crypto API. No LangChain, CrewAI, or AutoGen.

---

## 3. Comprehensive Landing Page Section Blueprint

The landing page must not read as generic marketing copy. It should present an institutional-grade, highly interactive cockpit that educates visitors, demonstrates the live engine, and allows sandbox inspection.

---

### Section 1: Hero Cockpit & Live Market Dislocation
* **Headline:** An Autonomous Agentic Trading Desk for 24/7 Tokenized Equities.
* **Sub-headline:** Capturing basis arbitrage between Reality rTokens on Bitget and off-hours US equities with deterministic risk gates and cryptographic provenance.
* **Interactive UI Elements:**
  * **Live Ticker Ribbon:** Real-time prices and basis spreads for `rNVDA/USDT`, `rAAPL/USDT`, `rTSLA/USDT`, `rCOIN/USDT`, `rSPY/USDT`.
  * **Session Status Gauge:** Visual comparison showing traditional market state (`NYSE: CLOSED`) alongside 24/7 token trading (`Bitget rToken Desk: ACTIVE`).
  * **Hot-Path Telemetry Widget:** Live latency indicators ($<42\text{ms}$), margin health score ($98.4\%$), and active cycle counter.
  * **Primary CTAs:** `Launch Live Cockpit`, `Open Sandbox Simulator`, and `View Audit Ledger`.

---

### Section 2: Real-Time Grounding Engine (*Context7 Architecture*)
* **Header:** Real-Time Market Grounding Substrate
* **Sub-header:** Zero hallucinations. Every decision is anchored in live L2 orderbooks, benchmark closes, and verifiable collateral.
* **Component Architecture:**
  * **3-Node Pipeline Graphic:**
    1. *Live Orderbook Ingestion:* Bitget v2 WebSocket ($L2$ depth, bid/ask spread).
    2. *Benchmark Valuation:* Official NYSE/Nasdaq closing prints and corporate action feeds.
    3. *Hurdle Clearance Gate:* Real-time subtraction of trading fees ($0.1\%$), estimated slippage, and borrow funding rates.
  * **Live Formula Breakdown Card:** Interactive component displaying current values substituted into the net edge formula:
    $$\text{Net Edge (\%)} = \text{Raw Basis (\%)} - (\text{Fee Drag} + \text{Slippage} + \text{Funding})$$

---

### Section 3: The 4-Agent Cognitive Council (*Understand-Anything Architecture*)
* **Header:** The 4-Agent Decision Council
* **Sub-header:** Specialized intelligence nodes collaborating through structured message passing and deterministic verification.
* **Component Architecture (4 Interactive Agent Cards):**
  1. **Macro Boy (Context Analyst):**
     * *Role:* News synthesis, earnings sentiment, and macro regime identification.
     * *Model:* Alibaba Cloud DashScope (Qwen-Plus).
     * *Output:* Structured regime score & macro confidence rating.
  2. **Quant Boy (Math & Edge Engine):**
     * *Role:* Basis curve modeling, hurdle clearance, and volatility-adjusted sizing.
     * *Output:* Direction (`BUY_TOKEN` / `SELL_TOKEN`), optimal size, and edge percentage.
  3. **Risk Boy (Deterministic Gatekeeper):**
     * *Role:* Enforces hard invariants. Cannot be overridden by LLMs.
     * *Output:* `PASS` or `HARD_VETO` with cryptographic reason code.
  4. **Execution Boy (Hot-Path Dispatcher):**
     * *Role:* Sub-50ms order creation and dispatch via Bitget API v2.
     * *Output:* Bitget Order ID, fill receipt, and execution latency timestamp.

---

### Section 4: Deterministic Guardrails & SHA-256 ReasoningReceipts
* **Header:** Cryptographic Provenance & Safety Invariants
* **Sub-header:** Every trade decision is sealed into a tamper-evident receipt before touching the exchange.
* **Component Architecture:**
  * **The 5 Invariant Matrix:** Visual cards highlighting rules `I-01` through `I-05` with live verification status indicators.
  * **Interactive ReasoningReceipt Inspector:** An expandable code block displaying a realistic JSON receipt with syntax highlighting:
    ```json
    {
      "receiptId": "rcpt_9f83a2c4e1b7",
      "timestamp": "2026-10-10T16:30:00.124Z",
      "symbol": "rNVDAUSDT",
      "marketContextHash": "sha256:4a8b9c0d1e2f3a4b5c6d...",
      "councilDeliberation": {
        "macroBoy": { "sentiment": "BULLISH_EARNINGS_LEAK", "confidence": 0.88 },
        "quantBoy": { "basisEdgePct": 2.45, "hurdleDragPct": 0.62, "action": "BUY_BASIS" },
        "riskBoy": { "marginUtil": 0.42, "tradeSizeUsd": 3200, "verdict": "APPROVED" }
      },
      "execution": {
        "venue": "Bitget v2 Spot",
        "orderId": "bg_ord_8829104",
        "latencyMs": 38.4
      },
      "receiptSignature": "sha256:d8e9f0a1b2c3d4e5..."
    }
    ```

---

### Section 5: Interactive Sandbox & Scenario Replay
* **Header:** Test the Council Without Capital Risk
* **Sub-header:** Inject market scenarios and watch the 4 agents deliberate, calculate, and gate trades in real time.
* **Preset Interactive Scenarios:**
  1. **Scenario 1: Off-Hours Earnings Beat (+3.4% Basis Dislocation):**
     * *Flow:* Macro Boy detects earnings announcement $\rightarrow$ Quant Boy confirms $2.1\%$ net edge after hurdle $\rightarrow$ Risk Boy confirms $38\%$ margin util $\rightarrow$ **Execution Approved**.
  2. **Scenario 2: Thin Orderbook / High Fee Drag (Negative Edge):**
     * *Flow:* Token price is elevated, but L2 spread is wide ($1.8\%$) $\rightarrow$ Quant Boy detects net edge is $-0.3\%$ $\rightarrow$ **Trade Refused (Hurdle Failure)**.
  3. **Scenario 3: Flash Margin Spike (Risk Hard Veto):**
     * *Flow:* High basis opportunity, but simulated account margin utilization hits $71\%$ ($>65\%$ limit) $\rightarrow$ Risk Boy triggers **Deterministic Hard Veto**.

---

### Section 6: Live Performance Telemetry & Execution Proof Ledger
* **Header:** Verified Execution & Historical Telemetry
* **Sub-header:** Transparent trading logs, empirical returns, and downloadable audit trails.
* **Component Architecture:**
  * **Key Metrics Grid:**
    * *Sharpe Ratio:* $2.84$ (Observed in Out-of-Sample Backtest).
    * *Win Rate:* $68.7\%$.
    * *Max Drawdown:* $3.2\%$.
    * *Average Execution Latency:* $39.4\text{ms}$.
  * **Live Stream of Recent Executions:** Scrollable table showing Timestamp, Instrument, Direction, Price, Quantity, Margin Delta, and Receipt Hash link.
  * **Download Buttons:** Download `paper_trades.csv` and `reasoning_receipts.jsonl`.

---

### Section 7: Target Personas & Technology Stack
* **Header:** Institutional Substrate & Target Use Cases
* **Component Architecture:**
  * **Target Personas:**
    * *Quant Arbitrageurs:* Systematic 24/7 off-hours basis extraction.
    * *RWA Issuers & Market Makers:* Continuous liquidity provision during market dark hours.
    * *Crypto Hedge Desks:* Tokenized equity exposure with provable, deterministic risk bounds.
  * **Technology Stack Badges:** Bitget API v2, Reality rTokens, Alibaba Cloud DashScope (Qwen-Plus), TypeScript, Node.js, Web Crypto, Tailwind CSS, Playwright.

---

## 4. UI/UX & Design Token Architecture

The visual theme follows an obsidian, cybernetic fintech aesthetic (inspired by modern developer-first platforms like Upstash and Moneliq).

```css
:root {
  /* Surface colors */
  --bg-primary: #07090e;
  --bg-secondary: #0d111a;
  --bg-tertiary: #131824;
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-active: rgba(52, 211, 153, 0.35);

  /* Accents */
  --accent-emerald: #10b981;
  --accent-emerald-glow: rgba(16, 185, 129, 0.15);
  --accent-cyan: #06b6d4;
  --accent-amber: #f59e0b;
  --accent-rose: #f43f5e;

  /* Typography */
  --font-sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: "JetBrains Mono", monospace;
}
```

---

## 5. Verification & Testing Requirements

Any implementation of this landing page must satisfy the following automated Playwright E2E verification checks:

1. **Section Completeness:**
   * Contains dedicated headings for Hero, Ingestion Grounding, 4-Agent Council, Invariants & Receipts, Interactive Sandbox, and Performance Telemetry.
2. **Interactive Elements:**
   * Scenario buttons in the Sandbox trigger dynamic visual state updates.
   * Receipt viewer displays copyable, structured JSON with SHA-256 hashes.
3. **No Overflow & High Responsiveness:**
   * Pass zero horizontal overflow assertions across viewport widths ($320\text{px}$, $390\text{px}$, $768\text{px}$, $1024\text{px}$, $1440\text{px}$, $1920\text{px}$).
4. **Zero Fluff / Zero Unverified Claims:**
   * Copy must remain grounded in technical mechanisms, mathematical basis definitions, and Bitget API v2 architecture.
