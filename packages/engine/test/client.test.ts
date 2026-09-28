import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BitgetClient } from "../src/bitget/client.js";

describe("BitgetClient", () => {
  it("constructs with explicit config", () => {
    const c = new BitgetClient({
      apiKey: "k",
      secretKey: "s",
      passphrase: "p",
    });
    assert.equal(c.baseUrl, "https://api.bitget.com");
  });

  it("adds the paptrading header only for Demo Trading auth", async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Headers | undefined;
    globalThis.fetch = async (_input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ code: "00000", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      const demo = new BitgetClient({
        apiKey: "k",
        secretKey: "s",
        passphrase: "p",
        demoTrading: true,
      });
      await demo.request("GET", "/api/v2/spot/account/assets", {}, true);
      assert.equal(capturedHeaders?.get("paptrading"), "1");

      const live = new BitgetClient({ apiKey: "k", secretKey: "s", passphrase: "p" });
      await live.request("GET", "/api/v2/spot/account/assets", {}, true);
      assert.equal(capturedHeaders?.get("paptrading"), null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
