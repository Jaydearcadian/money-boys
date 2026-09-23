# Phase 05 — Closeout: test hardening, verify expansion, dedup & foundry sync

STATUS: COMPLETE
OWNER: desk/engine

## Objective

Harden the Phase 05 desk/telemetry slice to a GREEN `pnpm verify`,
remove directory scatter, and synchronize Foundry ledgers + canonical docs.

## Admitted scope

- `packages/engine/src/server*.ts` telemetry server (native `node:http`, SSE)
- `packages/engine/test/telemetry.test.ts` + T5 latency hardening
  (`dispatch-hardening.test.ts`)
- `packages/desk/*` Vite operator console (Landing + Desk, EventSource)
- `scripts/verify` ladder expansion (desk typecheck + build)
- Repo hygiene: root canonical cycle guide, evidence pointer, empty-dir prune
- Foundry sync: CLM-008/009, GAP-007 closure, `phases/05-closeout.md`,
  `state.json` HEAD seal, canonical docs refresh

## Explicitly excluded

- Live Bitget auth/dispatch (GAP-001 BLOCKED_EXTERNAL unchanged)
- Live Desk deployment / monitoring (no LIVE/MONITORED claims)
- Paper-ledger reconciliation (alpha_factory 7.9% vs performance 8.98% delta
  recorded as open question, not claimed as live edge)

## Invariants

- I-01 zero LLM authority (proposal-only macro path)
- I-02 deterministic HARD_VETO (65% / $5k / free-margin)
- I-03 SHA-256 receipt seal before dispatch
- I-04 two-speed hot path <50ms charter (median of 5 post-warm-up iterations,
  empirical target <10ms; see GAP-007)
- I-05 no heavy frameworks (engine: zod only; desk: react/vite/tailwind)

## Deliverables

- [x] T5 hardened: 3x JIT warm-up + 5 timed iterations, median hot-path
  asserted <50ms (charter) and <10ms (empirical); 40/40 green x3 runs
- [x] `scripts/verify`: engine typecheck → desk typecheck → engine test →
  desk build → check-foundry → p01 coherence
- [x] Dedup: root cycle guide canonical; `evidence/README.md` pointer;
  empty scaffold dirs pruned; `packages/desk/dist/` removed (untracked)
- [x] CLM-008 telemetry TESTED, CLM-009 desk TESTED (unit/integration only,
  no LIVE claim)
- [x] GAP-007 (T5 cold-JIT flake) CLOSED with regression guard
- [x] Canonical docs refreshed (CURRENT_STATE / IMPLEMENTATION_STATUS /
  EVIDENCE_LEDGER / PROGRESS_LEDGER / ASSUMPTIONS ASM-005)
- [x] `state.json` HEAD sealed to closeout commit

## Required verification

```bash
pnpm --filter @money-boys/engine typecheck
pnpm --filter @money-boys/desk typecheck
pnpm --filter @money-boys/engine test
pnpm --filter @money-boys/desk build
bash scripts/verify
```

## Evidence

- `foundry/evidence/p05/closeout_tests.txt` (40/40 engine tests)
- `foundry/evidence/p05/desk_typecheck.txt`
- `foundry/evidence/p05/verify_ok.txt` (sealed post-verify)
- `packages/engine/test/telemetry.test.ts`, `packages/engine/test/dispatch-hardening.test.ts`

## Exit gate

1. `pnpm verify` GREEN at sealed HEAD
2. Zero open HIGH gaps except GAP-001 BLOCKED_EXTERNAL
3. No LIVE/LIVE_DEMONSTRATED claim without live evidence
4. No secrets in tree
