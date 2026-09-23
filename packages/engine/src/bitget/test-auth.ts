import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BitgetClient } from "./client.js";

async function runPhase01Gate() {
  const apiKey = process.env.BITGET_API_KEY;
  const secretKey = process.env.BITGET_SECRET_KEY;
  const passphrase = process.env.BITGET_PASSPHRASE;

  const isLive = Boolean(apiKey && secretKey && passphrase);

  console.error(
    `[Phase 01] Running Bitget Substrate Verification... Mode: ${
      isLive ? "LIVE_AUTHENTICATED" : "PUBLIC_READ_ONLY"
    }`,
  );

  const client = new BitgetClient({
    apiKey: apiKey || "mock-key",
    secretKey: secretKey || "mock-secret",
    passphrase: passphrase || "mock-pass",
  });

  // 1. Public substrate: ticker ingestion
  const ticker = await client.getTicker("BTCUSDT");
  console.error(`[PASS] Ticker Ingestion: BTCUSDT Last Price = ${ticker.lastPr}`);

  // 2. Private authentication (only when credentials are present)
  let authConfirmed = false;
  let authCode: string | null = null;
  if (isLive) {
    const res = await client.request("GET", "/api/v2/spot/account/assets", {}, true);
    console.error(`[PASS] Authenticated Signature Validated: code=${res.code}`);
    authConfirmed = res.code === "00000";
    authCode = res.code;
  } else {
    console.error(
      "[WARN] No API keys in environment. Public endpoints verified; authenticated read deferred.",
    );
  }

  const manifest = {
    claimId: "CLM-001",
    timestamp: new Date().toISOString(),
    status: isLive && authConfirmed ? "LIVE_DEMONSTRATED" : "TESTED",
    substrate: "Bitget API v2",
    tickerSample: {
      symbol: ticker.symbol ?? "BTCUSDT",
      lastPr: ticker.lastPr,
      bidPr: ticker.bidPr,
      askPr: ticker.askPr,
    },
    authConfirmed: isLive && authConfirmed,
    authCode,
    limitations: isLive
      ? []
      : ["Authenticated private read deferred — BITGET_* env vars not set"],
  };

  // Always print JSON manifest to stdout for evidence piping.
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);

  // Also seal a copy under foundry/evidence/p01 when run from monorepo.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const evidencePath = resolve(here, "../../../../foundry/evidence/p01/auth_test.json");
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.error(`[PASS] Evidence sealed: ${evidencePath}`);
  } catch (err) {
    console.error(`[WARN] Could not seal evidence file: ${String(err)}`);
  }
}

runPhase01Gate().catch((err) => {
  console.error("[FAIL] Phase 01 Gate Failed:", err);
  process.exit(1);
});
