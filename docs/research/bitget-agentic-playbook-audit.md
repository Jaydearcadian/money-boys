# Bitget Hackathon Integration Audit — GetAgent / Playbook / MCP

**Retrieval timestamp:** 2026-09-30T08:00Z
**Auditor:** Money Boys coding agent
**Repository:** `/home/ubuntu/money-boys` @ `0586318`
**Status:** read-only research slice implemented; execution integration NOT wired

This audit is deliberately outside runtime code. Money Boys remains the
canonical control plane: external Bitget tooling may produce research or
strategy artifacts, but nothing actionable may enter execution without passing
receipt → Risk Boy → council → dispatcher.

---

## 1. Installed surfaces

| Surface | Installed | Path | In repo? |
|---|---|---|---|
| GetAgent Skill (npm `@bitget-ai/getagent-skill@0.6.4`) | yes | `~/.claude/skills/getagent` | **no** |
| Bitget MCP (`agent.bitget.com/mcp`) | no | — | no |
| `bitget-mcp-server` (npm) | **not installed** | — | no |
| GetAgent Studio / paper trading | not enabled | — | no |

Installer provenance:

```bash
npx @bitget-ai/getagent-skill@0.6.4 install --client claude --no-update-check
# -> Installed GetAgent skill at /home/ubuntu/.claude/skills/getagent
```

Notes on the installer, from reading the shipped source before running it:

- Valid targets are `claude`, `cursor`, `codex`, `all` (`CLIENT_TARGETS` in
  `bin/getagent-skill.js`). **`--client agent` is NOT supported** — the
  documented command in the task brief fails with
  `Unsupported client: agent. Use claude, cursor, codex, or all.` The brief's
  command was wrong; `--client claude` was used instead.
- The installer copies a bundled `skills/getagent` directory only. It does not
  touch the Money Boys runtime tree.
- It phones home on install for an anonymous `install_id`
  (`~/.config/getagent/telemetry.json`) and an npm update check. `--dry-run`
  and `--no-update-check` exist; a dry run was performed first to confirm the
  destination before installing.
- Package is `Proprietary` licence, published by `Bitget-AI`, repo
  `github.com/Bitget-AI/getagent-skill`.

## 2. Repository impact of installation

**None.** `git status` after install showed no new files, no changes to
`package.json`, no `pnpm-lock.yaml` change, no MCP config written, no
credential file created. The skill lives entirely in `~/.claude/skills/`.

The only pre-existing worktree modifications remain `PRD.md` and
`docs/product/PRODUCT_THESIS.md`, which predate this work and were not authored
by this agent.

## 3. Official commands

```
npx @bitget-ai/getagent-skill install [--client claude|cursor|codex|all]
                                       [--target PATH] [--dry-run] [--no-update-check]
npx @bitget-ai/getagent-skill upgrade [same flags]
npx @bitget-ai/getagent-skill --help
```

Local validation (from `SKILL.md`, step 5):

```bash
python3 scripts/validate.py ./my-strategy/     # requires Python 3.11+ (+ pyyaml)
```

## 4. Credentials and authentication boundaries

**Three distinct credential domains. They must not be mixed.**

| Domain | Purpose | Transport | Status |
|---|---|---|---|
| Bitget Demo (`BITGET_API_KEY` / `SECRET_KEY` / `PASSPHRASE`) | Money Boys venue adapter | HMAC-SHA256 headers + `paptrading: 1` | present in gitignored `.env`, mode 0600 |
| Playbook OpenAPI `ACCESS-KEY` | GetAgent control plane: upload / run / publish / subscription | `ACCESS-KEY` header | **NOT requested, NOT stored** |
| Agentic OAuth | future execution surface | OAuth | **NOT wired** |

Rules applied:

- Playbook `ACCESS-KEY` is never written to disk and never requested in chat.
  Per `SKILL.md`: *"Ask for the user's Bitget OpenAPI ACCESS-KEY only before the
  first authenticated upload/run/publish call. Never write credentials to disk."*
- Playbook keys are **not** added to `.env` alongside the exchange Demo keys.
  Different domains; separate files, separate lifecycles.
- The `playbook-adapter.ts` in the engine accepts **no credential parameter at
  all**. Fetching a published artifact is a public read.
- A regression test asserts no adapter module references
  `BITGET_API_KEY` / `BITGET_SECRET_KEY` / `BITGET_PASSPHRASE`, imports the
  dispatcher, or mentions `place-order`.

## 5. Read-only / paper / dry-run behaviour

| Operation | Mode | Wired in Money Boys? |
|---|---|---|
| Local package validation | offline, static | not yet (out of slice) |
| Sandbox backtest / evaluation | remote, authenticated | not yet |
| Publish Playbook | remote, authenticated, **external write** | **no — needs authorization** |
| Subscription links | remote, authenticated | **no — needs authorization** |
| Studio paper-trading enable | remote, authenticated | **no — needs authorization** |
| MCP `agent.bitget.com/mcp` | read-only research | contract defined, transport not wired |

The skill's `scripts/validate.py` is the only fully local, credential-free step.

### MCP surface

`https://agent.bitget.com/mcp` returned HTTP 400 to an unauthenticated GET,
consistent with an MCP streamable-HTTP endpoint requiring a proper
`initialize` handshake. No MCP client SDK was installed, and no MCP config was
written. The engine defines `McpReadOnlyTransport` with exactly one method,
`callReadTool(tool, args)` — a structural guarantee that no signing or order
method can be added without changing the interface.

