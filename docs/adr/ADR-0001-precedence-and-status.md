# ADR-0001 — Precedence, status vocabulary, and lightweight Foundry mode

- **Status:** Accepted
- **Date:** 2026-09-23

## Context

Money Boys is a short Bitget S2 build that still needs defensible claims.

## Decision

1. Adopt `BUILD_FOUNDRY.md` as governing standard (lightweight mode §43).  
2. Use Foundry claim states, not “done/live/ready”.  
3. Truth order: live API > specs > PRD > ADR > Zod > tests > code > README.  
4. First vertical slice = Bitget substrate gate before risk/receipt/agents.  
5. Reserved package paths may exist; empty implementations must not be claimed.

## Consequences

- Demo language must track `foundry/claims.jsonl`  
- Missing Bitget keys ⇒ BLOCKED_EXTERNAL, not silent mock LIVE  
- No LangChain stack (I-05)
