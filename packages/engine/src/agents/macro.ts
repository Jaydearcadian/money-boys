import {
  MacroCatalystProposalSchema,
  type MacroCatalystProposal,
} from "../skills/noema-qa/schemas.js";
import { hashCatalystPayload } from "../skills/noema-qa/provenance.js";

/**
 * CLM-005 / GAP-005 — Macro Boy Catalyst Ingestion.
 *
 * Adapted from upstream noema (`/tmp/upstream/noema/packages/noema-ai/src/extract-claims.ts`):
 * upstream `extractClaims()` deterministically mines structured claims
 * (identity/CUSIP/ISIN/NAV/yield/issuer + regex text fallback) from source
 * snapshots + evidence refs. This port keeps that shape — strict-parse raw
 * model JSON into a proposal, regex-free — but swaps the substrate: instead
 * of local snapshots, the warm path proposes via the hackathon Qwen gateway
 * (`https://hackathon.bitgetops.com/v1`, OpenAI-compatible wire format,
 * model `qwen3.8-max`) over native `fetch`, then binds the result to a
 * SHA-256 `evidenceHash` (see `skills/noema-qa/provenance.ts`).
 *
 * Invariants (I-01, I-05):
 * - Macro Boy proposes ONLY. No order authority, no keys, no trades.
 * - Plain TypeScript + Zod + node:crypto/fetch. No LangChain/LangGraph/
 *   CrewAI/AutoGen, no external LLM frameworks.
 * - Fail-closed: missing API key, any network/parse error, or any schema
 *   violation → `fallbackToNeutral()` (direction NEUTRAL, score 0).
 *   `parseCatalystProposal()` itself THROWS on malformed input so callers
 *   can distinguish rejection from proposal; the async fetch entrypoint
 *   never throws (returns the NEUTRAL fallback).
 */

// ---------------------------------------------------------------------------
// Live gateway defaults (hackathon Qwen proxy, OpenAI-compatible).
// ---------------------------------------------------------------------------

export const QWEN_BASE_URL_DEFAULT = "https://hackathon.bitgetops.com/v1";
export const QWEN_MODEL_DEFAULT = "qwen3.8-max";

/** Spec-literal defaults (evaluated at import; prefer resolveQwenConfig() at call time). */
export const QWEN_BASE_URL =
  process.env["QWEN_BASE_URL"] || QWEN_BASE_URL_DEFAULT;

export const QWEN_MODEL =
  process.env["QWEN_MODEL"] || QWEN_MODEL_DEFAULT;

/** Call-time resolution so env mutation in tests / runtime overrides works. */
export function resolveQwenConfig(): { baseUrl: string; model: string; apiKey: string } {
  const baseUrl = (process.env["QWEN_BASE_URL"] || QWEN_BASE_URL_DEFAULT).replace(/\/$/, "");
  const model = process.env["QWEN_MODEL"] || QWEN_MODEL_DEFAULT;
  const apiKey =
    process.env["BITGET_QWEN_API_KEY"] ||
    process.env["DASHSCOPE_API_KEY"] ||
    "";
  return { baseUrl, model, apiKey };
}

// Legacy DashScope identifiers (kept for backward compat; warm path now
// targets the OpenAI-compatible gateway above).
export const DASHSCOPE_MODEL = "qwen-plus";
export const DASHSCOPE_ENDPOINT =
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text-generation/generation";

/** Fail-closed NEUTRAL proposal. Never throws. Always schema-valid. */
export function fallbackToNeutral(symbol: string, reason: string): MacroCatalystProposal {
  const sym = symbol && symbol.trim().length > 0 ? symbol : "UNKNOWN";
  const rationale = reason && reason.trim().length > 0 ? reason : "neutral fallback";
  return MacroCatalystProposalSchema.parse({
    symbol: sym,
    direction: "NEUTRAL",
    score: 0,
    confidence: 0,
    catalysts: [],
    evidenceHash: hashCatalystPayload({ symbol: sym, direction: "NEUTRAL", reason: rationale }),
    rationale,
    modelId: "fallback-neutral",
  });
}

/** Strip ```json fences / surrounding prose around the first {...} block. */
function extractJsonPayload(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const inner = (fenced?.[1] ?? text).trim();
  if (inner.startsWith("{")) return inner;
  const start = inner.indexOf("{");
  const end = inner.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return inner.slice(start, end + 1);
  return inner;
}