**Proposed client configuration (NOT written — awaiting review):**

```jsonc
// ~/.config/opencode/opencode.json  — illustrative only
{
  "mcp": {
    "bitget-research": {
      "type": "remote",
      "url": "https://agent.bitget.com/mcp",
      "enabled": false            // stays disabled until reviewed
    }
  }
}
```

## 6. What composes with Money Boys

Read-only research surfaces that may flow **in**:

- `bitget-signal` perception → Macro Boy / Quant Boy proposal objects
- Bitget MCP US-equity research → Macro Boy proposal objects
- GetAgent / Playbook artifacts → strategy research input

Composition rules, all enforced by contract:

- Strict Zod validation of every untrusted payload (`.strict()`, bounded).
- SHA-256 provenance over the **validated** payload, via the same canonicalizer
  as the ReasoningReceipt sealer.
- Fail-closed to NEUTRAL when a provider is unavailable or malformed — never a
  throw into the council path, never partial trust.
- No adapter may import `OrderDispatcher`, hold credentials, or name an
  order-placement endpoint.

## 7. What stays separate

| Component | Owner | Role |
|---|---|---|
| Quant Boy | Money Boys | deterministic alpha math |
| Risk Boy HARD_VETO | Money Boys | non-negotiable veto |
| Council quorum | Money Boys | weighted reduction, quorum gate |
| SHA-256 ReasoningReceipt | Money Boys | execution seal (I-03) |
| Bitget Demo adapter | Money Boys | **preserved**, unchanged |
| `OrderDispatcher` | Money Boys | only order authority |
| GetAgent / Playbook | Bitget | strategy authoring, backtest, publication |
| MCP / bitget-signal | Bitget | read-only research/perception |

External tools must not call Bitget order endpoints, bypass Risk Boy or council,
create unsigned execution state, write canonical portfolio state, publish claims,
or become a second control plane.

**Execution integration is NOT wired.** `AGENTIC_EXECUTION_NOT_WIRED.wired === false`.
The existing Bitget Demo adapter is untouched and remains the only venue path
until an Agentic path independently passes verification.

## 8. Code added by this slice

Canonical boundary: `packages/engine/src/integrations/bitget/`

| File | Purpose |
|---|---|
| `contracts.ts` | `ProvenanceSchema`, `sealProvenance`, `verifyProvenance`, `AdapterAuthoritySchema` (`read_only` only), `SignalBundleSchema`, `EquityQuoteSchema`, `McpReadOnlyTransport`, `PlaybookArtifactSchema`, `AGENTIC_EXECUTION_NOT_WIRED` |
| `signal-adapter.ts` | strict catalyst ingestion, provenance sealing, fail-closed degradation, `toMacroNewsContext` |
| `playbook-adapter.ts` | id/version validation, artifact load, stored-hash tamper detection |
| `index.ts` | barrel |

Tests: `packages/engine/test/integrations-bitget.test.ts` — 26 tests covering
determinism, tamper detection, malformed input, unavailable provider,
authority boundary, and a static source audit asserting no adapter imports the
dispatcher or references credentials.

A bug was found and fixed during this slice: `verifyPlaybookArtifact` originally
recomputed the "expected" hash from the payload under test, making tamper
detection a no-op that always returned `true`. Provenance is now stored on the
artifact record and compared, not recomputed.

## 9. Claim / gap impact

**None.** No claim, gap, state, or Phase 01 evidence file was modified —
verified by `git diff` on `foundry/` and by byte-comparing
`foundry/evidence/p01/auth_test.json` before and after.

These adapters are unproven code. They warrant a new claim once the read-only
slice has live validation, at which point a gap should be opened for the
unwired MCP transport and the not-yet-authorized Playbook publish path.

## 10. Exact proposed next action

Requires explicit authorization:

1. Authorize closing the open Demo position (GAP-009) — short 0.001 BTCUSDT,
   liq 91,280.95, currently open. Time-sensitive.
2. Authorize `pnpm verify` result to be recorded as a new commit, then open
   **GAP-010** (integration adapters unproven live) and **CLM-010**
   (read-only research adapters, proposed state `TESTED`).
3. Separately: authorize the MCP client configuration above, disabled by default.
4. Separately: authorize one GetAgent **local validation only** run
   (`python3 scripts/validate.py`) on a bundled example — no upload, no
   credentials.
5. Playbook publication, Studio paper trading, and OAuth binding each require
   their own authorization and user interaction. None is requested here.

## 11. Sources

| Source | URL | Retrieved |
|---|---|---|
| Bitget Agentic account guide (as briefed) | `https://www.bitget.com/support/articles/125606038941222` | 2026-09-30 — **HTTP 404** |
| Bitget MCP endpoint | `https://agent.bitget.com/mcp` | 2026-09-30 — HTTP 400 unauthenticated |
| GetAgent skill package | `https://www.npmjs.com/package/@bitget-ai/getagent-skill` | 2026-09-30 — v0.6.4 |
| GetAgent skill repo | `https://github.com/Bitget-AI/getagent-skill` | 2026-09-30 |
| Bitget v2 Place Order docs | `https://www.bitget.com/api-doc/contract/trade/Place-Order` | 2026-09-30 |
| Bitget REST error codes | `https://www.bitget.com/api-doc/contract/error-code/restapi` | 2026-09-30 |

**The guide URL in the task brief returns 404.** The installation command was
instead taken from the package's own `usage()` output and verified by reading
`bin/getagent-skill.js` before execution. The package itself is genuine and
maintained, but the specific article could not be verified.
