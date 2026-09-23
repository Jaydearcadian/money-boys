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
});