function coerceToProposalText(rawJson: unknown): string {
  if (typeof rawJson === "string") return rawJson;
  if (rawJson !== null && typeof rawJson === "object") {
    const obj = rawJson as Record<string, unknown>;
    // DashScope generation shapes: { output: { text } } and
    // { output: { choices: [{ message: { content } }] } }.
    const output = obj["output"];
    if (typeof output === "object" && output !== null) {
      const out = output as Record<string, unknown>;
      if (typeof out["text"] === "string") return out["text"] as string;
      const choices = out["choices"];
      if (Array.isArray(choices) && choices.length > 0) {
        const first = choices[0] as Record<string, unknown>;
        const message = first["message"] as Record<string, unknown> | undefined;
        const content = message?.["content"];
        if (typeof content === "string") return content;
      }
    }
    // OpenAI-compatible gateway shape: { choices: [{ message: { content } }] }.
    const choices = obj["choices"];
    if (Array.isArray(choices) && choices.length > 0) {
      const first = choices[0] as Record<string, unknown>;
      const message = first["message"] as Record<string, unknown> | undefined;
      const content = message?.["content"];
      if (typeof content === "string") return content;
      if (typeof first["text"] === "string") return first["text"] as string;
    }
    // Otherwise the object IS the proposal candidate.
    return JSON.stringify(obj);
  }
  throw new Error("catalyst parse rejected: unsupported payload type");
}

function clamp01(n: unknown, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(1, v));
}

/**
 * Normalize gateway payload variants into the noema-qa shield shape.
 * The gateway system prompt requests `catalysts: [{headline, impact}]`
 * while the shield schema requires
 * `[{title, detail, sentiment, confidence}]` — map headline→title,
 * impact→detail, defaulting sentiment to the proposal direction and
 * confidence to the proposal confidence. Also defaults a missing/empty
 * modelId so live responses always bind to a model identity.
 */
function normalizeProposalCandidate(
  candidate: Record<string, unknown>,
  fallbackSymbol: string,
  fallbackModelId: string,
  fallbackConfidence: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...candidate };
  if (typeof out["symbol"] !== "string" || (out["symbol"] as string).trim().length === 0) {
    out["symbol"] = fallbackSymbol;
  }
  if (typeof out["modelId"] !== "string" || (out["modelId"] as string).trim().length === 0) {
    out["modelId"] = fallbackModelId;
  }
  const direction =
    out["direction"] === "BULLISH" || out["direction"] === "BEARISH" || out["direction"] === "NEUTRAL"
      ? (out["direction"] as string)
      : "NEUTRAL";
  const parentConf = clamp01(out["confidence"], fallbackConfidence);
  if (Array.isArray(out["catalysts"])) {
    out["catalysts"] = (out["catalysts"] as unknown[]).map((item) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
      const c = item as Record<string, unknown>;
      // Already shield-shaped: pass through.
      if (typeof c["title"] === "string" && typeof c["detail"] === "string") return c;
      // Gateway-shaped {headline, impact} → shield shape.
      if (typeof c["headline"] === "string" || typeof c["impact"] === "string") {
        return {
          title: typeof c["headline"] === "string" && c["headline"].trim().length > 0
            ? c["headline"]
            : typeof c["title"] === "string" && (c["title"] as string).trim().length > 0
              ? c["title"]
              : "Live catalyst",
          detail: typeof c["impact"] === "string" && (c["impact"] as string).trim().length > 0
            ? c["impact"]
            : typeof c["detail"] === "string"
              ? c["detail"]
              : "Gateway catalyst impact",
          sentiment: c["sentiment"] === "BULLISH" || c["sentiment"] === "BEARISH" || c["sentiment"] === "NEUTRAL"
            ? c["sentiment"]
            : direction,
          confidence: clamp01(c["confidence"], parentConf),
        };
      }
      return c;
    });
  }
  return out;
}

/**
 * Strict-parse raw model output into a `MacroCatalystProposal`, bound to
 * `evidenceHash`. Throws on conversational noise, unformatted text, or any
 * schema violation (strict: unknown keys rejected). Callers that need a
 * non-throwing path use `fallbackToNeutral()` / `fetchCatalystProposal()`.
 */
export function parseCatalystProposal(
  rawJson: unknown,
  evidenceHash: string,
): MacroCatalystProposal {
  if (!/^[0-9a-f]{64}$/.test(evidenceHash)) {
    throw new Error("catalyst parse rejected: evidenceHash must be 64-char sha256 hex");
  }
  const text = coerceToProposalText(rawJson);
  let candidate: unknown;
  try {
    candidate = JSON.parse(extractJsonPayload(text));
  } catch {
    throw new Error("catalyst parse rejected: payload is not valid JSON");
  }
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("catalyst parse rejected: proposal must be a JSON object");
  }
  const normalized = normalizeProposalCandidate(
    candidate as Record<string, unknown>,
    "UNKNOWN",
    QWEN_MODEL_DEFAULT,
    0.5,
  );
  return MacroCatalystProposalSchema.parse({
    ...normalized,
    evidenceHash,
  });
}

