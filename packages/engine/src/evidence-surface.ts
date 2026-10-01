/**
 * Phase 1 — read-only benchmark evidence surface.
 *
 * WHAT THIS IS
 *   A single, credential-free, side-effect-free read of the benchmark evidence
 *   the strategy would need, shaped for display. It exists so the evidence
 *   discipline (provenance, freshness, symbol mapping, regime-aware carry,
 *   Quant verdict) is VISIBLE rather than asserted in prose.
 *
 * WHAT THIS IS NOT — read this before wiring anything to it
 *   - It has NO execution authority. `executable` is hard-coded `false` and
 *     `executionAuthority` is the literal "none". There is no code path from
 *     this module to OrderDispatcher, to a private Bitget route, or to an
 *     order of any kind.
 *   - It does NOT build a PreflightPacket. `buildPacket` requires an
 *     authenticated account (equity/free margin) and returns `executable`,
 *     which would misrepresent a display surface as an authorization surface.
 *   - There is NO packet-to-dispatch bridge in this repository. The benchmark
 *     half (`robinhoodToEvidence` -> gate -> Quant) and the venue half
 *     (`sealReceipt` -> OrderDispatcher) are separate, proven-separately
 *     paths. See `bridge.packetToDispatch` in the response, which is the
 *     literal string "absent" and must stay that way until a bridge is
 *     designed, authorized and separately verified.
 *   - It uses only PUBLIC, unauthenticated market data (Robinhood Stock Token
 *     API, Bitget public market routes). No Bitget API key is read here and
 *     none may be added.
 *
 * DETERMINISM
 *   `fetchImpl`, `now` and `symbol` are all injectable so the whole surface is
 *   testable with zero network access.
 */
import { BitgetClient } from "./bitget/client.js";
import { mapToVenueSymbol } from "./bitget/dispatcher.js";
import { evaluateBasisSpread, type QuantAnalysisResult } from "./agents/quant.js";
import { resolveRegime, assertBenchmarkProvable, type RegimeSnapshot } from "./agents/market-regime.js";
import {
  fetchRobinhoodBenchmark,
  toUnderlyingReferenceSymbol,
  type FetchLike,
} from "./integrations/robinhood/benchmark.js";
import { BenchmarkSourceError } from "./integrations/robinhood/benchmark.js";
import { robinhoodToEvidence, REPO_SYMBOL, PRODUCT_TYPE } from "./bitget/strategy-packet.js";

/**
 * EFFECTIVE freshness gate for the benchmark pre-flight.
 *
 * This is the provider's DOCUMENTED CACHE WINDOW for /rhj/prices
 * (RH_PRICES_CACHE_WINDOW_MS). It is the operative threshold: a quote older
 * than this is `verified_stale` and, while TradFi is open, fails the gate.
 *
 * It was previously 96h, inherited from the Stage 3 bounded pre-flight. That
 * was a real defect, not cosmetic: `robinhoodToEvidence` derives
 * `verified_fresh` purely from `ageMs < maxAgeMs`, and
 * `assertBenchmarkProvable` accepts only `verified_fresh` in the open regime —
 * so a 4-day-old quote was being accepted as fresh. The documented cache
 * window is the defensible bound; the 96h ceiling is retained below only as a
 * labelled, non-operative inherited value.
 */
export const EVIDENCE_EFFECTIVE_MAX_AGE_MS = 15_000;

/**
 * Inherited generic benchmark maximum age from the Stage 3 pre-flight.
 *
 * NOT the operative gate. It is reported for comparison so a reader can see
 * exactly how much stricter this surface is than the packet path. It must
 * never be passed as `maxAgeMs` to `robinhoodToEvidence`.
 */
export const EVIDENCE_INHERITED_BENCHMARK_MAX_AGE_MS = 96 * 60 * 60 * 1000;

/** Notional used only to let Quant price the spread. Never an order size. */
const EVIDENCE_ORDER_SIZE_USD = 25;

export type EvidenceStatus = "ok" | "unusable" | "error";

export interface EvidenceSymbolMapping {
  repoSymbol: string;
  venueSymbol: string;
  referenceSymbol: string;
  note: string;
}

export interface EvidenceBenchmark {
  provider: string;
  source: string;
  symbol: string;
  bid: number;
  ask: number;
  midpoint: number;
  currency: string;
  /** Provider-published quote instant. Never a fetch time. */
  sourceAsOf: string;
  /** Local request time. Never a substitute for sourceAsOf. */
  fetchedAt: string;
  timestampType: string;
  cacheWindowMs: number;
  /** False on every successful read; a halt fails the read instead. */
  isTradingHalt: boolean;
  sourceUrl: string;
  priceBasis: string;
  multiplierCurrent: string | null;
  multiplierAppliedToPrice: false;
}

export interface EvidenceFreshness {
  status: "verified_fresh" | "verified_stale" | "unverifiable";
  ageMs: number | null;
  /** The gate that was actually applied. Provider cache/freshness limit. */
  effectiveThresholdMs: number;
  /** Inherited generic benchmark ceiling. NOT the operative gate. */
  inheritedBenchmarkMaxAgeMs: number;
  /** Provider's documented cache window. Equals the effective gate. */
  providerCacheWindowMs: number;
}

