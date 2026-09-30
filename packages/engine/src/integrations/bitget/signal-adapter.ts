// bitget-signal perception adapter -> Money Boys Macro Boy proposal.
//
// Read-only. Ingest catalysts, validate them strictly, bind provenance, and
// hand a validated catalyst bundle to the existing Macro Boy proposal path.
// No order authority (I-01): this file imports nothing from bitget/dispatcher
// and cannot construct a ReasoningReceipt.

import { z } from "zod";
import {
  ProvenanceSchema,
  sealProvenance,
  verifyProvenance,
  type Provenance,
} from "./contracts.js";
import { SignalBundleSchema, type SignalItem } from "./contracts.js";

/**
 * Upstream catalysts arrive untrusted. This mirrors the strictness of
 * `MacroCatalystProposalSchema` (.strict()): unknown fields are a rejection,
 * not a silently-dropped extra. Headlines are bounded so a hostile or
 * malfunctioning upstream cannot flood the receipt payload.
 */
export const RawCatalystSchema = z
  .object({
    headline: z.string().min(1).max(500),
    source: z.string().min(1).max(120),
    summary: z.string().max(1_000).optional(),
    publishedAt: z.string().datetime().optional(),
  })
  .strict();
export type RawCatalyst = z.infer<typeof RawCatalystSchema>;

export const RawCatalystArraySchema = z.array(RawCatalystSchema).max(20);
export type RawCatalystArray = z.infer<typeof RawCatalystArraySchema>;

/** Injectable so tests never touch the network. */
export type SignalFetch = (symbol: string) => Promise<unknown>;

export interface NormalizedSignals {
  symbol: string;
  items: SignalItem[];
  provenance: Provenance;
  /** Populated when the adapter failed closed. */
  degradedReason: string | null;
}

export const SIGNAL_ADAPTER_ID = "bitget-signal-perception";

function normalizeSymbol(symbol: string): string {
  const s = (symbol ?? "").trim();
  return s.length > 0 ? s.toUpperCase() : "UNKNOWN";
}

/**
 * Strictly validate an untrusted upstream payload.
 *
 * Returns an empty item list rather than throwing: a malformed provider must
 * degrade to "no catalysts", which Macro Boy treats as NEUTRAL. Throwing into
 * the council path would be a fail-open by omission.
 */
export function validateCatalysts(raw: unknown): { items: SignalItem[]; rejected: number } {
  const parsed = RawCatalystArraySchema.safeParse(raw);
  if (!parsed.success) return { items: [], rejected: 1 };
  return {
    items: parsed.data.map((c) => ({
      headline: c.headline,
      source: c.source,
      ...(c.summary !== undefined ? { summary: c.summary } : {}),
      ...(c.publishedAt !== undefined ? { publishedAt: c.publishedAt } : {}),
    })),
    rejected: 0,
  };
}

/**
 * Ingest catalysts from `fetchImpl`, validate, and seal provenance over the
 * accepted items.
 *
 * Provenance is computed over the VALIDATED items only — never over the raw
 * upstream response — so the hash attests to exactly what Macro Boy consumed.
 */
export async function ingestSignals(
  symbol: string,
  fetchImpl: SignalFetch,
  nowIso: string,
): Promise<NormalizedSignals> {
  const sym = normalizeSymbol(symbol);
  let raw: unknown;
  try {
    raw = await fetchImpl(sym);
  } catch {
    return {
      symbol: sym,
      items: [],
      provenance: sealProvenance(SIGNAL_ADAPTER_ID, [], nowIso),
      degradedReason: "provider unavailable: fail-closed to no catalysts",
    };
  }

  const { items, rejected } = validateCatalysts(raw);
  if (items.length === 0) {
    return {
      symbol: sym,
      items: [],
      provenance: sealProvenance(SIGNAL_ADAPTER_ID, [], nowIso),
      degradedReason:
        rejected > 0
          ? "provider payload failed strict validation: fail-closed to no catalysts"
          : "provider returned no catalysts",
    };
  }

  return {
    symbol: sym,
    items,
    provenance: sealProvenance(SIGNAL_ADAPTER_ID, items, nowIso),
    degradedReason: null,
  };
}

/**
 * Render validated signals as the compact news context Macro Boy already
 * consumes. Bounded so the LLM prompt cannot be blown out by upstream volume.
 */
export function toMacroNewsContext(items: SignalItem[], maxItems = 5): string {
  return items
    .slice(0, maxItems)
    .map((s) => `- ${s.headline} [${s.source}]`)
    .join("\n");
}

/** Guard for downstream consumers: refuse a bundle whose hash does not match. */
export function assertIntact(
  symbol: string,
  items: SignalItem[],
  provenance: Provenance,
): void {
  const bundle = SignalBundleSchema.parse({
    symbol: normalizeSymbol(symbol),
    items,
    provenance: ProvenanceSchema.parse(provenance),
  });
  if (!verifyProvenance(bundle.items, bundle.provenance)) {
    throw new Error("bitget-signal provenance mismatch: refusing unverified bundle");
  }
}
