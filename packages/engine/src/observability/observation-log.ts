/**
 * Observation log — normaliser for Money Boys decision records.
 *
 * WHAT THIS IS
 *   A normaliser. It converts ONE operator-triggered evidence artifact into ONE
 *   append-only JSONL record. It never reads a provider, never schedules, never
 *   polls, and cannot invent a record: if there is no artifact, nothing is
 *   appended.
 *
 * WHY A LOG EXISTS NOW, BEFORE EXECUTION
 *   The blockers are external. Meanwhile there is genuine evidence to
 *   accumulate: decisions were made, gates fired, reasons were recorded, and
 *   the account stayed FLAT. That is an honest observation history. It is NOT
 *   a performance record and cannot become one by accumulation.
 *
 * WHAT THESE RECORDS ARE NOT
 *   - Not paper-trading evidence. No order was ever dispatched.
 *   - Not a performance claim. Every record here is NO_TRADE or BLOCKED.
 *   - Not proof the strategy works. A history of correctly-refused actions
 *     demonstrates that the gates fire, not that the edge exists.
 *   - Not a substitute for the execution log. That is a DIFFERENT stream with
 *     a different logMode, entered through an explicit transition record.
 *
 * THE TRANSITION IS A RECORD, NOT AN INFERENCE
 *   The first PAPER_DEMO_TRADING record must be a deliberate
 *   PHASE_TRANSITION record carrying explicit authorization, an
 *   `executionEnabledAt` instant, the gate state at that moment, and the
 *   commit SHA it was authorised against. This module will NOT emit one
 *   implicitly from a fill, and it will NEVER rewrite an earlier record:
 *   append-only means earlier OBSERVATION_ONLY entries stay exactly as they
 *   were written.
 *
 * ONE RECORD PER EXPLICIT INVOCATION
 *   No scheduler. No polling loop. No daemon. Each record corresponds to one
 *   human-authorised run, and its `recordedAt` is the time of that run.
 */
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Repo root, resolved from this file rather than from `process.cwd()`, so the
 * log lands in the same place regardless of the caller's working directory.
 * src/observability/ -> src/ -> packages/engine/ -> packages/ -> repo root.
 */
export const OBSERVATION_LOG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "..",
  "foundry", "evidence", "p11", "observation_log.jsonl",
);

/**
 * `logMode` is the load-bearing distinction. `OBSERVATION_ONLY` records can
 * never be read as trading evidence, because the type itself says no order was
 * dispatched. `PAPER_DEMO_TRADING` is reserved for the post-authorization
 * stream.
 */
export type LogMode = "OBSERVATION_ONLY" | "PAPER_DEMO_TRADING";

/** Set on a record whose purpose is to mark the phase transition. */
export interface PhaseTransition {
  readonly authorizedBy: string;
  readonly authorizationRef: string;
  readonly executionEnabledAt: string;
  readonly reason: string;
  readonly scope: string;
  /** Provider/calendar gate state at the moment execution was enabled. */
  readonly gateState: {
    readonly providerAuthorizedForAutomatedUse: boolean;
    readonly calendarBasis: string;
    readonly sameDayAlertsVerified: boolean;
    readonly completeChecklistRequired: true;
  };
  /** Money Boys commit the authorization was granted against. */
  readonly commitSha: string;
}

export interface ObservationRecord {
  readonly recordId: string;
  readonly recordedAt: string;
  readonly logMode: "OBSERVATION_ONLY";
  /** Path to the immutable evidence artifact this record summarises. */
  readonly sourceEvidenceRef: string;
  /** SHA-256 of that artifact, so a later edit is detectable. */
  readonly sourceEvidenceHash: string;
  /** Null on every observation record. Non-null only on a transition. */
  readonly phaseTransition: null;
  readonly decision: "NO_TRADE";
  readonly reason: string;
  /**
   * True when the reason above is derived from CURRENT policy rather than read
   * verbatim from the artifact, because the artifact predates that policy.
   */
  readonly reasonIsRetrospective: boolean;
  readonly sessionVerification: string;
  readonly sameDayAlertsChecked: false;
  readonly dispatchEligible: false;
  readonly executable: false;
  readonly executionAuthority: "none";
  readonly bridge: string;
  readonly benchmark: {
    readonly provider: string | null;
    readonly symbol: string | null;
    readonly sourceAsOf: string | null;
    readonly responseReceivedAt: string | null;
    readonly ageAtReceiptMs: number | null;
    readonly freshnessGateMs: number | null;
    readonly status: string | null;
    readonly timestampType: string | null;
  };
  readonly regime: string | null;
  readonly sessionTradable: boolean | null;
  readonly quant: {
    readonly action: string | null;
    readonly rawBasisPct: number | null;
    readonly hurdleRatePct: number | null;
    readonly netEdgePct: number | null;
    readonly quantScore: number | null;
  };
  readonly account: {
    readonly positions: number;
    readonly flat: boolean;
    readonly equityUsd: number | null;
    readonly equityDelta: number | null;
  };
  /** Always true. An observation can never have produced an order. */
  readonly orderSubmitted: false;
  readonly dispatcherInvoked: false;
  readonly moneyBoysCommit: string;
}