export interface EvidenceRegime {
  regime: RegimeSnapshot["regime"];
  etNowIso: string;
  hoursToNextReopen: number;
  nextReopenAtIso: string | null;
  requiredBenchmarkSource: string;
  holidayCalendarSupported: false;
  limitation: string;
}

export interface EvidenceQuant {
  action: QuantAnalysisResult["action"];
  rawBasis: number;
  rawBasisPct: number;
  hurdleRate: number;
  hurdleRatePct: number;
  netEdge: number;
  netEdgePct: number;
  quantScore: number;
  zScore: number;
  tokenPrice: number;
  benchmarkPrice: number;
  midPrice: number;
  vwapPrice: number | null;
  reasons: string[];
}

export interface EvidenceResponse {
  ok: boolean;
  status: EvidenceStatus;
  /** Always "read_only". Not a claim about the rest of the system. */
  authority: "read_only";
  /** Always "none". This surface cannot dispatch anything. */
  executionAuthority: "none";
  /** Local time this response was assembled. */
  generatedAt: string;
  symbolMapping: EvidenceSymbolMapping;
  benchmark: EvidenceBenchmark | null;
  freshness: EvidenceFreshness | null;
  regime: EvidenceRegime;
  quant: EvidenceQuant | null;
  gate: { usable: boolean; blockedReason: string | null };
  /** Hard-coded false. See the module header. */
  executable: false;
  blockingReasons: string[];
  /**
   * The architectural gap, stated as data. "absent" is correct today and any
   * other value must come from a separately authorized bridge implementation.
   */
  bridge: { packetToDispatch: "absent" };
  error: { code: string; message: string } | null;
  notes: string[];
}

/**
 * Build the read-only evidence response.
 *
 * Never throws: every failure is returned as `status: "error"` with a typed
 * code so the display surface can render a real failure state instead of a
 * blank panel.
 */
