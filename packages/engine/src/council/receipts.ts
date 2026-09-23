import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * CLM-003 / GAP-003 — ReasoningReceipt SHA-256 Sealing.
 *
 * A receipt captures a council decision over a trade, incorporating the
 * output of the StructuralChangeGuard. `sealReceipt` binds the payload with
 * a SHA-256 hash over a deterministic canonical JSON encoding, and
 * `verifyReceipt` re-computes and compares in constant time.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Output of the StructuralChangeGuard consumed by the council. */
export const StructuralGuardOutputSchema = z.object({
  guardVersion: z.string().min(1),
  verdict: z.enum(["pass", "breach"]),
  structuralChangeDetected: z.boolean(),
  maxDrawdownBps: z.number().int().nonnegative(),
});

export type StructuralGuardOutput = z.infer<typeof StructuralGuardOutputSchema>;

/** Payload of a reasoning receipt BEFORE sealing (no id / timestamp / hash). */
export const UnsealedReceiptSchema = z.object({
  tradeId: z.string().min(1),
  decision: z.enum(["approved", "vetoed"]),
  projectedLiquidationPrice: z.number().finite(),
  netEdgePct: z.number().finite(),
  guard: StructuralGuardOutputSchema,
  rationale: z.string().min(1),
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
