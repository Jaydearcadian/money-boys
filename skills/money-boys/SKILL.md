---
name: money-boys
description: Read-only access to the Money Boys agentic trading desk for tokenized US equities (rTokens on Bitget). Use when asked to inspect desk state, compute rToken-vs-equity basis dislocation, verify a sealed reasoning receipt, simulate a council deliberation, or engage the emergency halt. Holds no credentials and cannot place orders.
version: 1.0.0
license: MIT
---

# Money Boys — Read-Only Desk Access

You are connected to the Money Boys trading desk over **stdio MCP**. This server
is **read-only and audit-scoped**. It holds no API keys and **cannot place,
cancel, modify, or dispatch any order.**

## What you CAN do

| Tool | Use it for |
|---|---|
| `money_boys_get_desk_state` | Halt status, recorded halt mutations, dispatch authority |
| `money_boys_calculate_basis_dislocation` | rToken price vs underlying equity: basis, friction hurdle, net edge |
| `money_boys_verify_reasoning_receipt` | Verify a SHA-256 seal on a reasoning or emergency-halt receipt |
| `money_boys_simulate_deliberation` | Run a council deliberation and get a sealed **proposal** |
| `money_boys_emergency_halt` | Engage / release the emergency halt (state mutation, receipt-sealed) |

## What you CANNOT do — do not attempt

There is **no order placement, cancellation, or dispatch tool.** It is
deliberately absent. If you need a trade, you produce a **proposal**; a human
authorises execution.

Do not try to synthesize, guess, or shell out to an order endpoint. The LLM has
**no order authority** in this system (Invariant I-01). That is a safety
property, not a missing feature.

## How to read a basis result

`calculate_basis_dislocation` returns `action`, `rawBasisPct`, `hurdleRatePct`,
`netEdgePct`. Read them in that order:

1. **`rawBasisPct`** — raw dislocation. `+0.5%` means the rToken trades 0.5%
   above the equity it tracks.
2. **`hurdleRatePct`** — the friction you must clear first. This is **not** a
   constant; it depends on `executionStyle`:
   - `passive` — maker fee + adverse selection. **This is the correct default.**
     Posting a resting limit does not pay taker fees.
   - `aggressive` — taker fee + real VWAP impact. Only for crossing orders.
3. **`netEdgePct`** — `rawBasisPct − hurdleRatePct`. **If this is negative, the
   trade does not clear its own costs.** Report that plainly. A negative
   net edge is a normal, useful result, not a failure to hide.

**Common mistake to avoid:** quoting a basis move as if it were profit. A
+0.05% basis against a 0.12% taker hurdle is *not* an opportunity. Use
`executionStyle: "passive"` unless the operator says otherwise.

## Session regimes

- **TradFi open** — equity quotes live; basis is measurable.
- **TradFi closed, rToken open** — rTokens trade 24/7 while the equity is shut.
  Weekend/holiday basis is carry, not dislocation. Do not present it as an
  opportunity to trade against a stale close.
- **Emergency halt engaged** — `simulate_deliberation` refuses. Do not attempt
  to work around it. Report the halt and the receipt that sealed it.

## Operating rules

1. **Never claim an order was placed.** This server cannot place one.
2. **Always quote the execution style** alongside any edge figure. The hurdle
   depends on it.
3. **Verify receipts, don't trust them.** Use `verify_reasoning_receipt`; report
   the returned `receiptType` and `untampered` verbatim.
4. **The emergency halt is receipt-sealed.** State the `receiptHash` when you
   engage or release it.
5. **Proposals are not executions.** `simulate_deliberation` returns
   `dispatched: false` and always will.