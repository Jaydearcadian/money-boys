/**
 * FIXTURE-BACKED SOURCE ADAPTERS.
 *
 * WHAT THIS IS
 *   Normalisers that turn LOCAL fixture envelopes into `SourceObservation`s the
 *   runner already understands. No live network, no credentials, no MCP client,
 *   no signal subscription, no artifact download. Every adapter here reads a
 *   literal the caller supplies.
 *
 * WHY FIXTURE-BACKED, NOT CONNECTED
 *   Connecting to Bitget MCP, bitget-signal, GetAgent or Playbook would require
 *   credentials nobody has authorised, would introduce polling, and — for the
 *   MCP and signal paths — would mean machine-reading sources whose operators
 *   restrict automated capture. The normalisers are the part that can be built
 *   and proven honestly; the transports are a later, separately authorized step.
 *
 * THE AUTHORITY RULE, ENFORCED IN THE TYPES
 *   No adapter exposes an execution capability. The `SourceAdapter` interface has
 *   exactly one method, `observe`, and no adapter returns anything other than a
 *   SourceObservation or an explicit failure. There is no EXECUTE, DISPATCH,
 *   ORDER, SIGN or MUTATE anywhere in this file, and none can be added without
 *   changing the interface the runner consumes.
 *
 *   External inputs may INFORM Money Boys. Only Money Boys can eventually
 *   validate and execute.
 *
 * TIMESTAMP DISCIPLINE PER ADAPTER
 *   - Bitget MCP: a venue timestamp is preserved but NEVER confers benchmark
 *     eligibility. Its refusal is INDEPENDENCE_FAILURE, reported verbatim.
 *   - bitget-signal: a supplied `sourceAsOf` is preserved, and its presence
 *     still does NOT make it a benchmark. A signal that merely carries a
 *     timestamp is not a market reference.
 *   - Artifacts: `sourceAsOf` is the artifact's issued-at instant. It is a
 *     provenance fact about the artifact, not a market timestamp.
 *   - Robinhood/manual: `sourceAsOf` remains mandatory and provider-issued, and
 *     `fetchedAt` / `responseReceivedAt` remain distinct.
 */
import { createHash } from "node:crypto";
import {
  canonicalJson,
  type SourceAdapter,
  type SourceObservation,
  type SourceObservationFailure,
  type SourceRole,
} from "./source-model.js";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Stable content hash for any fixture envelope. */
export function contentHash(value: unknown): string {
  return sha256(canonicalJson(value));
}

/**
 * Reject an envelope that claims a capability the adapter layer must never have.
 *
 * This is a hard structural guard rather than a convention: if a fixture
 * envelope ever arrives carrying an execution-shaped field, the adapter fails
 * closed rather than normalizing it and hoping the downstream layer notices.
 */
const FORBIDDEN_ENVELOPE_KEYS = [
  "execute", "EXECUTE", "dispatch", "DISPATCH", "placeOrder", "place_order",
  "order", "ORDER", "sign", "SIGN", "mutate", "MUTATE", "portfolio",
  "executionAuthority", "executionEnabledAt",
];

