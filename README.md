# Money Boys

Autonomous 24/7 agentic trading desk for tokenized US equities — **Bitget S2** build.

Governed by [`BUILD_FOUNDRY.md`](./BUILD_FOUNDRY.md). Agent rules: [`AGENTS.md`](./AGENTS.md) (full charter draft: [`docs/AGENTS_CHARTER.md`](./docs/AGENTS_CHARTER.md)). Product intent: [`PRD.md`](./PRD.md).

## Status (honest)

| Capability | State | Evidence |
|---|---|---|
| Repo Foundry control plane | IMPLEMENTED | `foundry/*`, `scripts/verify` |
| Bitget public ticker live-read | TESTED | `foundry/evidence/p01/auth_test.json` |
| Bitget private HMAC auth | BLOCKED_EXTERNAL | needs `BITGET_*` env — GAP-001 |
| Risk Boy HARD_VETO | PROPOSED | GAP-002 |
| ReasoningReceipt seal | PROPOSED | GAP-003 |
| Council / Macro Boy / desk UI | FUTURE | reserved paths only |

## Layout

```text
money-boys/
  BUILD_FOUNDRY.md          # execution/evidence standard
  PRD.md
  AGENTS.md
  packages/engine/          # Bitget client, future risk/receipt/agents
  packages/desk/            # reserved UI/operator surface
  foundry/                  # state, claims, gaps, phases, evidence
  docs/                     # canonical truth + research
  scripts/verify            # one-command health
```

## Quickstart

```bash
cd money-boys
pnpm install
pnpm verify
pnpm --filter @money-boys/engine test
pnpm --filter @money-boys/engine test:auth
```

Optional live private auth (never commit secrets):

```bash
export BITGET_API_KEY=...
export BITGET_SECRET_KEY=...
export BITGET_PASSPHRASE=...
pnpm --filter @money-boys/engine test:auth
```

## Truth hierarchy

Live Bitget responses > Bitget/DashScope specs > PRD > ADRs > Zod > tests > code > README.

## Next vertical slices (in order)

1. Close GAP-001 if keys available (else leave BLOCKED_EXTERNAL)
2. Risk Boy pure HARD_VETO + tests (CLM-002)
3. ReasoningReceipt seal + dispatch guard (CLM-003)
4. Proposal-only warm path stub (no keys, no dispatch)
