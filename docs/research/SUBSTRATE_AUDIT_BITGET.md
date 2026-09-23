# Substrate Audit — Bitget API v2 (Phase 01)

## Native Capabilities

- Public market data (tickers, order books) over REST
- Private account/trading routes with HMAC-SHA256 API key auth
- Spot and margin product families (exact symbol set TBD)
- WebSocket streams for low-latency market data (not yet wired)

## Current Deployed Behavior (observed)

- Public `BTCUSDT` ticker returns `lastPr` / bid / ask as strings (see `foundry/evidence/p01/auth_test.json`)
- Private account assets path implemented in client; **not** LIVE-confirmed without `BITGET_*`

## Existing Standards

- Bitget API v2 official docs (signing, error `code` field)
- Foundry evidence vocabulary for claim promotion

## Existing APIs / Contracts

- REST base `https://api.bitget.com`
- Client: `packages/engine/src/bitget/client.ts`

## Existing Security / Authority Model

- Exchange holds balances; API keys are operator secrets
- LLM must never receive signing material (I-01)

## What the Substrate Already Solves

- Order matching, custody of exchange balances, market data dissemination

## What It Does Not Solve

- Deterministic desk-side risk veto
- Reasoning receipt / audit seal
- Proposal-only LLM boundary
- rToken / Reality settlement narrative

## Proposed Residual Gap

Desk-side **Risk Boy + ReasoningReceipt + proposal boundary** before any private trade route.

## Architecture Delta

Thin TS client + pure risk/receipt modules — not a wrapper that renames Bitget endpoints as a “primitive.”

## Why a New Primitive Is Justified

S2 agentic lane needs **defensible autonomy**, not another thin SDK. The primitive is the sealed, vetoed dispatch path.

## Alternative: Compose Instead of Build

Compose Bitget + DashScope directly in scripts — rejected for I-01/I-02/I-03 auditability.

## Evidence

- `foundry/evidence/p01/auth_test.json` (public TESTED)

## Falsification Condition

If Bitget natively enforced desk-style 65% margin / $5k / receipt seals for our agent flow without local guards, building Risk/Receipt would be unjustified. It does not.
