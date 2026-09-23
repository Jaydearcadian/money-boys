# CURRENT_STATE

Updated: 2026-09-23 (prep scaffold after Foundry read)

## What exists

- pnpm monorepo skeleton (`packages/engine`, reserved `packages/desk`)
- Bitget API v2 client + Phase 01 auth gate script
- Public ticker live-read evidence (`foundry/evidence/p01/auth_test.json`)
- Foundry control plane: state, claims, gaps, assumptions, contradictions, phase 01
- `BUILD_FOUNDRY.md`, `PRD.md`, docs canonical set, `scripts/verify`

## What is implemented vs verified

| Item | Code | Verified |
|---|---|---|
| Public ticker fetch | yes | yes (live HTTP sample) |
| Private HMAC request helper | yes | **no** live (no keys) |
| Risk Boy | no | no |
| ReasoningReceipt | no | no |
| Agents / council | paths reserved only | no |
| Desk UI | reserved only | no |

## Deployed

Nothing hosted. Local repo only. Git has **no commits** yet (`foundry/state.json` head = null).

## Unresolved

- GAP-001 BITGET credentials
- GAP-002 Risk Boy
- GAP-003 Receipt seal
- ASM-002 signing string exact match to Bitget docs under live keys
- Full AGENTS.md promotion from `docs/AGENTS_CHARTER.md` (root AGENTS write protected)
