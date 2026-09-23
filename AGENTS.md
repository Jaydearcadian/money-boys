# AGENTS.md — Money Boys Operating Charter

> **Full charter (binding):** [`docs/AGENTS_CHARTER.md`](./docs/AGENTS_CHARTER.md)  
> Root replacement with the full body is approval-gated in this environment — until then agents MUST follow the full charter file.

Project: Money Boys (Autonomous 24/7 Agentic Trading Desk for Tokenized US Equities)  
Governing Standards: `BUILD_FOUNDRY.md` (§34–36, §47) & `docs/Repository_Starter_Virtuous_Build_Cycle.md`  
Target Substrate: Bitget API v2 (Spot/Margin), Reality rTokens, Alibaba Cloud DashScope (Qwen-Plus)

## Prime Directive

```text
implemented ≠ verified
verified locally ≠ proven live
deployed ≠ working
documented ≠ true
```

Every meaningful claim needs a gate. Every gate needs evidence. Every defect → gap. Every repeatable failure → regression guard.

## Invariants (non-negotiable)

- **I-01** Zero direct LLM authority — Macro Boy proposes only; no LLM-signed orders / keys.
- **I-02** Deterministic Risk Boy HARD_VETO — >65% margin util, >$5k single trade, or insufficient free margin.
- **I-03** SHA-256 ReasoningReceipt required before Bitget order dispatch.
- **I-04** Hot path <50ms; warm path async.
- **I-05** No LangChain/LangGraph/CrewAI/AutoGen — plain TypeScript + Zod + node:crypto/fetch.

## Workflow

`INSPECT → ADMITTED SCOPE → READ-BACK DIFF → VERIFY LADDER → SYNCHRONIZE`  
Canonical: `pnpm verify` · `pnpm check-foundry` · `node scripts/check-foundry.mjs`

## Phase 01 gate

```bash
pnpm --filter @money-boys/engine test:auth
```

Evidence: `foundry/evidence/p01/auth_test.json`.  
Promote `CLM-001` to `LIVE_DEMONSTRATED` **only** when `authConfirmed: true`. Public-only stays `TESTED`. Do not advance phase past `01` without the phase exit gate.
