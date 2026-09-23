# STATE_MODEL

## Proposal (warm → hot boundary)

Zod-validated object. Never authoritative for capital movement.

## RiskDecision

- `ALLOW` + inputs snapshot  
- `HARD_VETO` + reason codes (`MARGIN_UTIL`, `SINGLE_TRADE_CAP`, `FREE_MARGIN`)

## ReasoningReceipt

Payload fields (min): rationale, catalyst provenance, synthetic basis spread, VWAP slippage hurdle, council vote vectors, proposal hash.  
`receiptHash = sha256(canonical_json)`.

## OrderAttempt

Created only if `RiskDecision=ALLOW` and receipt hash verifies. Sent only via `BitgetClient`.

## External

Bitget balances, orders, fills — read/adapt; never invented in fixtures labeled live.
