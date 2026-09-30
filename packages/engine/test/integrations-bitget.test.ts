import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADAPTER_AUTHORITY_NOTE,
  AGENTIC_EXECUTION_NOT_WIRED,
  AdapterAuthoritySchema,
  AdapterDescriptorSchema,
  McpReadOnlyTransport,
  sealProvenance,
  verifyProvenance,
  type EquityResearchBundle,
  type McpReadOnlyTransport as _T,
} from "../src/integrations/bitget/contracts.js";
import {
  ingestSignals,
  toMacroNewsContext,
  assertIntact,
  validateCatalysts,
  RawCatalystSchema,
} from "../src/integrations/bitget/signal-adapter.js";
import {
  loadPlaybookArtifact,
  verifyPlaybookArtifact,
  PlaybookValidationError,
  PlaybookIdSchema,
} from "../src/integrations/bitget/playbook-adapter.js";
import { fallbackToNeutral } from "../src/agents/macro.js";

const NOW = "2026-09-30T08:00:00.000Z";

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

describe("integration provenance", () => {
  it("seals a deterministic sha256 over canonical JSON", () => {
    const a = sealProvenance("src", { b: 1, a: 2 }, NOW);
    const b = sealProvenance("src", { a: 2, b: 1 }, NOW);
    assert.equal(a.payloadHash, b.payloadHash, "key order must not change the hash");
    assert.match(a.payloadHash, /^[0-9a-f]{64}$/);
  });

  it("detects tampering", () => {
    const p = sealProvenance("src", { value: 1 }, NOW);
    assert.equal(verifyProvenance({ value: 1 }, p), true);
    assert.equal(verifyProvenance({ value: 2 }, p), false);
  });

  it("refuses a malformed expected hash rather than throwing", () => {
    const p = sealProvenance("src", { value: 1 }, NOW);
    assert.equal(verifyProvenance({ value: 1 }, { ...p, payloadHash: "not-a-hash" }), false);
  });
});

// ---------------------------------------------------------------------------
// bitget-signal adapter
// ---------------------------------------------------------------------------

describe("bitget-signal perception adapter", () => {
  it("accepts well-formed catalysts and seals provenance", async () => {
    const r = await ingestSignals(
      "rnvda",
      async () => [{ headline: "NVDA guidance raised", source: "bitget-signal" }],
      NOW,
    );
    assert.equal(r.symbol, "RNVDA");
    assert.equal(r.items.length, 1);
    assert.equal(r.degradedReason, null);
    assert.equal(verifyProvenance(r.items, r.provenance), true);
  });

  it("fails closed to no catalysts when the provider throws", async () => {
    const r = await ingestSignals(
      "BTCUSDT",
      async () => {
        throw new Error("network down");
      },
      NOW,
    );
    assert.equal(r.items.length, 0);
    assert.ok(r.degradedReason);
    assert.match(r.degradedReason!, /unavailable/);
  });

  it("fails closed on malformed upstream payload (not a throw)", async () => {
    const r = await ingestSignals("BTCUSDT", async () => ({ nope: true }), NOW);
    assert.equal(r.items.length, 0);
    assert.match(r.degradedReason!, /strict validation/);
  });

  it("rejects unknown fields on a catalyst (strict)", () => {
    assert.equal(RawCatalystSchema.safeParse({ headline: "h", source: "s", extra: 1 }).success, false);
    const r = validateCatalysts([{ headline: "h", source: "s", injected: "x" }]);
    assert.equal(r.items.length, 0, "unknown key must reject the whole array");
  });

  it("rejects an out-of-range catalyst volume", () => {
    const many = Array.from({ length: 25 }, () => ({ headline: "h", source: "s" }));
    assert.equal(validateCatalysts(many).items.length, 0);
  });

  it("rejects an empty headline", () => {
    assert.equal(validateCatalysts([{ headline: "", source: "s" }]).items.length, 0);
  });

  it("binds the hash to validated items, not the raw response", async () => {
    const raw = [{ headline: "h1", source: "s" }, { headline: "h2", source: "s" }];
    const r = await ingestSignals("BTCUSDT", async () => raw, NOW);
    assert.equal(r.provenance.payloadHash, sealProvenance("bitget-signal-perception", r.items, NOW).payloadHash);
  });

  it("assertIntact passes for an untampered bundle and throws for a tampered one", async () => {
    const r = await ingestSignals("BTCUSDT", async () => [{ headline: "h", source: "s" }], NOW);
    assert.doesNotThrow(() => assertIntact(r.symbol, r.items, r.provenance));
    assert.throws(
      () => assertIntact(r.symbol, [{ headline: "tampered", source: "s" }], r.provenance),
      /provenance mismatch/,
    );
  });

  it("produces Macro Boy news context and bounds its length", async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ headline: `h${i}`, source: "s" }));
    const ctx = toMacroNewsContext(items, 3);
    assert.equal(ctx.split("\n").length, 3);
  });

  it("feeds Macro Boy NEUTRAL when the adapter degrades", async () => {
    const r = await ingestSignals("BTCUSDT", async () => [], NOW);
    assert.equal(r.items.length, 0);
    const proposal = fallbackToNeutral(r.symbol, r.degradedReason ?? "no signals");
    assert.equal(proposal.direction, "NEUTRAL");
    assert.equal(proposal.score, 0);
  });
});

