/**
 * OUTCOME EVALUATION records.
 *
 * WHAT THIS IS
 *   A separate record written AFTER a prediction's horizon has elapsed, stating
 *   what was subsequently observed and whether the forecast matched. It is
 *   appended to its own stream and NEVER modifies the prediction it evaluates.
 *
 * WHY A SEPARATE RECORD
 *   A prediction is only evidence if it was made before the outcome was known.
 *   Editing the original after seeing the result would destroy exactly the
 *   property that makes it worth keeping. So the prediction is immutable and
 *   the evaluation points back at it by id.
 *
 * NO-LOOKAHEAD, RESTATED
 *   This module is imported by nothing in the prediction path, and the runner's
 *   `runOnce()` has no parameter that could carry outcome data. The two streams
 *   meet only here, after the fact, by `predictionId`.
 *
 * NO PERFORMANCE FIELDS
 *   Deliberately absent: pnl, return, fills, win rate, Sharpe. Those describe
 *   a trading strategy's results, and an observation stream that never traded
 *   cannot produce them honestly. What this records is whether a directional
 *   forecast matched observed movement — agreement, not profitability.
 */
import { canonicalJson } from "./source-model.js";
import { createHash } from "node:crypto";

export type OutcomeAgreement = "DIRECTION_MATCHED" | "DIRECTION_DID_NOT_MATCH" | "INCONCLUSIVE";

export interface OutcomeEvaluationRecord {
  readonly recordType: "OUTCOME_EVALUATION";
  readonly recordId: string;
  /** The immutable prediction this evaluates. */
  readonly predictionId: string;
  readonly evaluatedAt: string;

  /** What the prediction claimed. Copied for readability, not authority. */
  readonly predictedMode: string;
  readonly predictedAction: string;
  readonly predictedNetEdgePct: number | null;

  /** What was actually observed at/after the horizon. */
  readonly observedAction: string;
  readonly observedPrice: number | null;
  readonly observedAt: string;
  readonly observedSourceAsOf: string | null;

  /** Comparison outcome. Never a profitability statement. */
  readonly agreement: OutcomeAgreement;
  readonly comparison: string;

  /**
   * Always true when the evaluation references a real prediction: the
   * prediction itself was never modified. Recorded so a reader can verify the
   * claim rather than take it on trust.
   */
  readonly predictionUnmodified: true;

  // ---- Authority boundary, unchanged in the evaluation stream. ----
  readonly logMode: "OBSERVATION_ONLY";
  readonly dispatchEligible: false;
  readonly executionAuthority: "none";
  readonly orderSubmitted: false;
  readonly phaseTransition: null;

  readonly previousRecordHash: string | null;
  readonly recordHash: string;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function computeEvaluationRecordHash(
  record: Omit<OutcomeEvaluationRecord, "recordHash">,
): string {
  return sha256(canonicalJson(record));
}

/**
 * Compare a prediction against an observation that happened AFTER its horizon.
 *
 * `horizonEnd` is compared against `observedAt` and a late observation is
 * INCONCLUSIVE rather than scored. That is the no-lookahead check on the
 * evaluation side: an outcome observed before the forecast window closed cannot
 * confirm or refute the forecast.
 */
export function evaluatePrediction(args: {
  prediction: {
    predictionId: string;
    predictionMode: string;
    action: string;
    basis: { netEdgePct: number } | null;
    forecastHorizonEnd: string;
  };
  observation: {
    observedAt: string;
    observedPrice: number | null;
    observedAction: string;
    sourceAsOf: string | null;
  };
  evaluatedAt: Date;
  previousRecordHash: string | null;
}): OutcomeEvaluationRecord {
  const horizonEndMs = Date.parse(args.prediction.forecastHorizonEnd);
  const observedMs = Date.parse(args.observation.observedAt);

  let agreement: OutcomeAgreement;
  let comparison: string;

  if (Number.isNaN(horizonEndMs) || Number.isNaN(observedMs)) {
    agreement = "INCONCLUSIVE";
    comparison = "horizon or observation timestamp is unparseable; no comparison attempted";
  } else if (observedMs < horizonEndMs) {
    // The critical case: the "outcome" precedes the forecast window closing.
    agreement = "INCONCLUSIVE";
    comparison =
      `observation at ${args.observation.observedAt} precedes the forecast horizon end at ` +
      `${args.prediction.forecastHorizonEnd}; it cannot evaluate this prediction`;
  } else if (args.prediction.predictionMode !== "BASIS_PREDICTION") {
    agreement = "INCONCLUSIVE";
    comparison =
      `prediction mode ${args.prediction.predictionMode} carries no directional basis, so there is ` +
      `nothing to compare against; the record is retained for completeness only`;
  } else {
    const predicted = args.prediction.action;
    const observed = args.observation.observedAction;
    if (predicted === "NEUTRAL" || predicted === "NONE") {
      agreement = "INCONCLUSIVE";
      comparison = "prediction was directional-neutral; no direction to compare";
    } else if (predicted === observed) {
      agreement = "DIRECTION_MATCHED";
      comparison = `predicted ${predicted}; observed ${observed}. Direction matched. No order was placed and no return is claimed.`;
    } else {
      agreement = "DIRECTION_DID_NOT_MATCH";
      comparison = `predicted ${predicted}; observed ${observed}. Direction did not match. No order was placed and no return is claimed.`;
    }
  }

  const base: Omit<OutcomeEvaluationRecord, "recordHash"> = {
    recordType: "OUTCOME_EVALUATION",
    recordId: `eval-${sha256(`${args.prediction.predictionId}|${args.observation.observedAt}|${agreement}`).slice(0, 16)}`,
    predictionId: args.prediction.predictionId,
    evaluatedAt: args.evaluatedAt.toISOString(),
    predictedMode: args.prediction.predictionMode,
    predictedAction: args.prediction.action,
    predictedNetEdgePct: args.prediction.basis === null ? null : args.prediction.basis.netEdgePct,
    observedAction: args.observation.observedAction,
    observedPrice: args.observation.observedPrice,
    observedAt: args.observation.observedAt,
    observedSourceAsOf: args.observation.sourceAsOf,
    agreement,
    comparison,
    predictionUnmodified: true,
    logMode: "OBSERVATION_ONLY",
    dispatchEligible: false,
    executionAuthority: "none",
    orderSubmitted: false,
    phaseTransition: null,
    previousRecordHash: args.previousRecordHash,
  };

  return { ...base, recordHash: computeEvaluationRecordHash(base) };
}