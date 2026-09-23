import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { QuantActionSchema, QuantAnalysisResultSchema } from "../agents/quant.js";
import { BlastRadiusReportSchema } from "../skills/igraph-guard/security.js";

/**
 * CLM-003 / GAP-003 — ReasoningReceipt SHA-256 Sealing.
 * Pre-flight reconciliation: the receipt natively takes Quant Boy output
 * (`quantMetrics`) and the iGraph-aligned risk report (`riskReport` via
 * `BlastRadiusReportSchema`), plus council persona scores and the council
 * decision. `sealReceipt` binds the payload with a SHA-256 hash over a
 * deterministic canonical JSON encoding, and `verifyReceipt` re-computes
 * and compares in constant time.
 *
 * Upstream parity (pre-flight audit of /tmp/upstream):
 *  - iGraph `PactSigner`: canonical JSON (sort_keys, compact separators) +
 *    HMAC-SHA256 + `hmac.compare_digest`  <=>  `canonicalJson` + SHA-256 +
 *    `crypto.timingSafeEqual` here (receipts are self-sealed, hence plain
 *    SHA-256 instead of HMAC).
 *  - 0-infinity `queryString`: sorted keys + encodeURIComponent serialization,
 *    mirrored by the Bitget client's query serialization (venue headers
 *    remain Bitget v2 `ACCESS-*`; see `bitget/client.ts`).
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Council persona scores: individual 0–100 persona scores + compositeScore. */
export const CouncilScoresSchema = z
  .object({
    compositeScore: z.number().min(0).max(100),
  })
  .catchall(z.number().min(0).max(100));

export type CouncilScores = z.infer<typeof CouncilScoresSchema>;

export const ReceiptDecisionSchema = z.enum(["APPROVED", "VETOED"]);
export type ReceiptDecision = z.infer<typeof ReceiptDecisionSchema>;

/** Payload of a reasoning receipt BEFORE sealing (no id / timestamp / hash). */
export const ReceiptMetadataSchema = z.object({
  passNumber: z.union([z.literal(1), z.literal(2)]),
  originalQuantity: z.number().nonnegative(),
  executedQuantity: z.number().nonnegative(),
});
export type ReceiptMetadata = z.infer<typeof ReceiptMetadataSchema>;

export const UnsealedReceiptSchema = z.object({
  symbol: z.string().min(1),
  action: QuantActionSchema,
  quantMetrics: QuantAnalysisResultSchema,
  riskReport: BlastRadiusReportSchema,
  councilScores: CouncilScoresSchema,
  decision: ReceiptDecisionSchema,
  rationale: z.string().min(1),
  metadata: ReceiptMetadataSchema.optional(),
});

export type UnsealedReceipt = z.infer<typeof UnsealedReceiptSchema>;

/** A sealed receipt: unsealed payload + sealing metadata bound by receiptHash. */
export const SealedReasoningReceiptSchema = UnsealedReceiptSchema.extend({
  receiptId: z.string().uuid(),
  sealedAt: z.string().datetime({ offset: true }),
  receiptHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export type SealedReasoningReceipt = z.infer<typeof SealedReasoningReceiptSchema>;

// ---------------------------------------------------------------------------
// Deterministic canonical JSON
// ---------------------------------------------------------------------------

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function canonicalize(value: unknown): JsonValue {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value as JsonValue;
}

/**
 * Deterministic canonical JSON: object keys sorted lexicographically at
 * every depth, compact encoding (no spaces, no trailing whitespace).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** SHA-256 hex digest of the canonical JSON encoding of `payload`. */
export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Seal / verify
// ---------------------------------------------------------------------------

const SEAL_META_KEYS = new Set(["receiptId", "sealedAt", "receiptHash"]);

function stripSealMeta(receipt: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(receipt)) {
    if (!SEAL_META_KEYS.has(k)) payload[k] = v;
  }
  return payload;
}

/**
 * Seal an unsealed receipt payload. Validates the input, then binds it with
 * a fresh receiptId, ISO-8601 sealedAt timestamp, and the SHA-256 receiptHash
 * computed over the canonical JSON of the validated payload only.
 */
export function sealReceipt(data: unknown): SealedReasoningReceipt {
  const payload = UnsealedReceiptSchema.parse(data);
  const receiptHash = hashPayload(payload);
  return {
    ...payload,
    receiptId: randomUUID(),
    sealedAt: new Date().toISOString(),
    receiptHash,
  };
}

/**
 * Cryptographically verify a sealed receipt:
 *  1. Validate shape via Zod (rejects malformed / mistyped receipts).
 *  2. Recompute the SHA-256 hash over the canonical JSON of the payload
 *     (all fields except receiptId / sealedAt / receiptHash).
 *  3. Compare digests with `crypto.timingSafeEqual` (constant-time).
 *
 * Returns false for any tampering, malformed input, or hash mismatch —
 * never throws on untrusted input.
 */
export function verifyReceipt(receipt: unknown): boolean {
  const parsed = SealedReasoningReceiptSchema.safeParse(receipt);
  if (!parsed.success) return false;
  const { receiptHash } = parsed.data;
  const payload = stripSealMeta(parsed.data as unknown as Record<string, unknown>);
  const recomputed = hashPayload(payload);
  const a = Buffer.from(receiptHash, "utf8");
  const b = Buffer.from(recomputed, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
