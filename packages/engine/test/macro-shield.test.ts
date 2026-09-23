import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MacroCatalystProposalSchema,
} from "../src/skills/noema-qa/schemas.js";
import { hashCatalystPayload } from "../src/skills/noema-qa/provenance.js";
import {
  fallbackToNeutral,
  fetchCatalystProposal,
  parseCatalystProposal,
} from "../src/agents/macro.js";

/**
 * CLM-005 / GAP-005 — Cognitive Shield (noema-qa) + Macro Boy ingestion.
 * 4 invariant tests: strict parse, noise rejection, provenance binding,
 * fail-closed fetch. No network in tests (fetch is stubbed / key unset).
 */

function validProposal(evidenceHash: string) {
  return {
    symbol: "BTCUSDT",
    direction: "BULLISH",
    score: 72,
    confidence: 0.81,
    catalysts: [
      {
        title: "ETF inflow streak",
        detail: "Spot ETF net inflows for 5 consecutive sessions",
        sentiment: "BULLISH",
        confidence: 0.8,
      },
    ],
    evidenceHash,
    rationale: "Sustained inflows + dovish FOMC minutes support upside into the weekend.",
    modelId: "qwen-plus",
  };
}

describe("Macro cognitive shield (CLM-005 / GAP-005)", () => {
  it("T1 Valid catalyst output parses and matches schema", () => {
    const evidenceHash = hashCatalystPayload({ symbol: "BTCUSDT", context: "etf inflows" });
    const parsed = parseCatalystProposal(validProposal(evidenceHash), evidenceHash);
    assert.equal(parsed.symbol, "BTCUSDT");
    assert.equal(parsed.direction, "BULLISH");
    assert.equal(parsed.evidenceHash, evidenceHash);
    // Strict schema round-trips the parsed value unchanged.
    assert.deepEqual(MacroCatalystProposalSchema.parse(parsed), parsed);
  });

  it("T2 Conversational noise / unformatted text rejected; fails closed to NEUTRAL", () => {
    const evidenceHash = hashCatalystPayload({ symbol: "BTCUSDT", context: "noise" });
    assert.throws(
      () =>
        parseCatalystProposal(
          "Hey, BTC looks kinda bullish today! Momentum feels strong, maybe buy the rip?",
          evidenceHash,
        ),
      /catalyst parse rejected/,
    );
    const fallback = fallbackToNeutral("BTCUSDT", "conversational noise rejected");
    assert.equal(fallback.direction, "NEUTRAL");
    assert.equal(fallback.score, 0);
    assert.deepEqual(MacroCatalystProposalSchema.parse(fallback), fallback);
  });

  it("T3 Provenance hash is deterministic and tamper-sensitive", () => {
    const payload = { symbol: "BTCUSDT", context: "fomc minutes" };
    const h1 = hashCatalystPayload(payload);
    const h2 = hashCatalystPayload({ context: "fomc minutes", symbol: "BTCUSDT" });
    assert.match(h1, /^[0-9a-f]{64}$/);
    assert.equal(h1, h2);
    const tampered = hashCatalystPayload({ symbol: "BTCUSDT", context: "fomc minutes (edited)" });
    assert.notEqual(tampered, h1);
  });

  it("T4 Missing API key / fetch error triggers clean NEUTRAL fallback", async () => {
    const saved = process.env["DASHSCOPE_API_KEY"];
    try {
      delete process.env["DASHSCOPE_API_KEY"];
      const noKey = await fetchCatalystProposal("BTCUSDT", "etf inflows");
      assert.equal(noKey.direction, "NEUTRAL");
      assert.equal(noKey.score, 0);

      process.env["DASHSCOPE_API_KEY"] = "test-key";
      const boom: typeof fetch = async () => {
        throw new Error("network down");
      };
      const netFail = await fetchCatalystProposal("BTCUSDT", "etf inflows", boom);
      assert.equal(netFail.direction, "NEUTRAL");
      assert.equal(netFail.score, 0);
    } finally {
      if (saved === undefined) delete process.env["DASHSCOPE_API_KEY"];
      else process.env["DASHSCOPE_API_KEY"] = saved;
    }
  });
});