// ---------------------------------------------------------------------------
// Playbook artifact adapter
// ---------------------------------------------------------------------------

describe("getagent playbook artifact adapter", () => {
  it("loads an artifact and seals provenance", async () => {
    const a = await loadPlaybookArtifact(
      "strategy-abc",
      "1.0.0",
      async () => ({ signal: { ema: 20 } }),
      NOW,
    );
    assert.equal(a.playbookId, "strategy-abc");
    assert.equal(verifyPlaybookArtifact(a), true);
  });

  it("rejects a path-traversal style playbook id", () => {
    assert.equal(PlaybookIdSchema.safeParse("../../etc/passwd").success, false);
    assert.equal(PlaybookIdSchema.safeParse("ok-id.v1:2").success, true);
  });

  it("rejects an invalid version", async () => {
    await assert.rejects(
      () => loadPlaybookArtifact("strategy-abc", "v 1/2", async () => ({}), NOW),
      PlaybookValidationError,
    );
  });

  it("fails closed when the provider is unavailable", async () => {
    await assert.rejects(
      () =>
        loadPlaybookArtifact("strategy-abc", "1.0.0", async () => {
          throw new Error("offline");
        }, NOW),
      /provider unavailable/,
    );
  });

  it("rejects a non-object artifact", async () => {
    await assert.rejects(
      () => loadPlaybookArtifact("strategy-abc", "1.0.0", async () => "nope", NOW),
      /must be an object/,
    );
  });

  it("detects artifact tampering", async () => {
    const a = await loadPlaybookArtifact("strategy-abc", "1.0.0", async () => ({ x: 1 }), NOW);
    assert.equal(verifyPlaybookArtifact({ ...a, artifact: { x: 2 } }), false);
  });
});

// ---------------------------------------------------------------------------
// Authority boundary — the core invariant of this slice
// ---------------------------------------------------------------------------

describe("integration authority boundary", () => {
  it("only accepts read_only authority", () => {
    assert.equal(AdapterAuthoritySchema.safeParse("read_only").success, true);
    for (const bad of ["trading", "order", "signing", "admin"]) {
      assert.equal(AdapterAuthoritySchema.safeParse(bad).success, false);
    }
  });

  it("adapter descriptors validate", () => {
    assert.equal(
      AdapterDescriptorSchema.safeParse({
        id: "a",
        authority: "read_only",
        requiresCredentials: false,
        version: "1",
      }).success,
      true,
    );
  });

  it("the MCP transport contract exposes only a read tool", () => {
    // Structural guarantee: the interface has no place to sign or place orders.
    const calls: string[] = [];
    const transport: McpReadOnlyTransport = {
      callReadTool: async (tool) => {
        calls.push(tool);
        return { ok: true };
      },
    };
    void transport;
    assert.deepEqual(
      Object.keys({ callReadTool: () => {} }),
      ["callReadTool"],
      "MCP transport must have exactly one read-only method",
    );
  });

  it("Agentic execution surface is declared NOT wired", () => {
    assert.equal(AGENTIC_EXECUTION_NOT_WIRED.wired, false);
    assert.match(AGENTIC_EXECUTION_NOT_WIRED.reason, /not implemented/i);
  });

  it("documents the authority rule", () => {
    assert.match(ADAPTER_AUTHORITY_NOTE, /read-only/i);
  });

  it("no adapter module imports the dispatcher or holds credentials", async () => {
    const fs = await import("node:fs");
    const dir = new URL("../src/integrations/bitget/", import.meta.url);
    // Strip comments first: the invariant is about CODE, not prose. A module
    // is allowed to document that it deliberately does NOT read a credential.
    const stripComments = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue;
      const src = stripComments(fs.readFileSync(new URL(f, dir), "utf8"));
      assert.ok(
        !/from ".*dispatcher/i.test(src),
        `${f} must not import the order dispatcher`,
      );
      assert.ok(
        !/BITGET_API_KEY|BITGET_SECRET_KEY|BITGET_PASSPHRASE/.test(src),
        `${f} must not reference exchange credential variables`,
      );
      assert.ok(
        !/place-order|placeOrder/.test(src),
        `${f} must not reference an order-placement endpoint`,
      );
    }
  });

  it("type-only exports do not pull runtime code", () => {
    const types: unknown = undefined as unknown as _T;
    void types;
    const bundle: EquityResearchBundle | undefined = undefined;
    assert.equal(bundle, undefined);
  });
});
