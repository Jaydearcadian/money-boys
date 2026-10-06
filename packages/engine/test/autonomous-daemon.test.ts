import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AutonomousDeskDaemon } from "../src/autonomous/daemon.js";
import { state, snapshot } from "../src/server-state.js";
import { verifyReceipt } from "../src/council/receipts.js";

const mockFetch: typeof fetch = async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/rhj/prices/")) {
    return new Response(
      JSON.stringify({
        symbol: "NVDA",
        bid: "240.10",
        ask: "240.20",
        currency: "USD",
        generatedAt: new Date().toISOString(),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
};

describe("AutonomousDeskDaemon", () => {
  it("runs a single paper cycle and seals a valid ReasoningReceipt", async () => {
    const daemon = new AutonomousDeskDaemon({
      mode: "PAPER",
      symbol: "rNVDAUSDT",
      targetNotionalUsd: 25,
      intervalMs: 1000,
      maxCycles: 1,
      fetchImpl: mockFetch,
    });

    const report = await daemon.runSingleCycle();

    assert.equal(report.cycleNumber, 1);
    assert.equal(report.symbol, "rNVDAUSDT");
    assert.equal(report.mode, "PAPER");
    assert.equal(report.accountFlat, true);
    assert.ok(report.receiptHash.length === 64, "receiptHash must be 64-char sha256 hex");

    // Check server state updated
    const snap = snapshot();
    assert.ok(snap.latestReceipt !== null);
    assert.equal(snap.latestReceipt.receiptHash, report.receiptHash);
    assert.equal(verifyReceipt(snap.latestReceipt), true);
  });

  it("completes configured multi-cycle loop without unhandled exceptions", async () => {
    const daemon = new AutonomousDeskDaemon({
      mode: "PAPER",
      symbol: "rNVDAUSDT",
      intervalMs: 10,
      maxCycles: 3,
      fetchImpl: mockFetch,
    });

    const reports: number[] = [];
    daemon.onCycle((r) => reports.push(r.cycleNumber));

    await daemon.start();

    // Wait until completed
    while (reports.length < 3) {
      await new Promise((r) => setTimeout(r, 20));
    }

    assert.equal(daemon.cyclesCompleted, 3);
    assert.deepEqual(reports, [1, 2, 3]);
  });

  it("respects system emergency halt and skips execution", async () => {
    state.systemHalt = true;
    try {
      const daemon = new AutonomousDeskDaemon({
        mode: "PAPER",
        symbol: "rNVDAUSDT",
        maxCycles: 1,
      });

      const report = await daemon.runSingleCycle();
      assert.equal(report.regime, "HALTED");
      assert.equal(report.decision, "VETOED");
      assert.equal(report.dispatched, false);
      assert.ok(report.notes?.includes("emergency halt"));
    } finally {
      state.systemHalt = false;
    }
  });

  it("ensures stop() flattens and resets running status", async () => {
    const daemon = new AutonomousDeskDaemon({
      mode: "PAPER",
      symbol: "rNVDAUSDT",
      intervalMs: 50,
      maxCycles: 10,
    });

    await daemon.start();
    assert.equal(daemon.running, true);

    await daemon.stop();
    assert.equal(daemon.running, false);
  });
});
