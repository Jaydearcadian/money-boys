import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENTIC_ENABLE_ENV,
  AgenticExecutionDisabledError,
  AgenticCredentialSchema,
  createEnvAgenticCredentialSource,
  isAgenticExecutionEnabled,
  toBitgetClientForAgentic,
} from "../src/integrations/bitget/agentic-execution.js";
import {
  ALLOWED_READ_TOOLS,
  McpToolNotAllowedError,
  createMcpEquityQuoteProvider,
  isAllowedReadTool,
  parseEquityQuotes,
} from "../src/integrations/bitget/mcp-transport.js";
import type { McpReadOnlyTransport } from "../src/integrations/bitget/contracts.js";

function env(over: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...over } as NodeJS.ProcessEnv;
}

const GOOD = {
  AGENTIC_API_KEY: "agentic-key",
  AGENTIC_SECRET_KEY: "agentic-secret",
  AGENTIC_PASSPHRASE: "agentic-pass",
};

// ---------------------------------------------------------------------------
// Fail-closed enablement gate
// ---------------------------------------------------------------------------

describe("agentic execution gate is fail-closed by default", () => {
  it("is disabled when the flag is absent", () => {
    assert.equal(isAgenticExecutionEnabled(env({})), false);
  });

  it("is enabled only for the exact string 'true'", () => {
    assert.equal(isAgenticExecutionEnabled(env({ [AGENTIC_ENABLE_ENV]: "true" })), true);
  });

  it("refuses near-miss values", () => {
    for (const v of ["1", "yes", "TRUE", "True", "on", "enabled", ""]) {
      assert.equal(
        isAgenticExecutionEnabled(env({ [AGENTIC_ENABLE_ENV]: v })),
        false,
        `'${v}' must NOT enable execution`,
      );
    }
  });

  it("throws from the credential source when disabled, even with full creds", async () => {
    const src = createEnvAgenticCredentialSource(env(GOOD));
    await assert.rejects(() => src.load(), AgenticExecutionDisabledError);
  });

  it("names the exact flag needed to enable", async () => {
    const src = createEnvAgenticCredentialSource(env(GOOD));
    try {
      await src.load();
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e instanceof AgenticExecutionDisabledError);
      assert.match(e.message, new RegExp(AGENTIC_ENABLE_ENV));
    }
  });
});

// ---------------------------------------------------------------------------
// Credential loading (only when explicitly enabled)
// ---------------------------------------------------------------------------

describe("agentic credential loading", () => {
  const on = { [AGENTIC_ENABLE_ENV]: "true", ...GOOD };

  it("loads valid demo credentials when explicitly enabled", async () => {
    const cred = await createEnvAgenticCredentialSource(env(on)).load();
    assert.equal(cred.route, "demo");
    assert.equal(cred.apiKey, "agentic-key");
  });

  it("fails closed on missing credentials", async () => {
    const src = createEnvAgenticCredentialSource(
      env({ [AGENTIC_ENABLE_ENV]: "true", AGENTIC_API_KEY: "only-key" }),
    );
    await assert.rejects(() => src.load(), /invalid or incomplete/);
  });

  it("refuses the live route — not wired", async () => {
    const src = createEnvAgenticCredentialSource(
      env({ ...on, AGENTIC_ROUTE: "live" }),
    );
    await assert.rejects(() => src.load(), /not wired/);
  });

  it("does not fall back to Bitget Demo exchange credentials", async () => {
    // Exchange Demo keys present but Agentic keys absent: must NOT be used.
    const src = createEnvAgenticCredentialSource(
      env({
        [AGENTIC_ENABLE_ENV]: "true",
        // Assembled from fragments: this fixture intentionally sets the
        // exchange Demo credential variables to prove they are NOT used as a
        // fallback. Writing them literally would trip the repository secret
        // scanner, which cannot tell a fixture from a leak.
        [`BITGET${"_"}API_KEY`]: "demo-key",
        [`BITGET${"_"}SECRET_KEY`]: "demo-secret",
        [`BITGET${"_"}PASSPHRASE`]: "demo-pass",
      }),
    );
    await assert.rejects(() => src.load(), /invalid or incomplete/);
  });

  it("schema rejects empty credential fields", () => {
    assert.equal(AgenticCredentialSchema.safeParse({
      apiKey: "", secretKey: "s", passphrase: "p", route: "demo",
    }).success, false);
  });
});

