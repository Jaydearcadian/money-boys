# IMPLEMENTATION_STATUS

Status vocabulary: Foundry §2 (`PROPOSED` … `LIVE` / `BLOCKED_*`).

| Capability | Status | Evidence | Limitations |
|---|---|---|---|
| Foundry control plane | IMPLEMENTED | `foundry/state.json`, ledgers, `scripts/verify` | No commit HEAD seal |
| Bitget public ticker | TESTED | `foundry/evidence/p01/auth_test.json` | Single symbol sample |
| Bitget private auth | BLOCKED_EXTERNAL | same; `authConfirmed:false` | Needs BITGET_* |
| Risk HARD_VETO | PROPOSED | CLM-002 | — |
| ReasoningReceipt | PROPOSED | CLM-003 | — |
| Proposal-only LLM path | FUTURE | — | — |
| Council | FUTURE | reserved dirs | — |
| Desk UI | FUTURE | reserved dirs | — |
| rToken settlement | FUTURE | — | — |
