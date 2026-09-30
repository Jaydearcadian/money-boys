// Bitget hackathon integration — external research adapter contracts.
//
// Money Boys is the canonical control plane. Every adapter in this directory is
// READ-ONLY research: it may ingest external perception, but it holds no order
// authority, no signing material, and no ability to mutate portfolio state.
//
// Invariants enforced here (see I-01..I-05):
//   I-01 no LLM/external order authority — no adapter can construct or send an
//        order. There is deliberately no method that accepts credentials.
//   I-02 Risk Boy HARD_VETO is never bypassed — adapters emit proposals only;
//        they do not call OrderDispatcher.
//   I-03 every ingested payload is bound to a SHA-256 provenance hash.
//   I-05 plain TypeScript + Zod + node:crypto/fetch. No LangChain/LangGraph/
//        CrewAI/AutoGen, no MCP client SDK inside the engine.
//
// Fail-closed contract: every adapter returns NEUTRAL on unavailable or
// malformed input, and attaches the reason. It never throws into the council
// path and never partially trusts an upstream payload.

import { z } from "zod";
import { hashCatalystPayload, verifyCatalystProvenance } from "../../skills/noema-qa/provenance.js";

/**
 * Provenance envelope attached to every external research payload.
 *
 * `payloadHash` is SHA-256 over the canonical JSON of `payload`, using the same
 * canonicalizer as the ReasoningReceipt sealer so a single hashing discipline
 * covers the whole engine.
 */
export const ProvenanceSchema = z.object({
  source: z.string().min(1),
  retrievedAt: z.string().datetime(),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export function sealProvenance(
  source: string,
  payload: unknown,
  retrievedAt: string,
): Provenance {
  return ProvenanceSchema.parse({
    source,
    retrievedAt,
    payloadHash: hashCatalystPayload(payload),
  });
}

/** Constant-time provenance check. Returns false rather than throwing. */
export function verifyProvenance(payload: unknown, prov: Provenance): boolean {
  return verifyCatalystProvenance(payload, prov.payloadHash);
}

// ---------------------------------------------------------------------------
// Adapter surface identity — every adapter declares its authority level.
// ---------------------------------------------------------------------------

/**
 * `read_only` is the only permitted value. It exists so a future adapter that
 * is NOT read-only fails to typecheck rather than shipping silently.
 */
export const AdapterAuthoritySchema = z.enum(["read_only"]);
export type AdapterAuthority = z.infer<typeof AdapterAuthoritySchema>;

/** Single source of truth for the authority rule, asserted by tests. */
export const ADAPTER_AUTHORITY_NOTE =
  "Adapters in this directory are read-only research surfaces. They ingest external " +
  "data, validate it, and bind provenance. They hold no order authority, no signing " +
  "material, and cannot mutate portfolio state.";

export const AdapterDescriptorSchema = z.object({
  id: z.string().min(1),
  authority: AdapterAuthoritySchema,
  /** True when the adapter can be called with no credentials at all. */
  requiresCredentials: z.boolean(),
  version: z.string().min(1),
});
export type AdapterDescriptor = z.infer<typeof AdapterDescriptorSchema>;

// ---------------------------------------------------------------------------
// bitget-signal: perception adapter (news / sentiment catalysts)
// ---------------------------------------------------------------------------

export const SignalItemSchema = z.object({
  headline: z.string().min(1),
  source: z.string().min(1),
  summary: z.string().optional(),
  publishedAt: z.string().datetime().optional(),
});
export type SignalItem = z.infer<typeof SignalItemSchema>;

export const SignalBundleSchema = z.object({
  symbol: z.string().min(1),
  items: z.array(SignalItemSchema),
  provenance: ProvenanceSchema,
});
export type SignalBundle = z.infer<typeof SignalBundleSchema>;

/**
 * The narrowest possible contract: a signal adapter returns validated
 * catalysts. It cannot place, modify, or cancel anything.
 */
export interface SignalResearchAdapter {
  readonly descriptor: AdapterDescriptor;
  fetchSignals(symbol: string): Promise<SignalBundle>;
}

// ---------------------------------------------------------------------------
// Bitget MCP (agent.bitget.com): US-equity research adapter
//
// Read-only by construction. The transport is injected so the engine never
// opens a socket to the MCP endpoint itself and never holds an MCP session.
// ---------------------------------------------------------------------------

export const EquityQuoteSchema = z.object({
  symbol: z.string().min(1),
  last: z.number().positive(),
  bid: z.number().positive().optional(),
  ask: z.number().positive().optional(),
  asOf: z.string().datetime().optional(),
});
export type EquityQuote = z.infer<typeof EquityQuoteSchema>;

export const EquityResearchBundleSchema = z.object({
  query: z.string().min(1),
  quotes: z.array(EquityQuoteSchema),
  provenance: ProvenanceSchema,
});
export type EquityResearchBundle = z.infer<typeof EquityResearchBundleSchema>;

export interface EquityResearchAdapter {
  readonly descriptor: AdapterDescriptor;
  fetchEquityResearch(query: string): Promise<EquityResearchBundle>;
}

/**
 * MCP transport contract.
 *
 * Deliberately one method, no session, no tool invocation beyond a documented
 * read tool. Any implementation that needs to sign or mutate cannot satisfy
 * this interface.
 */
export interface McpReadOnlyTransport {
  callReadTool(tool: string, args: Record<string, unknown>): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// GetAgent / Playbook: strategy artifact adapter
//
// Artifacts are inputs to Money Boys (research), never execution authority.
// A published Playbook is an artifact source; it does not trade the account.
// ---------------------------------------------------------------------------

/**
 * A published Playbook as a research artifact.
 *
 * `provenance` is part of the record, not recomputed on read — verification
 * compares the stored hash against the payload. Recomputing the "expected" hash
 * from the payload under test would make tampering undetectable.
 */
export const PlaybookArtifactSchema = z.object({
  playbookId: z.string().min(1),
  version: z.string().min(1),
  /** Verbatim artifact JSON as returned by GetAgent. Opaque to Money Boys. */
  artifact: z.unknown(),
  source: z.string().min(1),
  retrievedAt: z.string().datetime(),
  provenance: ProvenanceSchema,
});
export type PlaybookArtifact = z.infer<typeof PlaybookArtifactSchema>;

export interface PlaybookArtifactAdapter {
  readonly descriptor: AdapterDescriptor;
  fetchPlaybook(playbookId: string, version: string): Promise<PlaybookArtifact>;
}

// ---------------------------------------------------------------------------
// Agentic Account / OAuth execution surface — NOT WIRED
//
// Declared as a type only. There is deliberately no implementation, no token
// storage, and no route from here to OrderDispatcher. Execution remains behind
// the Money Boys dispatcher (receipt -> Risk Boy -> council -> dispatcher).
// ---------------------------------------------------------------------------

export const AGENTIC_EXECUTION_NOT_WIRED = {
  wired: false,
  reason:
    "Agentic/OAuth execution is not implemented. Execution authority stays with " +
    "OrderDispatcher behind receipt + risk gates. Adapters here are research-only.",
} as const;
