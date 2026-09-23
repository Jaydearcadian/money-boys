# EVIDENCE_LEDGER

| Claim | State | Evidence paths | Notes |
|---|---|---|---|
| CLM-001 Bitget substrate | TESTED | `foundry/evidence/p01/auth_test.json`, `packages/engine/src/bitget/*` | Public live-read; private auth deferred (GAP-001) |
| CLM-002 Risk HARD_VETO | TESTED | `packages/engine/src/skills/igraph-guard/security.ts`, `packages/engine/test/risk-guard.test.ts`, `foundry/evidence/p02/risk_guard.txt` | 65% / $5k / free-margin |
| CLM-003 ReasoningReceipt | TESTED | `packages/engine/src/council/receipts.ts`, `packages/engine/test/receipts.test.ts`, `foundry/evidence/p01/receipts_seal.txt` | SHA-256 seal before dispatch |
| CLM-004 Quant engine | TESTED | `packages/engine/src/agents/quant.ts`, `packages/engine/test/quant.test.ts`, `foundry/evidence/p02/quant_engine.txt`, `foundry/evidence/p02/basis_math.txt` | Basis/VWAP/funding hurdle |
| CLM-005 Macro shield | TESTED | `packages/engine/src/skills/noema-qa/*`, `packages/engine/src/agents/macro.ts`, `packages/engine/test/macro-shield.test.ts`, `foundry/evidence/p03/cognitive_shield.txt` | Proposal-only, fail-closed |
| CLM-006 Council quorum | TESTED | `packages/engine/src/council/*`, `packages/engine/test/council.test.ts`, `foundry/evidence/p04/council_quorum.txt` | Weighted vote + handoff |
| CLM-007 Benchmark veto + PAPER dispatch | TESTED | `packages/engine/src/agents/benchmarks.ts`, `packages/engine/src/council/adapter.ts`, `packages/engine/src/bitget/dispatcher.ts`, `packages/engine/test/dispatch-hardening.test.ts` | Unit only; no live demo orders |
| CLM-008 Telemetry server | TESTED | `packages/engine/src/server*.ts`, `packages/engine/test/telemetry.test.ts`, `foundry/evidence/p05/closeout_tests.txt` | Ephemeral-port SSE integration |
| CLM-009 Desk console | TESTED | `packages/desk/src/**`, `foundry/evidence/p05/desk_typecheck.txt` | Typecheck+build; no E2E/LIVE |
| GAP-007 T5 latency flake | CLOSED | `packages/engine/test/dispatch-hardening.test.ts` T5, `foundry/evidence/p05/closeout_tests.txt` | Warm-up + median-of-5 |
| Paper ledgers (unclaimed) | REFERENCE ONLY | `foundry/evidence/paper-trading/*`, `foundry/evidence/live-qwen-gateway/*` | Backtest/paper only; 7.9% vs 8.98% delta open; never live edge |

## Provenance rules

- Evidence must name commit SHA once git history exists
- Dirty worktree ≠ release evidence (Foundry §6)
- Do not reuse another HEAD’s logs as current proof