/** Raw shape of the campaign artifact, read defensively. */
interface EvidenceArtifact {
  recordedAt?: string;
  provenance?: Record<string, unknown>;
  freshness?: Record<string, unknown>;
  regime?: Record<string, unknown>;
  sessionVerification?: Record<string, unknown>;
  provider?: Record<string, unknown>;
  quant?: Record<string, unknown> | null;
  accountUnchangedByThisRun?: Record<string, unknown>;
  reconciliation?: { after?: Record<string, unknown>; basis?: Record<string, unknown> };
  surfaceResult?: Record<string, unknown>;
  request?: Record<string, unknown>;
  dispatcherInvoked?: boolean;
  orderSubmitted?: boolean;
}

function currentCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Derive a single human-readable reason from the artifact.
 *
 * Prefers the artifact's OWN blocking reasons over anything this module infers,
 * so the log cannot disagree with the evidence it cites.
 */
function deriveReason(a: EvidenceArtifact): string {
  const blocking = a.surfaceResult?.["blockingReasons"];
  const reasons = Array.isArray(blocking) ? blocking.map(String) : [];
  const gateBlocked = reasons.find((r) => r.startsWith("FAIL_CLOSED") || r.startsWith("CLOSED_SESSION_VETO"));
  if (gateBlocked !== undefined) return gateBlocked.slice(0, 300);

  const q = a.quant;
  if (q === null || q === undefined) {
    return "No Quant verdict was produced; the benchmark gate blocked evaluation. NO_TRADE.";
  }

  // POLICY-ERA CORRECTION.
  // Some early artifacts predate the closed-session veto (cfb07b9) and record a
  // Quant verdict with no veto reason even though the session was closed. The
  // artifact is preserved verbatim as historical evidence, but the LOG must
  // reflect what the CURRENT policy decides, or the log would present a
  // closed-session verdict as a routine observation.
  if (a.regime?.regime === "tradfi_closed") {
    return (
      `CLOSED_SESSION_VETO (current policy, applied retrospectively): the session was ` +
      `${a.regime.regime} with ${String(a.regime.hoursToNextReopen)}h carry to reopen. Quant is blocked ` +
      `while TradFi is closed, so this verdict would not be produced today. ` +
      `The artifact itself predates the veto. NO_TRADE.`
    );
  }
  const net = typeof q.netEdgePct === "number" ? q.netEdgePct : null;
  const hurdle = typeof q.hurdleRatePct === "number" ? q.hurdleRatePct : null;
  const basis = typeof q.rawBasisPct === "number" ? q.rawBasisPct : null;
  if (q.action === "NEUTRAL" && net !== null && hurdle !== null) {
    return (
      `Quant ${String(q.action)}: basis ${basis ?? "?"}% did not clear the ${hurdle}% hurdle; ` +
      `net edge ${net}%. NO_TRADE.`
    );
  }
  return `Quant returned ${String(q.action ?? "UNKNOWN")}. No order was dispatched; the surface has no execution authority.`;
}

/**
 * Convert one evidence artifact into an observation record.
 *
 * Deterministic: the recordId is derived from the artifact hash, so
 * normalising the same artifact twice yields the same id.
 */