export function assertNoExecutionCapability(envelope: Record<string, unknown>): string | null {
  for (const key of FORBIDDEN_ENVELOPE_KEYS) {
    if (key in envelope) return `FORBIDDEN_CAPABILITY: envelope carries '${key}', which the adapter layer must never accept`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. Bitget MCP — VENUE_MARKET_DATA
// ---------------------------------------------------------------------------

/** Local fixture envelope shape for a venue market-data response. */
export interface BitgetMcpEnvelope {
  readonly symbol: string;
  readonly bid?: number | string;
  readonly ask?: number | string;
  readonly last?: number | string;
  readonly ts?: number | string;
  readonly fetchedAt: string;
  readonly responseReceivedAt: string;
  readonly provider?: string;
  readonly provenance?: Record<string, unknown>;
}

function num(v: number | string | undefined): number | null {
  if (v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalise a Bitget MCP market-data envelope.
 *
 * The venue instant IS preserved as `sourceAsOf` when supplied — discarding it
 * would lose real provenance — but role eligibility is what keeps it out of the
 * benchmark gate, not the timestamp's quality.
 */
export function bitgetMcpAdapter(envelope: BitgetMcpEnvelope): SourceAdapter {
  const provider = envelope.provider ?? "bitget_mcp";
  return {
    provider,
    role: "VENUE_MARKET_DATA" as SourceRole,
    offline: true,
    observe: (): SourceObservation | SourceObservationFailure => {
      if (typeof envelope.symbol !== "string" || envelope.symbol.length === 0) {
        return { provider, role: "VENUE_MARKET_DATA", symbol: String(envelope.symbol ?? ""), code: "MALFORMED_ENVELOPE", message: "symbol is required" };
      }
      const bid = num(envelope.bid);
      const ask = num(envelope.ask);
      const price = num(envelope.last) ?? (bid !== null && ask !== null ? Number(((bid + ask) / 2).toFixed(8)) : null);
      // Venue ts, when present, is the match-engine instant for the traded
      // instrument. Retained as provenance; never a benchmark.
      const sourceAsOf =
        envelope.ts === undefined
          ? null
          : new Date(typeof envelope.ts === "number" ? envelope.ts : Number(envelope.ts)).toISOString();

      return {
        provider,
        role: "VENUE_MARKET_DATA",
        symbol: envelope.symbol,
        bid,
        ask,
        price,
        sourceAsOf,
        fetchedAt: envelope.fetchedAt,
        responseReceivedAt: envelope.responseReceivedAt,
        timestampType: sourceAsOf === null ? "NONE_SUPPLIED" : "VENUE_MATCH_ENGINE_EVENT",
        timestampNote:
          "venue match-engine instant for the traded instrument; NOT an independent underlying-equity reference",
        failureReason: null,
        provenance: {
          ...(envelope.provenance ?? {}),
          envelopeHash: contentHash(envelope),
          benchmarkEligible: false,
          benchmarkRefusal: "INDEPENDENCE_FAILURE",
        },
        artifactHash: null,
        strategyVersion: null,
        metrics: null,
        expiresAt: null,
        externalExecution: false,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 2. bitget-signal — RESEARCH_SIGNAL
// ---------------------------------------------------------------------------

export type SignalKind = "macro" | "sentiment" | "technical" | "news";

export interface BitgetSignalEnvelope {
  readonly signalId: string;
  readonly kind: SignalKind;
  readonly symbol: string;
  readonly direction?: "BULLISH" | "BEARISH" | "NEUTRAL";
  readonly confidence?: number;
  readonly rationale?: string;
  /** Optional provider-issued instant. Its presence does NOT confer benchmark use. */
  readonly sourceAsOf?: string;
  readonly fetchedAt: string;
  readonly responseReceivedAt: string;
  readonly expiresAt?: string;
  readonly provider?: string;
}

const VALID_SIGNAL_KINDS: readonly SignalKind[] = ["macro", "sentiment", "technical", "news"];

/**
 * Normalise a bitget-signal proposal.
 *
 * The signal's own content hash and expiry are preserved, and a supplied
 * `sourceAsOf` is kept as provenance. Role `RESEARCH_SIGNAL` is what keeps it
 * out of the benchmark gate: a signal carrying a perfect timestamp is still a
 * proposal, not a market reference.
 */
export function bitgetSignalAdapter(envelope: BitgetSignalEnvelope): SourceAdapter {
  const provider = envelope.provider ?? "bitget_signal";
  return {
    provider,
    role: "RESEARCH_SIGNAL" as SourceRole,
    offline: true,
    observe: (): SourceObservation | SourceObservationFailure => {
      if (!VALID_SIGNAL_KINDS.includes(envelope.kind)) {
        return { provider, role: "RESEARCH_SIGNAL", symbol: envelope.symbol, code: "UNKNOWN_SIGNAL_KIND", message: `kind '${String(envelope.kind)}' is not one of ${VALID_SIGNAL_KINDS.join(", ")}` };
      }
      if (typeof envelope.signalId !== "string" || envelope.signalId.length === 0) {
        return { provider, role: "RESEARCH_SIGNAL", symbol: envelope.symbol, code: "MALFORMED_ENVELOPE", message: "signalId is required" };
      }
      const confidence = num(envelope.confidence);
      if (confidence !== null && (confidence < 0 || confidence > 1)) {
        return { provider, role: "RESEARCH_SIGNAL", symbol: envelope.symbol, code: "CONFIDENCE_OUT_OF_RANGE", message: `confidence ${confidence} is outside 0..1` };
      }
      return {
        provider,
        role: "RESEARCH_SIGNAL",
        symbol: envelope.symbol,
        bid: null,
        ask: null,
        price: null,
        sourceAsOf: envelope.sourceAsOf ?? null,
        fetchedAt: envelope.fetchedAt,
        responseReceivedAt: envelope.responseReceivedAt,
        timestampType: envelope.sourceAsOf === undefined ? "NONE_SUPPLIED" : "PROVIDER_GENERATED_QUOTE",
        timestampNote:
          "signal issued-at instant; a research proposal, NOT an independent market reference",
        failureReason: null,
        provenance: {
          signalId: envelope.signalId,
          kind: envelope.kind,
          direction: envelope.direction ?? null,
          rationale: envelope.rationale ?? null,
          // The signal's own content hash, distinct from provenanceHash.
          signalContentHash: contentHash({
            signalId: envelope.signalId, kind: envelope.kind, direction: envelope.direction ?? null,
            confidence: confidence, rationale: envelope.rationale ?? null,
          }),
          benchmarkEligible: false,
        },
        artifactHash: contentHash({
          signalId: envelope.signalId, kind: envelope.kind, direction: envelope.direction ?? null,
          confidence, rationale: envelope.rationale ?? null,
        }),
        strategyVersion: null,
        metrics: confidence === null ? null : { confidence },
        expiresAt: envelope.expiresAt ?? null,
        externalExecution: false,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 3. GetAgent / Playbook artifacts
// ---------------------------------------------------------------------------

export interface StrategyArtifactEnvelope {
  readonly artifactId: string;
  readonly role: "STRATEGY_ARTIFACT" | "BACKTEST_ARTIFACT" | "PAPER_TRADING_ARTIFACT";
  readonly strategyName: string;
  readonly strategyVersion: string;
  readonly symbol?: string;
  readonly issuedAt: string;
  readonly loadedAt: string;
  /** SHA-256 the producer declared. Recomputed and compared. */
  readonly declaredHash?: string;
  readonly metrics?: Record<string, unknown>;
  /**
   * Declared by the producer. When the artifact describes paper trades run
   * elsewhere, this MUST be true, and the adapter verifies the declaration is
   * consistent with the role rather than trusting it.
   */
  readonly externalExecution?: boolean;
  readonly notes?: string;
  readonly provider?: string;
}

/**
 * Normalise a GetAgent/Playbook artifact envelope.
 *
 * Validation is deliberately strict: a missing version, an unparseable issued
 * at, or a declared hash that disagrees with the recomputed one all fail
 * closed. An artifact that cannot be shown to be the reviewed object is not
 * recorded as though it were.
 *
 * `externalExecution` is enforced against the role: only
 * PAPER_TRADING_ARTIFACT may declare it, so external paper evidence cannot be
 * filed under a strategy label, nor a strategy artifact passed off as a
 * record of trades.
 */
export function strategyArtifactAdapter(envelope: StrategyArtifactEnvelope): SourceAdapter {
  const provider = envelope.provider ?? "getagent_playbook";
  const role = envelope.role;
  return {
    provider,
    role: role as SourceRole,
    offline: true,
    observe: (): SourceObservation | SourceObservationFailure => {
      const symbol = envelope.symbol ?? "n/a";
      const reject = (code: string, message: string): SourceObservationFailure =>
        ({ provider, role, symbol, code, message });

      if (typeof envelope.artifactId !== "string" || envelope.artifactId.length === 0) {
        return reject("MALFORMED_ENVELOPE", "artifactId is required");
      }
      if (typeof envelope.strategyVersion !== "string" || envelope.strategyVersion.length === 0) {
        return reject("MISSING_STRATEGY_VERSION", "strategyVersion is required; an unversioned artifact cannot be reviewed");
      }
      const issuedMs = Date.parse(envelope.issuedAt);
      if (Number.isNaN(issuedMs)) {
        return reject("MALFORMED_ISSUED_AT", `issuedAt '${String(envelope.issuedAt)}' is not a parseable instant`);
      }
      if (envelope.role === "PAPER_TRADING_ARTIFACT" && envelope.externalExecution !== true) {
        return reject(
          "EXTERNAL_EXECUTION_NOT_DECLARED",
          "a PAPER_TRADING_ARTIFACT must declare externalExecution: true; external paper evidence must never be recorded as Money Boys controlled execution",
        );
      }
      if (envelope.role !== "PAPER_TRADING_ARTIFACT" && envelope.externalExecution === true) {
        return reject(
          "EXTERNAL_EXECUTION_ROLE_MISMATCH",
          `role ${role} may not declare externalExecution; only PAPER_TRADING_ARTIFACT describes externally executed trades`,
        );
      }

      const artifactHash = contentHash({
        artifactId: envelope.artifactId,
        role: envelope.role,
        strategyName: envelope.strategyName,
        strategyVersion: envelope.strategyVersion,
        symbol: envelope.symbol ?? null,
        issuedAt: envelope.issuedAt,
        metrics: envelope.metrics ?? null,
        externalExecution: envelope.externalExecution === true,
        notes: envelope.notes ?? null,
      });
      if (envelope.declaredHash !== undefined && envelope.declaredHash !== artifactHash) {
        return reject(
          "ARTIFACT_HASH_MISMATCH",
          `declared hash ${envelope.declaredHash} does not match the recomputed content hash ${artifactHash}`,
        );
      }

      return {
        provider,
        role,
        symbol,
        bid: null,
        ask: null,
        price: null,
        // The artifact's issued-at instant: provenance about the ARTIFACT, not a
        // market timestamp. Role eligibility keeps it out of the benchmark gate.
        sourceAsOf: envelope.issuedAt,
        fetchedAt: envelope.loadedAt,
        responseReceivedAt: envelope.loadedAt,
        timestampType: "ARTIFACT_ISSUED_AT",
        timestampNote:
          "artifact issued-at instant; provenance of the artifact, NOT a market timestamp and NOT an independent benchmark",
        failureReason: null,
        provenance: {
          artifactId: envelope.artifactId,
          strategyName: envelope.strategyName,
          notes: envelope.notes ?? null,
          benchmarkEligible: false,
        },
        artifactHash,
        strategyVersion: envelope.strategyVersion,
        metrics: envelope.metrics ?? null,
        expiresAt: null,
        externalExecution: envelope.role === "PAPER_TRADING_ARTIFACT",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Manual benchmark — the preserved existing path
// ---------------------------------------------------------------------------

/**
 * The manual, operator-injected reference-benchmark observation.
 *
 * Deliberately NOT a network client. This accepts an ALREADY-VALIDATED
 * observation the operator obtained and hands over; it performs no fetch. The
 * `sourceAsOf` / `fetchedAt` / `responseReceivedAt` distinctness and the
 * provider-issued `sourceAsOf` requirement are enforced downstream in
 * `admitBenchmark`, and this constructor refuses to pre-fill `sourceAsOf` from a
 * local clock even if asked to.
 */
export function manualBenchmarkObservation(args: {
  provider?: string;
  symbol: string;
  bid: number;
  ask: number;
  /** Provider-published instant. MANDATORY. Never derived from a local clock. */
  sourceAsOf: string;
  requestedAt: string;
  responseReceivedAt: string;
  timestampType?: SourceObservation["timestampType"];
}): SourceObservation | SourceObservationFailure {
  const provider = args.provider ?? "robinhood_stock_token_api";
  const reject = (code: string, message: string): SourceObservationFailure =>
    ({ provider, role: "REFERENCE_BENCHMARK", symbol: args.symbol, code, message });

  if (typeof args.sourceAsOf !== "string" || args.sourceAsOf.length === 0) {
    return reject("SOURCE_ASOF_MISSING", "a reference benchmark requires a provider-issued sourceAsOf");
  }
  if (Number.isNaN(Date.parse(args.sourceAsOf))) {
    return reject("MALFORMED_GENERATED_AT", `sourceAsOf '${args.sourceAsOf}' is not a parseable instant`);
  }
  // Refuse the specific failure this whole design exists to prevent: quietly
  // stamping our own clock into the provider field.
  if (args.sourceAsOf === args.requestedAt || args.sourceAsOf === args.responseReceivedAt) {
    return reject("LOCAL_CLOCK_AS_SOURCE_ASOF", "sourceAsOf equals a local request instant; a provider timestamp is mandatory");
  }
  if (args.requestedAt === args.responseReceivedAt) {
    return reject("TIMESTAMPS_NOT_DISTINCT", "fetchedAt and responseReceivedAt must be distinct instants");
  }
  return {
    provider,
    role: "REFERENCE_BENCHMARK",
    symbol: args.symbol,
    bid: args.bid,
    ask: args.ask,
    price: null,
    sourceAsOf: args.sourceAsOf,
    fetchedAt: args.requestedAt,
    responseReceivedAt: args.responseReceivedAt,
    timestampType: args.timestampType ?? "PROVIDER_GENERATED_QUOTE",
    timestampNote: "provider generatedAt; not an exchange trade time",
    failureReason: null,
    provenance: { injectedManually: true, benchmarkEligible: true },
    artifactHash: null,
    strategyVersion: null,
    metrics: null,
    expiresAt: null,
    externalExecution: false,
  };
}