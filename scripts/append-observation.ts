/**
 * Append ONE observation record from ONE operator-triggered evidence artifact.
 *
 * MANUAL ONLY. There is no scheduler, no polling loop and no daemon anywhere in
 * this path. It is invoked once, by a person, immediately after a live read.
 *
 * It appends to the log and reads; it does not fetch anything. No provider,
 * calendar, bridge or dispatcher code is touched.
 *
 * Usage:
 *   node --import tsx scripts/append-observation.ts <evidencePath> [recordedAt]
 */
import { appendObservationRecord, normaliseToObservationRecord } from "../packages/engine/src/observability/observation-log.js";

const evidencePath = process.argv[2];
if (evidencePath === undefined) {
  process.stderr.write("usage: append-observation <evidencePath> [recordedAt]\n");
  process.exit(1);
}

const record = normaliseToObservationRecord({
  evidencePath,
  ...(process.argv[3] !== undefined ? { recordedAt: process.argv[3] } : {}),
});
const outcome = appendObservationRecord(record);

process.stdout.write(
  JSON.stringify(
    {
      outcome,
      recordId: record.recordId,
      recordedAt: record.recordedAt,
      decision: record.decision,
      logMode: record.logMode,
      phaseTransition: record.phaseTransition,
      dispatchEligible: record.dispatchEligible,
      sameDayAlertsChecked: record.sameDayAlertsChecked,
      sessionVerification: record.sessionVerification,
      orderSubmitted: record.orderSubmitted,
      dispatcherInvoked: record.dispatcherInvoked,
      reason: record.reason,
      account: record.account,
      benchmark: {
        symbol: record.benchmark.symbol,
        ageAtReceiptMs: record.benchmark.ageAtReceiptMs,
        freshnessGateMs: record.benchmark.freshnessGateMs,
      },
      quant: record.quant,
    },
    null,
    2,
  ) + "\n",
);