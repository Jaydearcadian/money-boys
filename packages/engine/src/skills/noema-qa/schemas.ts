import { z } from "zod";

/**
 * CLM-005 / GAP-005 — Cognitive Shield noema-qa schemas.
 *
 * Adapted from upstream noema (`/tmp/upstream/noema/packages/noema-ai/src/schemas.ts`):
 * upstream defines `proposedClaimSchema` / `noemaAiProposalSchema` (identity,
 * rights, restrictions, relationships, conflicts + `0x`-prefixed keccak
 * `proposalHash`). This port narrows that surface to the Money Boys warm-path
 * need: a single Macro Boy catalyst proposal per symbol, with strict Zod
 * (`.strict()`) so conversational noise / extra keys are rejected and the
 * agent fails closed to NEUTRAL (I-01: Macro Boy proposes only).
 *
 * Differences from upstream (deliberate):
 * - Digest is plain SHA-256 hex (node:crypto, 64 chars, no `0x` prefix) to
 *   match the engine's ReasoningReceipt sealing (`council/receipts.ts`),
 *   not upstream keccak `0x…` (`HASHING_SPEC.md`, `canonicalization/`).
 * - Single `MacroCatalystProposalSchema` instead of the full claim/right/
 *   restriction graph — warm path is proposal-only, never order authority.
 */

export const CatalystDirectionSchema = z.enum(["BULLISH", "BEARISH", "NEUTRAL"]);
export type CatalystDirection = z.infer<typeof CatalystDirectionSchema>;

export const MacroCatalystItemSchema = z
  .object({
    title: z.string().min(1),
    detail: z.string().min(1),
    sentiment: CatalystDirectionSchema,
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type MacroCatalystItem = z.infer<typeof MacroCatalystItemSchema>;

/**
 * Warm-path macro catalyst proposal. Strict: unknown keys rejected.
 * - `score` is 0–100 (0 on NEUTRAL fallback).
 * - `confidence` is 0–1.
 * - `evidenceHash` binds the source payload (see `provenance.ts`).
 */
export const MacroCatalystProposalSchema = z
  .object({
    symbol: z.string().min(1),
    direction: CatalystDirectionSchema,
    score: z.number().min(0).max(100),
    confidence: z.number().min(0).max(1),
    catalysts: z.array(MacroCatalystItemSchema).max(10).default([]),
    evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
    rationale: z.string().min(1),
    modelId: z.string().min(1),
  })
  .strict();
export type MacroCatalystProposal = z.infer<typeof MacroCatalystProposalSchema>;