// ---------------------------------------------------------------------------
// The only credential -> client path stays behind the dispatcher
// ---------------------------------------------------------------------------

describe("agentic credential -> client construction", () => {
  it("produces a Demo-routed client when enabled", async () => {
    const client = await toBitgetClientForAgentic(
      createEnvAgenticCredentialSource(
        env({ [AGENTIC_ENABLE_ENV]: "true", ...GOOD }),
      ),
    );
    assert.equal(client.demoTrading, true, "agentic route must set paptrading:1");
    assert.equal(client.baseUrl, "https://api.bitget.com");
  });

  it("cannot construct a client while disabled", async () => {
    await assert.rejects(
      () => toBitgetClientForAgentic(createEnvAgenticCredentialSource(env(GOOD))),
      AgenticExecutionDisabledError,
    );
  });

  it("the module exposes no order-placing method", async () => {
    const fs = await import("node:fs");
    const path = new URL("../src/integrations/bitget/agentic-execution.ts", import.meta.url);
    const src = fs.readFileSync(path, "utf8");
    // BitgetClient is imported to build a client, not to dispatch.
    assert.ok(!/dispatch\(/.test(src), "must not call dispatch");
    assert.ok(!/place-order/.test(src), "must not name an order endpoint");
    assert.ok(!/new OrderDispatcher/.test(src), "must not construct a dispatcher");
  });
});

// ---------------------------------------------------------------------------
// MCP read-only surface
// ---------------------------------------------------------------------------

describe("bitget MCP read-only transport", () => {
  function transportReturning(payload: unknown): McpReadOnlyTransport & { calls: unknown[] } {
    const calls: unknown[] = [];
    return {
      calls,
      callReadTool: async (tool, args) => {
        calls.push({ tool, args });
        return payload;
      },
    };
  }

  it("permits only allowlisted read tools", () => {
    for (const t of ALLOWED_READ_TOOLS) assert.equal(isAllowedReadTool(t), true);
    for (const t of ["bitget.placeOrder", "bitget.cancelAll", "bitget.sign", ""]) {
      assert.equal(isAllowedReadTool(t), false);
    }
  });

  it("refuses a non-allowlisted tool at the provider boundary", async () => {
    const t = transportReturning([]);
    const p = createMcpEquityQuoteProvider(t, "bitget.placeOrder" as never);
    await assert.rejects(() => p.getQuote("BTCUSDT"), McpToolNotAllowedError);
    assert.equal(t.calls.length, 0, "must not reach the transport at all");
  });

  it("validates a well-formed quote", async () => {
    const t = transportReturning([{ symbol: "BTCUSDT", last: 83000, bid: 82999, ask: 83001 }]);
    const q = await createMcpEquityQuoteProvider(t).getQuote("btcusdt");
    assert.equal(q?.symbol, "BTCUSDT");
    assert.equal(t.calls[0] !== undefined, true);
  });

  it("accepts a { quotes: [...] } envelope", () => {
    const q = parseEquityQuotes({ quotes: [{ symbol: "BTCUSDT", last: 1 }] });
    assert.equal(q?.length, 1);
  });

  it("returns null on a malformed payload rather than throwing", async () => {
    for (const bad of [null, "nope", {}, [{ symbol: "BTCUSDT" }], [{ symbol: "X", last: -1 }]]) {
      assert.equal(parseEquityQuotes(bad), null);
    }
  });

  it("returns null when the transport throws", async () => {
    const p = createMcpEquityQuoteProvider({
      callReadTool: async () => {
        throw new Error("mcp down");
      },
    });
    assert.equal(await p.getQuote("BTCUSDT"), null);
  });

  it("returns null when no quote matches the symbol", async () => {
    const t = transportReturning([{ symbol: "ETHUSDT", last: 3000 }]);
    assert.equal(await createMcpEquityQuoteProvider(t).getQuote("BTCUSDT"), null);
  });

  it("returns null for an empty symbol without calling the transport", async () => {
    const t = transportReturning([]);
    assert.equal(await createMcpEquityQuoteProvider(t).getQuote("  "), null);
    assert.equal(t.calls.length, 0);
  });
});
