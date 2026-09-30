# Assumptions

| ID | Assumption | Status | Impact if false | Evidence needed | Resolution |
|----|------------|--------|-----------------|-----------------|------------|
| ASM-001 | Bitget API v2 public ticker fields include `lastPr` as string price | OPEN | Client Zod parse fails | Live ticker sample in evidence | Partial: p01 sample shows lastPr |
| ASM-002 | HMAC-SHA256 prehash is `timestamp + method + path + body` per Bitget v2 | OPEN | Private auth fails when keys added | Official Bitget signing docs + live auth | — |
| ASM-003 | DashScope Qwen-Plus is acceptable warm-path proposer for S2 demo | OPEN | Warm path blocked | Provider probe | — |
| ASM-004 | Tokenized real-world asset exposure is available as Bitget spot/margin symbols relevant to demo | OPEN | Product thesis weakens | Symbol list research | — |
| ASM-005 | <$50ms hot path is achievable on Node without heavy frameworks for veto+seal+sign | CLOSED (I-04 charter <50ms holds; T5 median-of-5 + empirical <10ms, GAP-007) | I-04 fails | Benchmark harness | T5 regression guard `dispatch-hardening.test.ts` + `foundry/evidence/p05/closeout_tests.txt` |
