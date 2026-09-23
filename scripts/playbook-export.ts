/**
 * Playbook export — prints the GetAgent Studio strategy card (text + Markdown)
 * from the 21-day paper ledger.
 * Run: pnpm exec tsx scripts/playbook-export.ts [--markdown]
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SUMMARY_PATH = join(ROOT, "foundry/evidence/paper-trading/performance_summary.json");

function loadSummary(): Record<string, unknown> {
  return JSON.parse(readFileSync(SUMMARY_PATH, "utf8")) as Record<string, unknown>;
}

function cardText(s: Record<string, unknown>): string {
  const prov = s["provenanceAudit"] as Record<string, unknown>;
  return [
    `${s["strategyName"]} | ${s["track"]} — ${s["subTheme"]}`,
    `Period: ${s["period"]} (${s["daysActive"]} days, ${s["totalDeliberations"]} deliberations)`,
    `Executed: ${s["executedTrades"]} | Soft-reject scaled: ${s["softRejectsScaled"]} | Hard vetoes: ${s["hardVetoes"]}`,
    `Capital: $${s["startingCapitalUsd"]} -> $${s["endingCapitalUsd"]} (${s["netReturnPct"]}%)`,
    `Sharpe: ${s["annualizedSharpe"]} | Sortino: ${s["sortinoRatio"]} | MaxDD: ${s["maxDrawdownPct"]}% | Win: ${s["winRatePct"]}%`,
    `Fees: $${s["totalFeesPaidUsd"]} | Hot-path avg: ${s["averageLatencyHotPathMs"]}ms`,
    `Provenance: ${prov["cryptographicallyVerifiedCount"]}/${prov["sealedReceiptsCount"]} sealed receipts verified, tampering=${prov["tamperingDetected"]}`,
  ].join("\n");
}

function cardMarkdown(s: Record<string, unknown>): string {
  const prov = s["provenanceAudit"] as Record<string, unknown>;
  return [
    `## ${s["strategyName"]}`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Track | ${s["track"]} — ${s["subTheme"]} |`,
    `| Period | ${s["period"]} |`,
    `| Days active | ${s["daysActive"]} |`,
    `| Total deliberations | ${s["totalDeliberations"]} |`,
    `| Executed trades | ${s["executedTrades"]} |`,
    `| Soft-rejects scaled (Pass 2) | ${s["softRejectsScaled"]} |`,
    `| Hard vetoes | ${s["hardVetoes"]} |`,
    `| Starting capital | $${s["startingCapitalUsd"]} |`,
    `| Ending capital | $${s["endingCapitalUsd"]} |`,
    `| Return | ${s["netReturnPct"]}% |`,
    `| Annualized Sharpe | ${s["annualizedSharpe"]} |`,
    `| Sortino | ${s["sortinoRatio"]} |`,
    `| Max drawdown | ${s["maxDrawdownPct"]}% |`,
    `| Win rate | ${s["winRatePct"]}% |`,
    `| Total fees | $${s["totalFeesPaidUsd"]} |`,
    `| Avg hot-path latency | ${s["averageLatencyHotPathMs"]}ms |`,
    `| Sealed receipts verified | ${prov["cryptographicallyVerifiedCount"]}/${prov["sealedReceiptsCount"]} (tampering=${prov["tamperingDetected"]}) |`,
  ].join("\n");
}

const s = loadSummary();
if (process.argv.includes("--markdown")) {
  console.log(cardMarkdown(s));
} else {
  console.log(cardText(s));
  console.log("");
  console.log(cardMarkdown(s));
}
