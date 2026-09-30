# Money Boys

Autonomous two-speed agentic trading desk for tokenized US equities, built for Bitget S2.

Research proposes. Quant calculates. Risk vetoes. Council decides. A receipt seals. Money Boys dispatches. The venue is read back.

## What it is

A two-path trading desk. A **warm path** runs agentic research and produces typed proposals. A **hot path** turns those proposals into orders only after deterministic risk checks, a council vote, and a cryptographic seal. The LLM never touches an exchange credential.

## The opportunity

Tokenized equities keep trading after TradFi closes. The roughly **65.5-hour Friday-close to Monday-open window** is the highest-opportunity regime, but the desk is designed to trade any week whenever a fresh, verifiable basis dislocation exists. The symbol universe is configurable; rNVDA, rTSLA and rAAPL are illustrative.

## The problem

LLM-direct execution is unsafe: a model that can sign can be talked into signing. Script-only bots have the opposite failure, they trade without research and cannot explain why. Neither combines flexible intelligence with deterministic execution authority and defensible evidence.

## The solution

```text
  research / perception adapters      bitget-signal, MCP, GetAgent (read-only)
            |
            v
  Macro Boy + Quant Boy                typed proposals, SHA-256 provenance
            |
            v
  Risk Boy HARD_VETO                   65% margin ceiling, $5k cap, free-margin floor
            |
            v
  Council reducer                     weighted vote, quorum gate, scale-down
            |
            v
  SHA-256 ReasoningReceipt            no seal, no order
            |
            v
  Money Boys dispatcher               the only component with order authority
            |
            v
  Venue + read-back                    order state, fills, position, Foundry evidence
```

External tools feed **in** at the top. None of them can dispatch, sign, or write portfolio state.

## Safety guarantees

| Guarantee | Enforcement |
|---|---|
| No direct LLM order authority | proposal-only schemas; LLM output is untrusted input |
| 65% margin utilization ceiling | `StructuralChangeGuard`, deterministic, no LLM import |
| $5,000 single-trade cap | same guard, checked before dispatch |
| Free-margin floor | same guard |
| Council quorum required | weighted reducer, quorum gate, 50% scale-down on soft reject |
| SHA-256 ReasoningReceipt | no sealed APPROVED receipt, no dispatch |
| Fail-closed benchmark | unreachable TradFi feed seals HARD_VETO with zero execution |
| Fail-closed auth | missing credentials throw on boot; the system never simulates |
| Emergency halt | telemetry endpoint halts dispatch, returns 403, verified in smoke test |
| No unbounded trading loop | all venue activity has been explicitly bounded and authorized |

## Current verified status

Status vocabulary: `TESTED` = verified locally with evidence. `LIVE_DEMONSTRATED` = verified against a real venue.

| Capability | State | Evidence | Limitation |
|---|---|---|---|
| Bitget authenticated private read | LIVE_DEMONSTRATED | [`p01/auth_test.json`](./foundry/evidence/p01/auth_test.json) | Demo Trading only, not production |
| Risk Boy HARD_VETO | TESTED | [`p02/risk_guard.txt`](./foundry/evidence/p02/risk_guard.txt) | Conservative 1x margin model |
| ReasoningReceipt SHA-256 seal | TESTED | [`p01/receipts_seal.txt`](./foundry/evidence/p01/receipts_seal.txt) | Local; bound on venue via the dispatcher gate |
| Quant Boy basis engine | TESTED | [`p02/quant_engine.txt`](./foundry/evidence/p02/quant_engine.txt) | Mid-price slippage reference |
| Macro Boy cognitive shield | TESTED | [`p03/cognitive_shield.txt`](./foundry/evidence/p03/cognitive_shield.txt) | Gateway path exercised, proposal-only |
| Council quorum + reducer | TESTED | [`p04/council_quorum.txt`](./foundry/evidence/p04/council_quorum.txt) | Deterministic |
| Telemetry, SSE, emergency halt | TESTED | [`p08/stack_smoke.json`](./foundry/evidence/p08/stack_smoke.json) | Local ports 3000/3001, 6/6 checks |
| Demo order accepted and filled | LIVE_DEMONSTRATED | [`p06/demo_order_filled.json`](./foundry/evidence/p06/demo_order_filled.json) | 0.001 BTCUSDT, Demo Trading |
| Demo position closed, account flat | LIVE_DEMONSTRATED | [`p06/demo_position_closed.json`](./foundry/evidence/p06/demo_position_closed.json) | Demo Trading |
| Dispatcher lifecycle on venue | LIVE_DEMONSTRATED | [`p07/dispatcher_lifecycle.json`](./foundry/evidence/p07/dispatcher_lifecycle.json) | Market orders only, no cancel path |
| Bitget hackathon adapters | TESTED | [`integrations/bitget/`](./packages/engine/src/integrations/bitget/) | **No live adapter validation yet** |

Full ledgers: [`claims`](./foundry/claims.jsonl) and [`gaps`](./foundry/gaps.jsonl).

## Demo journey

What actually happened, in order, with venue evidence for each step:

