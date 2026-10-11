# Money Boys — In-App Dashboard & Sandbox Technical Specification

> **Document Purpose:** Complete implementation and refinement blueprint for the Money Boys In-App Dashboard & Sandbox. This specification defines the visual design system (deconstructed from the Lunor reference), component hierarchy, data models, interactive sandbox scenarios, routing integration with the landing page, and automated verification requirements.

---

## 1. Executive Summary & Product Objective

The **In-App Dashboard & Sandbox** is the operational cockpit of Money Boys. While the landing page introduces the product in plain language, the in-app dashboard provides a high-density, institutional-grade interface for traders, quants, and auditors to:
1. **Monitor Live Market Telemetry:** Track real-time basis spreads between Reality rTokens on Bitget API v2 and US equity closing benchmarks.
2. **Inspect the 4-Agent Decision Council:** Observe the real-time deliberations of Macro Boy, Quant Boy, Risk Boy, and Execution Boy.
3. **Execute Interactive Sandbox Scenarios:** Inject custom or preset off-hours market events, test mathematical hurdle clearance, and observe deterministic risk vetoes in real time.
4. **Audit Cryptographic ReasoningReceipts:** Inspect and verify SHA-256 sealed provenance receipts directly in the browser.

---

## 2. Visual Design System (Lunor Reference Deconstruction)

The visual design follows the dark, matte obsidian aesthetic of the **Lunor Dashboard reference** (`https://pin.it/218ZrvUON`):

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [Logo] Money Boys   │ Dashboard / Live Overview                                 [ Export Logs v] │
│ 🔍 Search [/]       │ Autonomous 24/7 Arbitrage Desk                            [ Market: CLOSED]│
│                     ├──────────────────┬──────────────────┬──────────────────┬───────────────────┤
│ ▦ Desk Overview     │ Monitored Tokens │ Margin Health    │ Total Receipts   │ Hot-Path Latency  │
│ 🗠 4-Agent Council   │ 4 Active         │ 38.4% (<65%)     │ 151 Sealed       │ 38.2 ms           │
│ ⚡ Sandbox Lab       ├──────────────────┴──────────────────┼──────────────────┴───────────────────┤
│ 🔒 Receipts Audit   │ Live Basis vs Hurdle Drag Curve     │ Live 4-Agent Decision Feed          │
│ 📋 Execution Logs   │ [Area / Line Chart with Net Edge]   │ • rNVDA: APPROVED (Fill $132.71)    │
│                     │                                     │ • rTSLA: VETOED (Margin > 65%)      │
│ • rNVDAUSDT (Blue)  │                                     │ • rAAPL: SKIPPED (Edge < Hurdle)    │
│ • rAAPLUSDT (Amber) ├─────────────────────────────────────┴─────────────────────────────────────┤
│ • rTSLAUSDT (Green) │ Interactive Scenario Sandbox                                              │
│                     │ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌────────────────┐  │
│ [ Engine Status ]   │ │ 1. Earnings   │ │ 2. Thin Book  │ │ 3. Margin     │ │ 4. Oversize    │  │
│ [  EMERGENCY HALT ] │ │ [Simulate]    │ │ [Simulate]    │ │ [Simulate]    │ │ [Simulate]     │  │
└─────────────────────┴─┴───────────────┴─┴───────────────┴─┴───────────────┴─┴────────────────┴──┘
```

### 2.1 Color Palette & Surface Hierarchy
```css
:root {
  /* Surfaces */
  --dash-bg: #0c0e12;               /* Base application canvas */
  --dash-sidebar: #0f1117;          /* Left navigation rail */
  --dash-card: #151821;             /* Primary elevated container */
  --dash-card-hover: #1a1e2a;       /* Interactive card hover */
  --dash-card-recessed: #0a0b0f;    /* Inputs, code blocks, metric insets */
  --dash-border: rgba(255, 255, 255, 0.07);
  --dash-border-active: rgba(255, 255, 255, 0.18);

  /* Typography Colors */
  --dash-text-primary: #ffffff;
  --dash-text-secondary: #a0a5b2;
  --dash-text-muted: #656b7c;

  /* Tactical Accents */
  --dash-accent-emerald: #34d399;    /* Approvals, profits, active status */
  --dash-accent-amber: #f59e0b;      /* Warnings, off-hours session */
  --dash-accent-rose: #fb7185;       /* Risk hard-vetoes, errors */
  --dash-accent-cyan: #06b6d4;       /* Math, quant, basis curves */
  --dash-accent-indigo: #818cf8;     /* Macro intelligence, models */
}
```

### 2.2 Typography & Shape Geometry
* **Font Sans:** `Plus Jakarta Sans`, `-apple-system`, sans-serif (Headings, buttons, labels).
* **Font Mono:** `JetBrains Mono`, monospace (Asset prices, percentages, latencies, hashes, JSON).
* **Geometry:** Card border-radius `14px`–`16px`; inner micro-tiles `8px`–`10px`; pill buttons `999px`.
* **Borders & Shadows:** Subtle 1px translucent borders with soft ambient drop shadow (`box-shadow: 0 8px 32px rgba(0, 0, 0, 0.36)`).

---

## 3. Landing Page & In-App Routing Integration

### 3.1 Hash Routing Contract (`packages/desk/src/App.tsx`)
The application uses hash-based routing to support static/embedded previews and SPA switching without full page reloads:

| Route Hash | View Rendered | Initial Tab / View |
| :--- | :--- | :--- |
| `#/` or `""` | `HomePage` | Landing page |
| `#/app` or `#/dashboard` | `DashboardPage` | `tab="overview"` |
| `#/sandbox` | `DashboardPage` | `tab="sandbox"` (Pre-selected Sandbox view) |
| `#/receipts` | `DashboardPage` | `tab="receipts"` (Receipt Explorer) |
| `#/logs` | `DashboardPage` | `tab="logs"` (Execution trade log) |

