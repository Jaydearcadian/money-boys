export interface CouncilScores {
  compositeScore: number;
  [member: string]: number;
}

export interface SealedReasoningReceipt {
  receiptId: string;
  sealedAt: string;
  receiptHash: string;
  symbol: string;
  action: string;
  quantMetrics: Record<string, unknown>;
  riskReport: Record<string, unknown>;
  councilScores: CouncilScores;
  decision: "APPROVED" | "VETOED";
  rationale: string;
  metadata?: { passNumber: number; originalQuantity: number; executedQuantity: number };
}

export interface DeskState {
  systemHalt: boolean;
  activeNodes: {
    macro: { status: string; model: string; latencyMs: number; lastCatalyst: string };
    quant: { status: string; latencyMs: number; lastNetEdgePct: number };
    risk: { status: string; marginUtilizationPct: number; hardVetoActive: boolean };
    exec: { status: string; venue: string; latencyMs: number };
  };
  account: { equityUsd: number; usedMarginUsd: number; freeMarginUsd: number; marginUtilPct: number };
  latestReceipt: SealedReasoningReceipt | null;
  recentCount: number;
}

/**
 * Phase 1 read-only benchmark evidence surface.
 *
 * Mirrors engine `EvidenceResponse`. `executable` is typed as the literal
 * `false` and `executionAuthority` as `"none"` on purpose: this type has no
 * variant in which the display surface could be read as an authorization
 * surface.
 */
export interface EvidenceResponse {
  ok: boolean;
  status: "ok" | "unusable" | "error";
  authority: "read_only";
  executionAuthority: "none";
  generatedAt: string;
  symbolMapping: { repoSymbol: string; venueSymbol: string; referenceSymbol: string; note: string };
  benchmark: {
    provider: string;
    source: string;
    symbol: string;
    bid: number;
    ask: number;
    midpoint: number;
    currency: string;
    sourceAsOf: string;
    /** Local request instant (= requestedAt). */
    fetchedAt: string;
    requestedAt: string;
    responseReceivedAt: string;
    timestampType: string;
    cacheWindowMs: number;
    isTradingHalt: boolean;
    sourceUrl: string;
    priceBasis: string;
    multiplierCurrent: string | null;
    multiplierAppliedToPrice: false;
  } | null;
  /**
   * Both freshness limits are carried explicitly so the UI cannot present the
   * inherited 96h ceiling as the gate that was actually applied.
   */
  freshness: {
    status: "verified_fresh" | "verified_stale" | "unverifiable";
    /** THE ADMISSION BASIS: sourceAsOf -> responseReceivedAt. */
    ageMs: number | null;
    ageAtReceiptMs: number | null;
    /** sourceAsOf -> requestedAt. Diagnostics only; gates nothing. */
    ageAtRequestStartMs: number | null;
    freshnessBasis: "receipt-relative";
    /** responseReceivedAt - requestedAt. */
    receiptLatencyMs: number | null;
    /** The gate that was applied. Provider cache/freshness limit. */
    effectiveThresholdMs: number;
    /** Inherited generic benchmark ceiling. NOT the operative gate. */
    inheritedBenchmarkMaxAgeMs: number;
    /** Provider's documented cache window. Equals the effective gate. */
    providerCacheWindowMs: number;
  } | null;
  regime: {
    regime: string;
    etNowIso: string;
    hoursToNextReopen: number;
    nextReopenAtIso: string | null;
    requiredBenchmarkSource: string;
    holidayCalendarSupported: false;
    limitation: string;
  };
  quant: {
    action: string;
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
  } | null;
  gate: {
    usable: boolean;
    blockedReason: string | null;
    /** Phase 1 Option 4: closed session is a hard veto on Quant. */
    closedSessionVeto: string | null;
    policy: string;
  };
  /** ELIGIBLE_FOR_DISPATCH_DESIGN is still NOT an authorization. */
  decision: "ELIGIBLE_FOR_DISPATCH_DESIGN" | "NO_TRADE";
  executable: false;
  blockingReasons: string[];
  bridge: { packetToDispatch: "absent" };
  error: { code: string; message: string } | null;
  notes: string[];
}

export interface SimulateParams {
  symbol?: string;
  side?: string;
  quantity?: number;
  priceUsd?: number;
}

export interface DeliberationOutput {
  receipt: SealedReasoningReceipt;
  deliberation?: unknown;
  passNumber?: number;
  executionQuantity?: number;
  executionExposureUsd?: number;
  executionRecord?: {
    orderId: string;
    clientOid: string;
    symbol: string;
    side: string;
    mode: string;
    quantity: number;
    fillPriceUsd: number;
    feeUsd: number;
    status: string;
    receiptHash: string;
    executedAt: string;
    latencyMs: number;
  };
  latencies?: Record<string, number>;
  [k: string]: unknown;
}

export const API_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env?.["VITE_API_BASE"] ?? "";


/**
 * Turn a mutating-endpoint refusal into an INSTRUCTION, not a bare status.
 *
 * Over the public tunnel every mutating route answers 403 until OPERATOR_TOKEN
 * is set on the engine. Surfacing that as raw "403 Forbidden" reads as a broken
 * site, when in fact it is a correctly-firing access control. The operator needs
 * to know the fix, and a visitor needs to know it is deliberate.
 */
export function describeOperatorRefusal(status: number, serverMessage?: string): string | null {
  if (status !== 401 && status !== 403) return null;
  if (serverMessage && /operator.token/i.test(serverMessage)) return serverMessage;
  return (
    "Operator token required. This action is a state mutation and is blocked on the public " +
    "tunnel by design. To run it: set OPERATOR_TOKEN on the engine process (pm2 restart " +
    "money-boys-engine), then reload. Read-only pages work without it."
  );
}

export async function fetchEvidence(symbol?: string): Promise<EvidenceResponse> {
  const qs = symbol ? "?symbol=" + encodeURIComponent(symbol) : "";
  const res = await fetch(API_BASE + "/api/desk/evidence" + qs);
  if (!res.ok) throw new Error("evidence " + res.status);
  return (await res.json()) as EvidenceResponse;
}

export async function fetchState(): Promise<DeskState> {
  const res = await fetch(API_BASE + "/api/desk/state");
  if (!res.ok) throw new Error("state " + res.status);
  return (await res.json()) as DeskState;
}

export async function fetchReceipts(): Promise<SealedReasoningReceipt[]> {
  try {
    const res = await fetch(API_BASE + "/api/desk/receipts");
    if (!res.ok) return [];
    const body = (await res.json()) as { receipts?: SealedReasoningReceipt[] };
    return Array.isArray(body.receipts) ? body.receipts : [];
  } catch {
    return [];
  }
}

export async function toggleHalt(current: boolean): Promise<{ systemHalt: boolean }> {
  const res = await fetch(API_BASE + "/api/desk/halt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemHalt: !current }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(describeOperatorRefusal(res.status, msg) ?? `halt ${res.status}`);
  }
  return (await res.json()) as { systemHalt: boolean };
}

export async function simulateCycle(params?: SimulateParams): Promise<DeliberationOutput> {
  const res = await fetch(API_BASE + "/api/desk/simulate-cycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: params ? JSON.stringify(params) : undefined,
  });
  const body = (await res.json()) as DeliberationOutput & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "simulate " + res.status);
  return body;
}

export function receiptVerdict(r: SealedReasoningReceipt | null): string {
  if (!r) return "\u2014";
  if (r.decision === "APPROVED") return "APPROVED";
  return "VETOED";
}