1. **Authenticated read.** `GET /api/v2/spot/account/assets` returned Bitget code `00000` on the Demo Trading route.
2. **Sealed proposal.** A ReasoningReceipt was produced and its SHA-256 hash verified.
3. **Risk allow.** Exposure $83.04 against a $5,000 cap, 1.7% utilization.
4. **First order rejected.** Venue code `40774`. Root cause: the account is in hedge mode and the request omitted `tradeSide`. Fixed with an explicit position mode.
5. **Order accepted and filled.** Venue orderId `1489095619363635201`, filled 0.001 BTC at 83,364.4, fee 0.05001864 USDT.
6. **Read-back.** Order state `filled`, then a short position confirmed via `GET /api/v2/mix/position/all-position`.
7. **Defect found.** The close was rejected with `40786 Duplicate clientOid`. `clientOid` was derived from the receipt alone, so an open and a close from identical receipt data collided. Fixed by binding intent into the digest.
8. **Close filled and account flat.** Order `1489110831718367233`, then the residual flattened by `1489110998534225921`.
9. **Veto proven on venue.** A VETOED receipt was offered to the dispatcher; it threw before any network call.

Every claim above is checkable against the JSON under `foundry/evidence/`. Two corrections to earlier claims are recorded in the evidence rather than quietly patched: the Demo venue *does* expose order read-back routes, and receipt-derived `clientOid` was *not* safe for distinct intents.

## Three meanings of "live"

1. **Live market data and authentication** — proven. Real Bitget servers, authenticated, code `00000`.
2. **Live Bitget Demo trading** — proven. Real orders, real fills, real read-back, account returned flat.
3. **Live real-capital trading** — not done, and not the next step.

## What is not proven

Read this before trusting any number in this repo.

- **No real capital has moved.** Every order was on Bitget Demo Trading (`paptrading: 1`), using Demo-scoped keys and a simulated balance.
- **The strategy has not run as a system.** Orders exercised the dispatcher, risk, receipt and council gates, but not a continuous tokenized-equity basis campaign.
- **All orders were market orders.** No limit orders, no partial fills, no resting orders, no cancel path, no SL/TP.
- **No funding was observed.** Every round trip closed within seconds, so no position crossed a funding settlement interval.
- **The paper daemon has never run against a venue.** No bounded campaign, no continuous loop, no reconciliation evidence.
- **The integration adapters have zero live validation.** They pass 103 tests without having contacted a real MCP endpoint or fetched a real Playbook artifact.
- **Paper backtest numbers are not performance claims.** Reported win rate of 100% and max drawdown of 0% are artifacts of a deterministic setup on synthetic depth, not evidence of edge.
- **Single symbol, single size.** Every venue order was 0.001 BTCUSDT. No sizing sweep, no multi-symbol run.

## Quickstart

```bash
pnpm install
pnpm verify            # typecheck, 103 tests, desk build, foundry checks, secret scan
```

Optional, needs Bitget Demo credentials in a gitignored `.env`:

```bash
export BITGET_ENV=testnet
pnpm --filter @money-boys/engine test:auth    # Phase 01 auth gate, writes evidence
```

Never commit exchange credentials. A repository secret scan covers Bitget key shapes and credential assignments and runs inside `pnpm verify`.

## Evidence

| Ledger | Path |
|---|---|
| Claims | [`foundry/claims.jsonl`](./foundry/claims.jsonl) |
| Gaps | [`foundry/gaps.jsonl`](./foundry/gaps.jsonl) |
| State | [`foundry/state.json`](./foundry/state.json) |
| Evidence | [`foundry/evidence/`](./foundry/evidence/) |
| Integration audit | [`docs/research/bitget-agentic-playbook-audit.md`](./docs/research/bitget-agentic-playbook-audit.md) |

## Architecture

- [`PRD.md`](./PRD.md) — product intent
- [`docs/product/PRODUCT_THESIS.md`](./docs/product/PRODUCT_THESIS.md) — thesis
- [`docs/canonical/AUTHORITY_MODEL.md`](./docs/canonical/AUTHORITY_MODEL.md) — who may do what
- [`docs/canonical/STATE_MODEL.md`](./docs/canonical/STATE_MODEL.md) — claim and gap vocabulary
- [`BUILD_FOUNDRY.md`](./BUILD_FOUNDRY.md) — evidence standard
- [`AGENTS.md`](./AGENTS.md) — agent rules

## Roadmap

1. **Bounded Demo strategy campaign** on the configured tokenized-equity universe: fixed symbols, fixed small notional, explicit order cap, flat after each cycle, every decision captured. Proves the strategy pipeline, not just the dispatcher.
2. **Continuous Demo/paper run** once the campaign passes: fixed time window, graceful shutdown, no duplicate intent execution, risk halt behavior.
3. **Live-read phase**: real data and account reads, no order placement. Confirms benchmark freshness, symbol mapping, basis math, venue permissions, sizing, reconciliation.
4. **Real-capital trading** is a separate authorization gate, not an automatic consequence of Demo success. It would require explicit environment selection, approved live credentials, a pre-write packet, bounded notional, emergency halt, verified read-back, and approval immediately before submission.

## Submission notes

What a reviewer can verify independently:

- Run `pnpm verify`. 103 tests, typecheck, build, Foundry consistency, secret scan.
- Read `foundry/claims.jsonl` and `foundry/gaps.jsonl`. Claims are graded, gaps are tracked, and nothing is marked live without venue evidence.
- Inspect the Demo order evidence JSON. Real order IDs, real fill prices, real fees, real read-back responses from Bitget.
- Confirm the account is flat. The last verified position read returned no open BTCUSDT row.

What to be skeptical of: the backtest summaries under `foundry/evidence/paper-trading/`. They show a 100% win rate and 0% drawdown, which are artifacts of deterministic synthetic depth, not a strategy result. The ledger records that discrepancy rather than hiding it.

Repository status is `IN_PROGRESS`. Not complete, and honest about where.
