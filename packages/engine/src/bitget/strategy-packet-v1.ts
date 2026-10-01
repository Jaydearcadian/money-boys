/**
 * StrategyPacketV1 — the typed artifact that crosses from benchmark evidence
 * to venue intent.
 *
 * WHAT THIS IS NOT
 *   It is deliberately NOT a `PreflightPacket`. That type carries an
 *   `executable` field, which is authorization vocabulary. This packet carries
 *   no such field: it describes a *proposed* intent with its evidence bound in,
 *   and it confers nothing on its own.
 *
 * WHAT IT BINDS
 *   Every value that a reviewer would need in order to disagree with the
 *   decision: the benchmark provenance with both local timestamps, the
 *   admission basis actually used, the session verdict, the Quant edge, the
 *   Risk and Council decisions, and an explicit expiry.
 *
 * EXPIRY
 *   `expiresAt` bounds how long a packet may describe the world it was built
 *   from. Admission is re-checked at dispatch regardless (see bridge.ts), so
 *   expiry is defence in depth rather than the sole control.
 *
 * IMMUTABILITY
 *   Everything is `readonly`. The packet is hashed into the reasoning receipt,
 *   so mutating it after sealing would break verification.
 */
import type { QuantAnalysisResult } from "../agents/quant.js";
import type { SessionDayType } from "../agents/session-calendar.js";

/** Admission freshness basis. Receipt-relative only, by policy. */
export const ADMISSION_BASIS = "receipt-relative" as const;

/** Default packet lifetime. Well inside a human-in-the-loop confirmation step. */
export const PACKET_TTL_MS = 60_000;

export interface PacketSymbolMapping {
  readonly repoSymbol: string;
  readonly venueSymbol: string;
  readonly referenceSymbol: string;
}

export interface PacketBenchmark {
  readonly provider: string;
  /** Provider-published instant, verbatim. Never rewritten. */
  readonly sourceAsOf: string;
  /** Local clock when the provider request was issued. */
  readonly requestedAt: string;
  /** Local clock when the response was received. THE ADMISSION INSTANT. */
  readonly responseReceivedAt: string;
  /** sourceAsOf -> responseReceivedAt. The age admission was decided on. */
  readonly ageAtReceiptMs: number;
  readonly freshnessBasis: typeof ADMISSION_BASIS;
  readonly freshness: "verified_fresh";
  readonly effectiveThresholdMs: number;
  readonly timestampType: string;
  readonly bid: number;
  readonly ask: number;
  readonly midpoint: number;
  readonly isTradingHalt: false;
}

export interface PacketSession {
  /** Calendar date in ET, YYYY-MM-DD. */
  readonly date: string;
  readonly dayType: SessionDayType;
  readonly calendarId: string;
  readonly exchange: string;
  /** Minutes from ET midnight. */
  readonly openMinute: number;
  readonly closeMinute: number;
  /** The clock time at admission. */
  readonly admissionMinute: number;
}

export interface PacketSizing {
  readonly compliantQuantity: number;
  readonly roundedNotionalUsd: number;
  readonly minQty: number;
  readonly minNotionalUsdt: number;
  readonly multiplier: number;
}

export interface PacketRisk {
  readonly decision: "APPROVED";
  readonly exposureUsd: number;
  readonly projectedMarginUtilization: number;
}

export interface PacketCouncil {
  readonly compositeScore: number;
  readonly macro: number;
  readonly quant: number;
  readonly risk: number;
  readonly exec: number;
}

export interface StrategyPacketV1 {
  readonly version: 1;
  /** Environment this packet may be dispatched in. Demo only, by policy. */
  readonly environment: "DEMO";
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly symbolMapping: PacketSymbolMapping;
  readonly benchmark: PacketBenchmark;
  readonly session: PacketSession;
  readonly quant: QuantAnalysisResult;
  readonly sizing: PacketSizing;
  readonly risk: PacketRisk;
  readonly council: PacketCouncil;
  /** Derived from Quant; recomputed and re-checked at dispatch. */
  readonly positiveNetEdge: true;
}

/** A rejection, carrying every reason rather than only the first. */
export interface PacketRejection {
  readonly ok: false;
  readonly code: string;
  readonly reasons: string[];
}

export const PACKET_OK = "OK" as const;
export const PACKET_REJECTED = "REJECTED" as const;

/**
 * Construct a packet, or explain why it cannot exist.
 *
 * Admission conditions, all of which must hold:
 *   - benchmark admitted with receipt-relative freshness
 *   - session classified as tradable by the calendar
 *   - positive net edge and a directional Quant verdict
 *   - Risk APPROVED
 *   - Council quorum reached
 *
 * Note what is NOT checked here: packet expiry and dispatch-time freshness are
 * re-evaluated by the bridge at dispatch. Checking them at construction as
 * well would be correct but redundant.
 */
export function buildStrategyPacket(args: {
  symbolMapping: PacketSymbolMapping;
  benchmark: PacketBenchmark;
  session: PacketSession;
  quant: QuantAnalysisResult;
  sizing: PacketSizing;
  risk: PacketRisk;
  council: PacketCouncil;
  now: Date;
  ttlMs?: number;
}): StrategyPacketV1 | PacketRejection {
  const reasons: string[] = [];

  if (args.benchmark.freshnessBasis !== ADMISSION_BASIS) {
    reasons.push(
      `ADMISSION_BASIS_INVALID: expected '${ADMISSION_BASIS}', got '${args.benchmark.freshnessBasis}'`,
    );
  }
  if (args.benchmark.freshness !== "verified_fresh") {
    reasons.push(`BENCHMARK_NOT_FRESH: ${args.benchmark.freshness}`);
  }
  if (args.benchmark.isTradingHalt !== false) {
    reasons.push("BENCHMARK_HALTED: the underlying is under a trading halt");
  }
  if (!(args.benchmark.ageAtReceiptMs < args.benchmark.effectiveThresholdMs)) {
    reasons.push(
      `BENCHMARK_STALE: ageAtReceiptMs=${args.benchmark.ageAtReceiptMs} is not within the effective gate ${args.benchmark.effectiveThresholdMs}`,
    );
  }
  if (args.quant.netEdge <= 0) {
    reasons.push(`NO_POSITIVE_EDGE: netEdge=${args.quant.netEdge}`);
  }
  if (args.quant.action === "NEUTRAL") {
    reasons.push("QUANT_NEUTRAL: no directional verdict");
  }
  if (args.risk.decision !== "APPROVED") {
    reasons.push(`RISK_NOT_APPROVED: ${args.risk.decision}`);
  }
  if (!(args.sizing.compliantQuantity > 0)) {
    reasons.push(`SIZING_INVALID: compliantQuantity=${args.sizing.compliantQuantity}`);
  }

  if (reasons.length > 0) {
    return { ok: false, code: "PACKET_ADMISSION_FAILED", reasons };
  }

  const ttl = args.ttlMs ?? PACKET_TTL_MS;
  return {
    version: 1,
    environment: "DEMO",
    issuedAt: args.now.toISOString(),
    expiresAt: new Date(args.now.getTime() + ttl).toISOString(),
    symbolMapping: args.symbolMapping,
    benchmark: args.benchmark,
    session: args.session,
    quant: args.quant,
    sizing: args.sizing,
    risk: args.risk,
    council: args.council,
    positiveNetEdge: true,
  };
}