export async function buildEvidenceResponse(args: {
  symbol?: string;
  fetchImpl?: FetchLike;
  now?: Date;
  maxAgeMs?: number;
}): Promise<EvidenceResponse> {
  const repoSymbol = args.symbol ?? REPO_SYMBOL;
  const now = args.now ?? new Date();
  // The effective freshness gate is the provider-documented cache window;
    // the inherited generic benchmark maximum age is kept distinct.
    const effectiveMaxAgeMs = args.maxAgeMs ?? EVIDENCE_EFFECTIVE_MAX_AGE_MS;
  const fetchImpl: FetchLike =
    args.fetchImpl ?? ((input, init) => fetch(input, init) as unknown as ReturnType<FetchLike>);
  /** Same transport for the public Bitget market reads below. */
  const venueFetch: typeof fetch = (input, init) =>
    fetchImpl(input as unknown as string, init as never) as unknown as ReturnType<typeof fetch>;
  const venueSymbol = mapToVenueSymbol(repoSymbol);
  const referenceSymbol = toUnderlyingReferenceSymbol(repoSymbol);
  const regime = resolveRegime(now);

  const symbolMapping: EvidenceSymbolMapping = {
    repoSymbol,
    venueSymbol,
    referenceSymbol,
    note: "r-prefixed Bitget spot symbol -> bare Bitget futures symbol -> underlying equity reference",
  };

  const regimeBlock: EvidenceRegime = {
    regime: regime.regime,
    etNowIso: regime.etNowIso,
    hoursToNextReopen: regime.hoursToNextReopen,
    nextReopenAtIso: regime.nextReopenAtIso,
    requiredBenchmarkSource: regime.requiredBenchmarkSource,
    holidayCalendarSupported: regime.holidayCalendarSupported,
    limitation: regime.limitation,
  };

  const base = {
    authority: "read_only" as const,
    executionAuthority: "none" as const,
    generatedAt: now.toISOString(),
    symbolMapping,
    bridge: { packetToDispatch: "absent" as const },
  };

  /**
   * Why `executable` can never be true here, restated in the payload so the
   * reason travels with the data instead of living only in a comment.
   */
  const ALWAYS_BLOCKED: string[] = [
    "READ_ONLY_SURFACE: this evidence endpoint has no execution authority and cannot dispatch an order",
    "NO_PACKET_TO_DISPATCH_BRIDGE: no typed path exists from a benchmark packet to OrderDispatcher; the benchmark half and the venue half are proven separately, not end-to-end",
  ];

  try {
    // ---- Benchmark: public, credential-free ---------------------------------
    // fetchRobinhoodBenchmark (not the client factory) so `fetchedAt` is the
    // injected instant: keeps fixtures deterministic and makes the local
    // request time an explicit, auditable input rather than ambient state.
    const b = await fetchRobinhoodBenchmark({
      symbol: referenceSymbol,
      fetchImpl,
      fetchedAt: now.toISOString(),
    });

    // Public Bitget market data only. No key, no signing, no private route.
    const client = new BitgetClient({ apiKey: "", secretKey: "", passphrase: "", fetchImpl: venueFetch });
    const ticker = await client.getMixTicker(venueSymbol, PRODUCT_TYPE);
    const book = await client.getMixOrderbook(venueSymbol, 20, PRODUCT_TYPE);
    const contractRaw = await client.getMixContractConfig(venueSymbol, PRODUCT_TYPE);
    const tokenPrice = Number(ticker.lastPr);

    // ---- Benchmark gate runs BEFORE Quant, exactly as in the packet path ----
    // THE operative gate. Must be the effective (provider cache window)
    // value, never the inherited 96h ceiling.
    const evidence = robinhoodToEvidence(b, effectiveMaxAgeMs);
    let gateUsable = true;
    let gateBlockedReason: string | null = null;
    let quant: EvidenceQuant | null = null;
    let status: EvidenceStatus = "ok";
    const blockingReasons: string[] = [];

    try {
      assertBenchmarkProvable(evidence, regime.regime);
    } catch (err) {
      gateUsable = false;
      gateBlockedReason = err instanceof Error ? err.message : String(err);
      status = "unusable";
      blockingReasons.push(gateBlockedReason);
    }

    // Quant does not run at all when the benchmark gate blocks.
    if (gateUsable) {
      const q = evaluateBasisSpread({
        tokenPrice,
        tradFiClosePrice: evidence.price,
        orderSizeUsd: EVIDENCE_ORDER_SIZE_USD,
        depth: {
          bids: book.bids.map(([p, s]) => ({ price: Number(p), quantity: Number(s) })),
          asks: book.asks.map(([p, s]) => ({ price: Number(p), quantity: Number(s) })),
        },
        fundingRate8h: Number(ticker.fundingRate ?? 0),
        hoursToClose: regime.hoursToNextReopen,
        takerFee: Number(contractRaw.takerFeeRate ?? 0.0006),
      });
      quant = {
        action: q.action,
        rawBasis: q.rawBasis,
        rawBasisPct: q.rawBasisPct,
        hurdleRate: q.hurdleRate,
        hurdleRatePct: q.hurdleRatePct,
        netEdge: q.netEdge,
        netEdgePct: q.netEdgePct,
        quantScore: q.quantScore,
        zScore: q.zScore,
        tokenPrice,
        benchmarkPrice: evidence.price,
        midPrice: q.midPrice,
        vwapPrice: q.vwapPrice,
        reasons: q.reasons,
      };
    }

    return {
      ...base,
      ok: gateUsable,
      status,
      benchmark: {
        provider: b.provider,
        source: evidence.source,
        symbol: b.symbol,
        bid: b.bid,
        ask: b.ask,
        midpoint: b.midpoint,
        currency: b.currency,
        sourceAsOf: b.sourceAsOf,
        fetchedAt: b.fetchedAt,
        timestampType: b.timestampType,
        cacheWindowMs: b.cacheWindowMs,
        isTradingHalt: b.isTradingHalt,
        sourceUrl: b.sourceUrl,
        priceBasis: b.priceBasis,
        multiplierCurrent: b.multiplierMetadata.currentMultiplier,
        multiplierAppliedToPrice: b.multiplierMetadata.appliedToPrice,
      },
      // Both limits are reported and explicitly distinguished, so no reader
      // can mistake the inherited 96h ceiling for the gate that was applied.
      freshness: {
        status: evidence.freshness,
        ageMs: evidence.ageMs,
        effectiveThresholdMs: effectiveMaxAgeMs,
        inheritedBenchmarkMaxAgeMs: EVIDENCE_INHERITED_BENCHMARK_MAX_AGE_MS,
        providerCacheWindowMs: EVIDENCE_EFFECTIVE_MAX_AGE_MS,
      },
      regime: regimeBlock,
      quant,
      gate: { usable: gateUsable, blockedReason: gateBlockedReason },
      executable: false,
      blockingReasons: [...blockingReasons, ...ALWAYS_BLOCKED],
      error: null,
      notes: [
        evidence.notes,
        `effectiveGateMs=${effectiveMaxAgeMs} (provider cache/freshness limit); ` +
          `inheritedBenchmarkMaxAgeMs=${EVIDENCE_INHERITED_BENCHMARK_MAX_AGE_MS} (NOT the operative gate)`,
      ],
    };
  } catch (err) {
    // Fail closed with the provider's own typed reason, never a blank panel.
    const code = err instanceof BenchmarkSourceError ? err.code : "UNEXPECTED";
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      ok: false,
      status: "error",
      benchmark: null,
      freshness: null,
      regime: regimeBlock,
      quant: null,
      gate: { usable: false, blockedReason: message },
      executable: false,
      blockingReasons: [`BENCHMARK_UNAVAILABLE: ${message}`, ...ALWAYS_BLOCKED],
      error: { code, message },
      notes: ["No benchmark was read. No Quant verdict was produced. Nothing was dispatched."],
    };
  }
}
