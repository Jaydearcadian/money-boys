# Phase 01 — Bitget substrate gate

STATUS: PASS  
OWNER: desk/engine

## Objective

Prove Bitget API v2 is a viable substrate: public market data works; private HMAC auth path exists and can be LIVE_DEMONSTRATED when credentials are present.

## Why this phase exists

No trading desk claim is defensible before the exchange client is real. Foundry §4 substrate audit + first vertical slice.

## Admitted scope

- `packages/engine` Bitget client (public + signed private GET)
- `test-auth.ts` Phase 01 gate + evidence JSON
- Foundry ledgers for CLM-001 / GAP-001

## Explicitly excluded

- Order placement
- Risk Boy / receipts / council / Macro Boy
- Desk UI
- Reality rToken settlement

## Preconditions

- Network egress to `api.bitget.com`
- Optional: `BITGET_API_KEY`, `BITGET_SECRET_KEY`, `BITGET_PASSPHRASE` in env (never committed)

## Invariants

- I-05: plain TS + Zod + fetch/crypto only
- No secrets in git

## Deliverables

- [x] BitgetClient with public ticker + sign helper
- [x] test-auth gate writing `foundry/evidence/p01/auth_test.json`
- [x] CLM-001 in claims ledger (TESTED public)
- [x] LIVE_DEMONSTRATED private auth when keys available — proven 2026-09-30 (`authConfirmed: true`, `authCode: 00000`, evidence `foundry/evidence/p01/auth_test.json`, commit 2077051). Scope: authenticated read only; no order placement.

## Required verification

```bash
pnpm --filter @money-boys/engine test
pnpm --filter @money-boys/engine test:auth
pnpm verify
```

## Live verification

Required for full CLM-001: **YES** (private auth)  
Public ticker live-read: already sampled in p01 evidence.

## Evidence required

- `foundry/evidence/p01/auth_test.json`
- unit test for client construction

## Exit gate

Phase PASS only when:

1. Public ticker path TESTED with live sample evidence  
2. If keys present: `authConfirmed: true` and CLM-001 → LIVE_DEMONSTRATED  
3. If keys absent: phase may remain IN_PROGRESS with GAP-001 BLOCKED_EXTERNAL — **do not claim LIVE auth**  
4. `pnpm verify` green  
5. No secrets in tree  

## Stop conditions

- Bitget API unreachable and no alternative documented
- Signing algorithm contradicts official docs (record contradiction)

## Known non-goals

- Trading, risk, LLM paths
