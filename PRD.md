# PRD — Money Boys

**Status:** PROPOSED / active build  
**Lane:** Bitget S2 hackathon — Agentic Trading / Cross-Asset Execution  
**Horizon:** ~4-day vertical demo, Foundry-governed

## One-line thesis

An autonomous desk that **proposes** trades on tokenized US equity exposure via Bitget, but only **dispatches** orders after deterministic risk veto + sealed SHA-256 ReasoningReceipt — never from raw LLM authority.

## Problem

Retail/agentic trading stacks either:

1. let LLMs call exchange APIs directly (unsafe), or  
2. are pure scripts with no research/council path (dumb).

Neither gives a **demonstrable, auditable** agentic desk under Bitget S2 constraints.

## Users

- Hackathon judges / reviewers (primary demo audience)
- Operator running the desk with disposable Bitget keys (testnet/live-read as available)
- Future: desk operators needing 24/7 monitoring with hard risk brakes

## Solution statement

Money Boys is a **two-speed** TypeScript monorepo:

- **Hot path (<50ms):** market data, basis math, Risk Boy HARD_VETO, receipt seal, Bitget dispatch  
- **Warm path (async):** news/filings comprehension via DashScope (Qwen-Plus) in **proposal-only** mode  

Council / skills may score proposals; they never sign or send orders.

## Core invariants

See `AGENTS.md` I-01…I-05.

## Non-goals (this hackathon)

- Full production custody / multi-user accounts
- LangChain-style agent frameworks
- Guaranteed profitable alpha
- Mainnet capital without explicit live gate + funding
- Reality rToken full settlement stack before Bitget substrate is proven
- Heavy desk UI polish before engine gates pass

## Milestones (behavioral claims)

| ID | Claim | Required state |
|---|---|---|
| M1 / CLM-001 | Bitget API v2 public ticker works; private auth path exists (HMAC) | LIVE_DEMONSTRATED when keys present; else TESTED public |
| M2 | Risk Boy HARD_VETO is pure deterministic and unit-proven | TESTED |
| M3 | ReasoningReceipt SHA-256 seals required fields before dispatch hook | TESTED |
| M4 | Macro Boy / warm path emits proposals only (no signing keys) | TESTED |
| M5 | Narrow paper/live-read dispatch path with receipt + veto | E2E_VERIFIED / LIVE_DEMONSTRATED |

## Acceptance for demo

1. `pnpm verify` green at reported HEAD  
2. Phase gates in `foundry/phases/` with evidence paths that exist  
3. Judge can see: proposal → veto/allow → receipt hash → (simulated or live) order attempt  
4. No secret material in git or public logs  

## Out of scope until substrate audit closes residual gaps

- Full multi-agent council production topology  
- Cross-venue routing  
- Permanent hosted infra
