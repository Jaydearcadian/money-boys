# Next-Agent Handoff (GENERATED — do not hand-edit)

> **This file is generated. Run `node scripts/render-handoff.mjs` after changing
> `foundry/gaps.jsonl` or `foundry/claims.jsonl`.**
> `check-foundry` fails if the ledger fingerprint below no longer matches, so a
> stale handoff cannot pass verification.

| | |
|---|---|
| Generated at commit | `ef04a46` |
| Ledger fingerprint | `d95cec7e3c47b1a9` |
| Non-closed gaps | **5** (of 22) |
| Blocked external | 1 |
| Evidence-integrity | 0 |
| Legal/compliance | 1 |

## Prime directive

`implemented != verified` · `verified locally != proven live` ·
`deployed != working` · `documented != true`

## Non-closed gaps

| Gap | Status | Category | Residual closure actions |
|---|---|---|---|
| `GAP-012` | OPEN | INTEGRATION | A position held across at least one funding settlement interval with funding cost/profit read back. No funding reader exists in the module and no test implies settlement coverage. |
| `GAP-015` | PARTIAL | SAFETY | A bounded Demo campaign with positive net edge exercises the corrected market-data paths against the venue, which is the only thing that closes this.<br>The freshness gate has blocked live runs correctly, but no run has yet passed it on venue evidence before this Robinhood integration. |
| `GAP-017` | PARTIAL | INTEGRATION | An AUTHORISED machine-readable US equity session calendar. NYSE and Nasdaq publish authoritative dated calendars only as PDF/HTML and prohibit automated capture in their terms of use; the machine-readable endpoints are undocumented, robots-disallowed and terms-prohibited, so none may be ingested. This is a contact/permission problem, not a code problem.<br>The same-day Trader Alert channel, which Nasdaq itself directs readers to for per-day information, is not machine-readable and its published HTML URL is retired. A same-day closure announced outside the annual calendar therefore cannot be detected automatically. |
| `GAP-018` | PARTIAL | INTEGRATION | GAP-019 resolved: written terms clarification from Robinhood, or a recorded operator legal decision that the intended read-only documented-API use is permitted. Automated use remains BLOCKED_EXTERNAL until then.<br>A positive-edge open-session read. Every live read so far has been NEUTRAL or vetoed, so the benchmark has never driven an authorisation even under a permissive read-only surface. |
| `GAP-019` | BLOCKED_EXTERNAL | LEGAL_COMPLIANCE | Operator signature on docs/risk/GAP-019-OPERATOR-DECISION.md, scoped to unauthenticated read-only access to the public price endpoint only, or written clarification from Robinhood. Either closes the gap; silence does not.<br>ESCALATE to legal counsel is a recorded third option and would leave the gap open with the risk formally transferred rather than informally absorbed. |

## Claims

| Claim | Category | Status | #limitations recorded |
|---|---|---|---|
| `CLM-001` | INTEGRATION | LIVE_DEMONSTRATED | 1 |
| `CLM-002` | SAFETY | TESTED | 1 |
| `CLM-003` | SAFETY | TESTED | 0 |
| `CLM-004` | ALPHA | TESTED | 1 |
| `CLM-005` | ALPHA | TESTED | 1 |
| `CLM-006` | GOVERNANCE | TESTED | 2 |
| `CLM-007` | SAFETY | LIVE_DEMONSTRATED | 5 |
| `CLM-008` | OBSERVABILITY | TESTED | 4 |
| `CLM-009` | INTERFACE | TESTED | 4 |

## Invariants that must not be weakened

- **Risk veto is absolute.** No authority value, code path or config may produce
  `APPROVED` while `riskPermitted` is false. It is checked first and returns
  early — unreachable by construction, not checked-and-overridden.
- **The LLM arm fails CLOSED.** Absent verdict resolves to `VETOED`, never to
  consent. It holds no credentials and signs nothing.
- **Synthetic fixtures never become evidence.** Any artifact whose metrics
  derive from a hardcoded table or authored scenario carries
  `SYNTHETIC_PERFORMANCE_STAMP` and must not be published or submitted.
- **Snapshot data may not reach performance metrics.** Provenance travels
  in-band on every data file.

## Verification

```bash
bash scripts/verify               # full ladder
node scripts/check-foundry.mjs    # ledgers + handoff freshness
```

**Port 3001 must be free before Playwright.** `e2e/fixture-server.mjs` binds it
with `reuseExistingServer: false`; a running `packages/engine/src/server.ts`
makes the suite fail to start. Bind that server to `127.0.0.1` only.

## Do not

- Promote a claim or close a gap without the evidence the ledger entry names.
- Publish a metric derived from an unresolved-provenance source (see legal rows).
- Publish a Sharpe computed from fewer than 30 completed round trips. Report the
  trade count and decline instead.
- Mark a data-source terms question resolved by choosing whatever responds 200.