### 3.2 Landing Page Pill Buttons
On the landing page ([`HomePage.tsx`](file:///home/ubuntu/money-boys/packages/desk/src/pages/home/HomePage.tsx)), the call-to-action pill buttons should route directly into the in-app dashboard:
* **Top Header Nav Pill:** `href="#/sandbox"` ("Try the sandbox" or "Open the desk")
* **Hero CTA Primary Button:** `href="#/sandbox"` ("Try the sandbox" / "Enter the desk")
* **Footer Final CTA Button:** `href="#/sandbox"` ("Open In-App Desk")

---

## 4. Comprehensive Layout Architecture (5 Operational Zones)

The dashboard layout is split into 5 core operational zones:

---

### Zone 1: Left Navigation Rail & Safety Controls (Width: 240px)
1. **Workspace / Brand Header:**
   * Money Boys Logo + title `Money Boys Desk`.
   * Mode pill: `● LIVE PAPER DESK` or `● SANDBOX REPLAY`.
2. **Omni-Search Input (`/` shortcut):**
   * Filter symbols (`rNVDA`, `rAAPL`), receipt hashes, or logs.
3. **Primary Navigation Tabs:**
   * `Desk Overview` (Icon: Grid) $\rightarrow$ Full telemetry and KPI dashboard.
   * `4-Agent Council` (Icon: Sparkles) $\rightarrow$ Macro, Quant, Risk, Execution node matrix.
   * `Interactive Sandbox` (Icon: Lightning) $\rightarrow$ Scenario builder & runner.
   * `Reasoning Receipts` (Icon: Lock) $\rightarrow$ Cryptographic proof ledger browser.
   * `Execution Logs` (Icon: Terminal) $\rightarrow$ Raw Bitget v2 paper trade fills.
4. **Tracked Asset Watchlist (Colored folder/tag markers):**
   * 🔵 `rNVDAUSDT` (Tokenized Nvidia)
   * 🟡 `rAAPLUSDT` (Tokenized Apple)
   * 🟢 `rTSLAUSDT` (Tokenized Tesla)
   * 🟣 `rSPYUSDT` (Tokenized S&P 500)
5. **Bottom Safety & Status Card:**
   * Engine Status: `Bitget API v2: CONNECTED` · `Sub-50ms Hot Path: NOMINAL`.
   * **Emergency Halt Button:** Red-accented `[ EMERGENCY HALT ]` button that toggles the fail-closed safety state (`I-01` / `I-02`).

---

### Zone 2: Top KPI Summary Row (4 Modular Metric Cards)

| Metric Card | Primary Value | Subtitle / Indicator | Visual Tile Graphic |
| :--- | :--- | :--- | :--- |
| **1. Monitored Gaps** | `4 Active Pairs` | `Avg Off-Hours Basis: +1.42%` | Dual-curve price badge |
| **2. Margin Health** | `38.4%` (Limit: 65%) | `Free Collateral: $12,320` | Risk Boy shield with green check |
| **3. Sealed Receipts** | `151 Receipts` | `29 Executed · 10 Vetoed` | Cryptographic padlock seal |
| **4. Hot-Path Latency**| `38.2 ms` | `Bitget v2 Target <50ms` | Lightning bolt activity pulse |

---

### Zone 3: Central Analytical Centerpiece (65% Width)
* **Title & Timeframe Controls:** `Live Basis Spread vs Hurdle Drag (rNVDAUSDT)` with selectors `[ 1H | 24H | Weekend | 7D ]`.
* **Interactive Area / Line Chart:**
  * **Solid Line:** Observed token price vs equity benchmark closing price ($\text{Basis \%}$).
  * **Dashed Line:** Dynamic Hurdle Drag ($\text{Fees} + \text{Slippage} + \text{Borrow Funding Rate}$).
  * **Shaded Hatch Area:** **Net Edge Arbitrage Window** where execution is mathematically profitable.
* **Hover Data Inspection:**
  * Displays: `Token Mid: $133.40` | `Benchmark Close: $130.00` | `Hurdle: 0.62%` | `Net Edge: +2.00%`.

---

### Zone 4: Live Decision Feed (35% Width)
* **Title & Filter:** `Live Decision Feed` + Search.
* **Dense Stream Rows:**
  * Row 1: `rNVDAUSDT` — `BUY_BASIS` — `APPROVED` — `Fill: $132.71` (3/3 consensus)
  * Row 2: `rTSLAUSDT` — `VETOED` — `Risk Boy: Margin 71% > 65% limit`
  * Row 3: `rAAPLUSDT` — `SKIPPED` — `Quant Boy: Spread 0.4% < 0.95% Hurdle`
  * Row 4: `rCOINUSDT` — `BUY_BASIS` — `APPROVED` — `Fill: $214.20`
* **Click Action:** Clicking any row opens the full **SHA-256 ReasoningReceipt Slide-Over Drawer**.

---

### Zone 5: Bottom Interactive Sandbox & Scenario Lab (4 Cards Grid)

Matching the 4 bottom folder cards in the Lunor reference:

1. **Card 1: Weekend Earnings Surprise (`rNVDA`)**
   * *Preview Tile:* Green surge chart + `Quorum: 4/4 Consensual`.
   * *Description:* Off-hours earnings release creates a $+3.4\%$ token price jump.
   * *Action Buttons:* `[ Run Step-Through ]` · `[ View Receipt ]`.
2. **Card 2: Thin Orderbook / High Slippage (`rAAPL`)**
   * *Preview Tile:* Wide L2 spread graphic + `Hurdle Veto`.
   * *Description:* $+0.5\%$ token premium wiped out by $0.95\%$ orderbook slippage.
   * *Action Buttons:* `[ Run Step-Through ]` · `[ Inspect Book ]`.
3. **Card 3: Overstretched Account Margin (`rTSLA`)**
   * *Preview Tile:* Amber alert icon + `Deterministic Hard Veto`.
   * *Description:* High basis opportunity ($+2.8\%$), but simulated margin hits $71\%$. Risk Boy blocks dispatch.
   * *Action Buttons:* `[ Run Step-Through ]` · `[ View Invariant ]`.
4. **Card 4: Trade Sizing Exceeds Cap (`rNVDA`)**
   * *Preview Tile:* Size limit badge + `Invariant I-02 Veto`.
   * *Description:* Attempted trade allocation of $\$7,500$ exceeds the hard $\$5,000$ limit.
   * *Action Buttons:* `[ Run Step-Through ]` · `[ Trace Veto ]`.

---

## 5. Component & Code Architecture

### 5.1 Proposed Directory Structure
```text
packages/desk/src/
├── App.tsx                              # Hash router (HomePage vs DashboardPage)
├── pages/
│   ├── home/
│   │   ├── HomePage.tsx                 # Public landing page (with #/sandbox pills)
│   │   └── home.css                     # Landing styles
│   └── dashboard/
│       ├── DashboardPage.tsx            # Main dashboard shell & state provider
│       ├── dashboard.css                # Lunor-themed dashboard CSS
│       ├── components/
│       │   ├── Sidebar.tsx              # Left navigation rail + Emergency Halt
│       │   ├── TopHeader.tsx            # Breadcrumbs, session status, export
│       │   ├── KpiRow.tsx               # 4 KPI summary cards
│       │   ├── BasisChart.tsx           # Dual-line chart with net edge hatch
│       │   ├── DecisionFeed.tsx         # Live streaming cycle list
│       │   ├── ScenarioGrid.tsx         # 4 Interactive sandbox cards
│       │   └── ReceiptDrawer.tsx        # Slide-over JSON receipt inspector
│       └── tabs/
│           ├── OverviewTab.tsx          # Default full dashboard
│           ├── CouncilTab.tsx           # Deep dive into 4 agents
│           ├── SandboxTab.tsx           # Full sandbox lab
│           └── ReceiptsTab.tsx          # Cryptographic receipt audit ledger
```

### 5.2 Client-Side Cryptographic Receipt Helper
Every sandbox deliberation or live cycle generates a verifiable SHA-256 receipt:
```typescript
export async function generateReasoningReceipt(data: Record<string, unknown>): Promise<{ json: string; hash: string }> {
  const json = JSON.stringify(data, null, 2);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  const hash = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { json, hash };
}
```

---

## 6. Automated Testing & Verification Requirements

When implemented, the in-app dashboard must pass Playwright E2E verification (`packages/desk/e2e/dashboard.spec.ts`):

1. **Routing & Entry:**
   * Clicking "Try the sandbox" on the landing page immediately opens `#/sandbox` and renders the dashboard.
2. **KPI & Chart Rendering:**
   * All 4 KPI cards render valid metrics without undefined/null strings.
   * The basis chart renders without canvas/SVG layout errors.
3. **Interactive Sandbox Scenarios:**
   * Clicking "Run Step-Through" on any of the 4 scenario cards updates the decision feed and triggers real-time evaluation.
   * The Risk Boy hard veto triggers reliably when margin $>65\%$ or size $>\$5,000$.
4. **Receipt Inspection:**
   * Opening a receipt displays valid JSON with a 64-character hexadecimal SHA-256 hash.
5. **No Horizontal Overflow:**
   * Responsive layout adapts cleanly from $320\text{px}$ to $1920\text{px}$.