export function normaliseToObservationRecord(args: {
  evidencePath: string;
  /** Overrides `recordedAt` when the artifact predates this normaliser. */
  recordedAt?: string;
  commitSha?: string;
}): ObservationRecord {
  const raw = readFileSync(args.evidencePath, "utf8");
  const a = JSON.parse(raw) as EvidenceArtifact;
  const hash = sha256(raw);
  const prov = a.provenance ?? {};
  const fresh = a.freshness ?? {};
  const provider = a.provider ?? {};
  const after = a.reconciliation?.after ?? {};
  const delta = a.accountUnchangedByThisRun ?? {};

  const recordedAt =
    args.recordedAt ??
    (typeof prov.responseReceivedAt === "string" ? prov.responseReceivedAt : new Date().toISOString());

  // Retrospective when the artifact carries neither a sessionVerification block
  // nor a veto reason, yet was recorded in a closed session.
  const hasSessionBlock = a.sessionVerification !== undefined;
  const hasVeto = Array.isArray(a.surfaceResult?.["blockingReasons"])
    ? (a.surfaceResult["blockingReasons"] as unknown[]).some((r) => String(r).includes("CLOSED_SESSION_VETO"))
    : false;
  const reasonIsRetrospective = a.regime?.regime === "tradfi_closed" && !hasSessionBlock && !hasVeto;

  return {
    recordId: `obs-${hash.slice(0, 16)}`,
    recordedAt,
    logMode: "OBSERVATION_ONLY",
    sourceEvidenceRef: args.evidencePath,
    sourceEvidenceHash: hash,
    phaseTransition: null,
    decision: "NO_TRADE",
    reason: deriveReason(a),
    reasonIsRetrospective,
    sessionVerification: String(a.sessionVerification?.["sessionVerification"] ?? "ANNUAL_CALENDAR_ONLY"),
    sameDayAlertsChecked: false,
    dispatchEligible: false,
    executable: false,
    executionAuthority: "none",
    bridge: String(a.surfaceResult?.["bridgePacketToDispatch"] ?? "absent"),
    benchmark: {
      provider: typeof provider.id === "string" ? provider.id : null,
      symbol: typeof provider.symbol === "string" ? provider.symbol : null,
      sourceAsOf: typeof prov.sourceAsOf === "string" ? prov.sourceAsOf : null,
      responseReceivedAt: typeof prov.responseReceivedAt === "string" ? prov.responseReceivedAt : null,
      ageAtReceiptMs: typeof fresh.ageAtReceiptMs === "number" ? fresh.ageAtReceiptMs : null,
      freshnessGateMs: typeof fresh.effectiveGateMs === "number" ? fresh.effectiveGateMs : null,
      status: typeof fresh.status === "string" ? fresh.status : null,
      timestampType: typeof prov.timestampType === "string" ? prov.timestampType : null,
    },
    regime: typeof a.regime?.regime === "string" ? a.regime.regime : null,
    sessionTradable:
      typeof a.sessionVerification?.["sessionTradable"] === "boolean"
        ? (a.sessionVerification["sessionTradable"] as boolean)
        : null,
    quant: {
      action: typeof a.quant?.action === "string" ? a.quant.action : null,
      rawBasisPct: typeof a.quant?.rawBasisPct === "number" ? a.quant.rawBasisPct : null,
      hurdleRatePct: typeof a.quant?.hurdleRatePct === "number" ? a.quant.hurdleRatePct : null,
      netEdgePct: typeof a.quant?.netEdgePct === "number" ? a.quant.netEdgePct : null,
      quantScore: typeof a.quant?.quantScore === "number" ? a.quant.quantScore : null,
    },
    account: {
      positions: typeof after.positionCount === "number" ? after.positionCount : -1,
      flat: after.accountFlat === true,
      equityUsd: typeof after.equityUsd === "number" ? after.equityUsd : null,
      equityDelta: typeof delta.equityDelta === "number" ? delta.equityDelta : null,
    },
    orderSubmitted: false,
    dispatcherInvoked: false,
    moneyBoysCommit: args.commitSha ?? currentCommit(),
  };
}

/**
 * Append one record. Refuses to overwrite: if the recordId already exists the
 * write is skipped, so re-running a normaliser cannot duplicate or mutate
 * history.
 */
export function appendObservationRecord(record: ObservationRecord, path: string = OBSERVATION_LOG_PATH): "appended" | "duplicate" {
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8");
    if (existing.includes(`"${record.recordId}"`)) return "duplicate";
    appendFileSync(path, JSON.stringify(record) + "\n", "utf8");
    return "appended";
  }
  appendFileSync(path, JSON.stringify(record) + "\n", "utf8");
  return "appended";
}

/**
 * Build an explicit phase-transition record.
 *
 * NOT emitted by any run. It exists so that the first PAPER_DEMO_TRADING
 * record is a deliberate, authorized act carrying its own evidence — never a
 * side effect of a fill, and never a rewrite of earlier observation records.
 *
 * `logMode` is NOT `OBSERVATION_ONLY` here, and `decision` is `PHASE_TRANSITION`
 * because no trade decision is being made by this record.
 */
export function buildPhaseTransitionRecord(args: {
  authorization: PhaseTransition;
  sourceEvidenceRef: string;
}): { recordId: string; recordedAt: string; logMode: LogMode; decision: "PHASE_TRANSITION"; phaseTransition: PhaseTransition } {
  const hash = sha256(`${args.sourceEvidenceRef}|${args.authorization.executionEnabledAt}|${args.authorization.commitSha}`);
  return {
    recordId: `phase-${hash.slice(0, 16)}`,
    recordedAt: args.authorization.executionEnabledAt,
    logMode: "PAPER_DEMO_TRADING",
    decision: "PHASE_TRANSITION",
    phaseTransition: args.authorization,
  };
}

/** Read the log for review. Never writes. */
export function readObservationLog(path: string = OBSERVATION_LOG_PATH): ObservationRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ObservationRecord);
}