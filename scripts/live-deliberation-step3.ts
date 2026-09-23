/**
 * Step 3 — Full live E2E council deliberation:
 * Live Qwen catalyst + Live Bitget market data + Risk interceptor + SHA-256 seal.
 * Run from repo root with the encrypted token (never paste plaintext):
 *   export BITGET_QWEN_API_KEY="$(openssl enc -d -aes-256-cbc -pbkdf2 -in .secrets/qwen38.enc -pass file:.secrets/qwen38.key)"
 *   pnpm exec tsx scripts/live-deliberation-step3.ts
 *   unset BITGET_QWEN_API_KEY
 */
import { BitgetClient } from "../packages/engine/src/bitget/client.js";
import { fetchCatalystProposal } from "../packages/engine/src/agents/macro.js";
import { executeDeliberationCycle } from "../packages/engine/src/council/adapter.js";
import { verifyReceipt } from "../packages/engine/src/council/receipts.js";

async function runLiveDeliberation() {
  console.log("=== RUNNING LIVE MONEY BOYS DELIBERATION COUNCIL ===");

  // 1. Warm Path: Real Qwen Catalyst Ingestion
  const headline = "NVIDIA wins major cloud infrastructure contract over the weekend.";
  const source = "https://reuters.com/markets/nvda-cloud-deal";
  console.log("[1] Querying Qwen via hackathon gateway...");
  const catalyst = await fetchCatalystProposal("rNVDAUSDT", headline, source);
  console.log(
    `[1] Ingested: ${catalyst.direction} (Score: ${catalyst.score}/100, conf: ${catalyst.confidence}, model: ${catalyst.modelId})`,
  );

  // 2. Fetch Live Bitget Reference Price (public market data, no keys)
  const client = new BitgetClient({ apiKey: "mock", secretKey: "mock", passphrase: "mock" });
  const ticker = await client.getTicker("BTCUSDT");
  const livePrice = parseFloat(ticker.lastPr);
  console.log(`[2] Live Bitget Benchmark Price: $${livePrice}`);
  if (!Number.isFinite(livePrice) || livePrice <= 0) throw new Error("live price parse failed");

  const mockDepth = {
    bids: [
      { price: livePrice * 0.9995, quantity: 2.5 },
      { price: livePrice * 0.999, quantity: 5.0 },
    ],
    asks: [
      { price: livePrice * 1.0005, quantity: 2.5 },
      { price: livePrice * 1.001, quantity: 5.0 },
    ],
  };

  const account = {
    equityUsd: 20000,
    usedMarginUsd: 1000,
    freeMarginUsd: 15000,
    openOrders: [],
  };

  // 3. Deliberation Across All 4 Personas
  console.log("[3] Deliberating across Council...");
  const orderSizeUsd = 3000;
  const tokenPrice = livePrice * 1.028;
  const quantity = orderSizeUsd / tokenPrice;
  const result = executeDeliberationCycle(catalyst, mockDepth, account, {
    symbol: "rNVDAUSDT",
    side: "buy",
    quantity,
    priceUsd: tokenPrice,
    tokenPrice,
    tradFiClosePrice: livePrice,
    orderSizeUsd,
    fundingRate8h: 0.0001,
    hoursToClose: 40,
  });

  console.log("\n=== COUNCIL VERDICT ===");
  console.log("Deliberation Status :", result.deliberation.status);
  console.log("Composite Score     :", result.deliberation.compositeScore.toFixed(2));
  console.log(
    "Passing Members     :",
    `${result.deliberation.quorum}/4 [${result.deliberation.passingMembers.join(", ")}]`,
  );
  console.log("Net Edge            :", result.quant.netEdgePct.toFixed(2) + "%");
  console.log(
    "Projected Margin    :",
    (result.risk.projectedMarginUtilization * 100).toFixed(2) + "%",
  );
  console.log("Receipt Hash        :", result.receipt.receiptHash);

  // 4. Verify Cryptographic Integrity
  const verified = verifyReceipt(result.receipt);
  console.log("Seal Verification   :", verified ? "VALID (SHA-256 MATCH)" : "FAILED");
  if (!verified) process.exit(1);
}

runLiveDeliberation().catch((e) => {
  console.error(e);
  process.exit(1);
});