function buildPrompt(symbol: string, context: string): { system: string; user: string } {
  const system =
    "You are Macro Boy, an institutional financial catalyst analyst. " +
    'Output ONLY valid JSON matching this schema: {"symbol": string, "direction": "BULLISH"|"BEARISH"|"NEUTRAL", ' +
    '"score": number (0-100), "confidence": number (0-1), ' +
    '"catalysts": [{"headline": string, "impact": string}], ' +
    '"rationale": string, "modelId": string}. No prose, no markdown fences.';
  const user = `Ticker: ${symbol}. Analyze this news: "${context}"`;
  return { system, user };
}

/** Resolve the overloaded 3rd/4th args: source-URL string and/or fetch impl. */
function resolveFetchArgs(
  sourceOrFetch?: string | typeof fetch,
  maybeFetch?: typeof fetch,
): { source: string; fetchImpl: typeof fetch } {
  let source = "";
  let fetchImpl: typeof fetch = fetch;
  if (typeof sourceOrFetch === "function") fetchImpl = sourceOrFetch;
  else if (typeof sourceOrFetch === "string") source = sourceOrFetch;
  if (typeof maybeFetch === "function") fetchImpl = maybeFetch;
  return { source, fetchImpl };
}

/**
 * Warm-path Qwen gateway catalyst fetch (OpenAI-compatible wire format).
 * NEVER throws: missing API key or any network/schema failure returns
 * `fallbackToNeutral()` (direction NEUTRAL, score 0).
 *
 * Signature: fetchCatalystProposal(symbol, rawNewsText?, sourceOrFetch?, fetchImpl?)
 * - `rawNewsText`: headline / news text to analyze.
 * - `sourceOrFetch`: evidence source URL string, or a fetch stub (tests).
 */
export async function fetchCatalystProposal(
  symbol: string,
  rawNewsText = "",
  sourceOrFetch?: string | typeof fetch,
  maybeFetch?: typeof fetch,
): Promise<MacroCatalystProposal> {
  const sym = symbol && symbol.trim().length > 0 ? symbol : "UNKNOWN";
  const { source, fetchImpl } = resolveFetchArgs(sourceOrFetch, maybeFetch);
  const news = rawNewsText ?? "";
  const contextForHash = source ? `${news}\nSource: ${source}` : news;
  const { baseUrl, model, apiKey } = resolveQwenConfig();
  if (!apiKey || apiKey.trim().length === 0) {
    return fallbackToNeutral(sym, "missing BITGET_QWEN_API_KEY/DASHSCOPE_API_KEY: fail-closed NEUTRAL");
  }
  const evidenceHash = hashCatalystPayload({ symbol: sym, context: contextForHash });
  try {
    const { system, user } = buildPrompt(sym, news);
    const userWithSource = source ? `${user}\nSource: ${source}` : user;
    const url = `${baseUrl}/chat/completions`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userWithSource },
        ],
        temperature: 0.1,
      }),
    });
    if (!res.ok) {
      return fallbackToNeutral(sym, `qwen gateway http ${res.status}: fail-closed NEUTRAL`);
    }
    const body: unknown = await res.json();
    const text = coerceToProposalText(body);
    let candidate: unknown;
    try {
      candidate = JSON.parse(extractJsonPayload(text));
    } catch {
      return fallbackToNeutral(sym, "qwen gateway non-JSON output: fail-closed NEUTRAL");
    }
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      return fallbackToNeutral(sym, "qwen gateway non-object output: fail-closed NEUTRAL");
    }
    try {
      const normalized = normalizeProposalCandidate(
        candidate as Record<string, unknown>,
        sym,
        model,
        0.5,
      );
      return MacroCatalystProposalSchema.parse({ ...normalized, evidenceHash });
    } catch {
      return fallbackToNeutral(sym, "qwen gateway schema violation: fail-closed NEUTRAL");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fallbackToNeutral(sym, `qwen gateway fetch failed (${msg}): fail-closed NEUTRAL`);
  }
}

export const MacroBoy = {
  parse: parseCatalystProposal,
  fallback: fallbackToNeutral,
  fetch: fetchCatalystProposal,
};
