# Architecture — Money Boys

**Status:** design + partial substrate (Bitget client). Not a claim of full desk implementation.

## Actors

| Actor | Role | Authority |
|---|---|---|
| Operator | Configures keys, runs gates, reviews evidence | Owns credentials; never in git |
| Macro Boy (warm) | LLM proposer (DashScope) | **Proposal only** (I-01) |
| Council / skills | Score/filter proposals | Advisory; no signing |
| Risk Boy | Deterministic interceptor | HARD_VETO (I-02) |
| Receipt sealer | SHA-256 ReasoningReceipt | Required before dispatch (I-03) |
| BitgetClient | HTTP/WS adapter | Only path to exchange |
| Desk | Operator UI (future) | Display + controls; no bypass of risk |

## Execution domains

```text
WARM PATH (async)                HOT PATH (<50ms target)
───────────────                  ───────────────────────
news / filings / LLM      →      proposal object (Zod)
                                 → Risk Boy (pure math)
                                 → ReasoningReceipt seal
                                 → BitgetClient private route
```

## Canonical state (engine)

- **Proposals** — typed, non-authoritative
- **RiskDecision** — ALLOW | HARD_VETO + reasons
- **ReasoningReceipt** — sealed hash + payload
- **OrderAttempt** — only after ALLOW + valid receipt
- **Evidence manifests** — under `foundry/evidence/`

Exchange balances/orders are **external state**; we never invent them.

## Package boundaries

| Package | Owns | Must not own |
|---|---|---|
| `@money-boys/engine` | Bitget client, risk, receipts, agents, council | Secrets, UI |
| `@money-boys/desk` | Operator surfaces (future) | Signing keys, silent dispatch |

## Trust boundaries

1. LLM output crosses into hot path **only** as validated proposal schema  
2. Env credentials enter **only** BitgetClient signing  
3. Foundry ledgers are claims about the repo — not market truth  

## What does not exist yet

- Risk Boy, receipts, council runtime, Macro Boy, WS hot path, desk UI, rToken settlement

See `docs/canonical/CURRENT_STATE.md`.
