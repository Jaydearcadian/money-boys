# EVIDENCE_LEDGER

| Claim | State | Evidence paths | Notes |
|---|---|---|---|
| CLM-001 Bitget substrate | TESTED | `foundry/evidence/p01/auth_test.json`, `packages/engine/src/bitget/*` | Public live-read; private auth deferred |
| CLM-002 Risk HARD_VETO | PROPOSED | — | |
| CLM-003 ReasoningReceipt | PROPOSED | — | |

## Provenance rules

- Evidence must name commit SHA once git history exists
- Dirty worktree ≠ release evidence (Foundry §6)
- Do not reuse another HEAD’s logs as current proof
