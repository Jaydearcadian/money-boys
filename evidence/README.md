# evidence/

Machine-readable manifests for important runs live in
`evidence/runs/<slice>-<date>.json` and validate against
`foundry/evidence/manifest-schema.json` (Foundry-aligned enum).

**Money Boys note:** Phase-bound gate evidence is under `foundry/evidence/`
(e.g. `foundry/evidence/p01/auth_test.json`). Do not duplicate conflicting
statuses between trees.

Example:

```json
{
  "schemaVersion": "1",
  "capability": "bitget.public-ticker",
  "status": "TESTED",
  "commit": null,
  "environment": "public-api",
  "timestamp": "<iso8601>",
  "tests": { "passed": 1, "failed": 0 },
  "artifacts": ["foundry/evidence/p01/auth_test.json"],
  "limitations": ["private auth not confirmed"]
}
```

Do not fabricate fields. `COMPOSITE_FIXTURE` / mock results must say so.
Each elevated claim gets a row in `docs/canonical/EVIDENCE_LEDGER.md` and
`foundry/claims.jsonl`.
