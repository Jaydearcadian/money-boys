/**
 * render-handoff.mjs — GENERATE the next-agent handoff from the ledgers.
 *
 * WHY THIS EXISTS
 *   A hand-maintained gap/claim table drifts the moment anything commits. That
 *   already happened: a handoff listing "10 non-closed gaps" was re-pasted
 *   after GAP-023 was opened, along with a 60d/29d IS-OOS split that FAILS
 *   Track 1's >=30-day out-of-sample requirement, a dropped minimum-trade
 *   Sharpe gate, and key-based stamping instructions that contradict the
 *   telemetry-derived stamping actually implemented.
 *
 *   None of that was anyone's fault. A plan living in chat cannot be
 *   diffed against the thing it describes. So: generate it from
 *   foundry/gaps.jsonl and foundry/claims.jsonl, and make the ledgers the
 *   single source of truth.
 *
 * FINGERPRINT, NOT HEAD
 *   The emitted document carries a fingerprint of the LEDGER CONTENT, not the
 *   commit SHA. check-foundry re-derives that fingerprint and fails if the
 *   ledgers have moved on. That invalidates the handoff when the facts change
 *   — not on every unrelated commit, which would train everyone to ignore it.
 *
 * Usage: node scripts/render-handoff.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "canonical", "NEXT_AGENT_HANDOFF.md");

const readJsonl = (rel) =>
  readFileSync(join(ROOT, rel), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

const gaps = readJsonl("foundry/gaps.jsonl");
const claims = readJsonl("foundry/claims.jsonl");

// Hash the RAW LEDGER BYTES, not re-serialized objects. Serialization differs
// between Node and Python (separators, unicode escaping), so a parsed-object
// hash disagrees across the two implementations that must agree on it. Byte
// hashing is language-independent by construction.
const fingerprint = createHash("sha256")
  .update(readFileSync(join(ROOT, "foundry/gaps.jsonl")))
  .update(readFileSync(join(ROOT, "foundry/claims.jsonl")))
  .digest("hex")
  .slice(0, 16);

const head = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
const nonClosed = gaps.filter((g) => g.status !== "CLOSED");
const blocked = nonClosed.filter((g) => g.status === "BLOCKED_EXTERNAL");
const evidenceIntegrity = nonClosed.filter((g) => (g.category ?? g.class) === "EVIDENCE_INTEGRITY");
const legal = nonClosed.filter((g) => String(g.category ?? g.class).includes("LEGAL"));

const row = (g) => {
  const residuals = (g.residual_closure ?? []).slice(0, 2).map((r) => r.replace(/\|/g, "\\|"));
  const cat = g.category ?? g.class ?? "—";
  return `| \`${g.id}\` | ${g.status} | ${cat} | ${
    residuals.length ? residuals.join("<br>") : "—"
  } |`;
};

const claimRow = (c) =>
  `| \`${c.id}\` | ${c.category} | ${c.status} | ${(c.limitations ?? []).length} |`;

const doc = `# Next-Agent Handoff (GENERATED — do not hand-edit)

> **This file is generated. Run \`node scripts/render-handoff.mjs\` after changing
> \`foundry/gaps.jsonl\` or \`foundry/claims.jsonl\`.**
> \`check-foundry\` fails if the ledger fingerprint below no longer matches, so a
> stale handoff cannot pass verification.

| | |
|---|---|
| Generated at commit | \`${head}\` |
| Ledger fingerprint | \`${fingerprint}\` |
| Non-closed gaps | **${nonClosed.length}** (of ${gaps.length}) |
| Blocked external | ${blocked.length} |
| Evidence-integrity | ${evidenceIntegrity.length} |
| Legal/compliance | ${legal.length} |

## Prime directive

\`implemented != verified\` · \`verified locally != proven live\` ·
\`deployed != working\` · \`documented != true\`

## Non-closed gaps

| Gap | Status | Category | Residual closure actions |
|---|---|---|---|
${nonClosed.map(row).join("\n")}

## Claims

| Claim | Category | Status | #limitations recorded |
|---|---|---|---|
${claims.map(claimRow).join("\n")}

## Invariants that must not be weakened

- **Risk veto is absolute.** No authority value, code path or config may produce
  \`APPROVED\` while \`riskPermitted\` is false. It is checked first and returns
  early — unreachable by construction, not checked-and-overridden.
- **The LLM arm fails CLOSED.** Absent verdict resolves to \`VETOED\`, never to
  consent. It holds no credentials and signs nothing.
- **Synthetic fixtures never become evidence.** Any artifact whose metrics
  derive from a hardcoded table or authored scenario carries
  \`SYNTHETIC_PERFORMANCE_STAMP\` and must not be published or submitted.
- **Snapshot data may not reach performance metrics.** Provenance travels
  in-band on every data file.

## Verification

\`\`\`bash
bash scripts/verify               # full ladder
node scripts/check-foundry.mjs    # ledgers + handoff freshness
\`\`\`

**Port 3001 must be free before Playwright.** \`e2e/fixture-server.mjs\` binds it
with \`reuseExistingServer: false\`; a running \`packages/engine/src/server.ts\`
makes the suite fail to start. Bind that server to \`127.0.0.1\` only.

## Do not

- Promote a claim or close a gap without the evidence the ledger entry names.
- Publish a metric derived from an unresolved-provenance source (see legal rows).
- Publish a Sharpe computed from fewer than 30 completed round trips. Report the
  trade count and decline instead.
- Mark a data-source terms question resolved by choosing whatever responds 200.
`;

writeFileSync(OUT, doc);
console.log(`wrote ${OUT}`);
console.log(`  head=${head} fingerprint=${fingerprint}`);
console.log(`  non-closed gaps: ${nonClosed.length} (${nonClosed.map((g) => g.id).join(", ")})`);
console.log(`  claims: ${claims.length}`);