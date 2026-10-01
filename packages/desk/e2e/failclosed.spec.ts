import { expect, test } from "@playwright/test";
import { gotoEvidence, stubEvidence } from "./helpers";

/**
 * Fail-closed paths. A blocked or unavailable benchmark must produce a VISIBLE
 * reason and NO Quant numbers — never a blank panel, never a NEUTRAL verdict
 * with figures attached, and never anything that looks actionable.
 */
test.describe("benchmark evidence — stale benchmark blocks the gate", () => {
  test.beforeEach(async ({ page }) => { await stubEvidence(page, "stale"); });

  test("shows the unusable status and the gate's own reason", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("evidence-status")).toHaveText("unusable");
    // The reason must name the actual failure: freshness could not be proven.
    await expect(page.getByTestId("blocking-reasons")).toContainText("freshness cannot be established");
    await expect(page.getByTestId("blocking-reasons")).toContainText("verified_stale");
  });

  test("still shows the age it measured, so the rejection is auditable", async ({ page }) => {
    await gotoEvidence(page);
    // A rejected quote must still report its age, otherwise an operator cannot
    // tell a 16-second miss from a 9-day one.
    const age = page.getByTestId("freshness-age");
    await expect(age).not.toHaveText("—");
    await expect(age).toContainText("h");
  });

  test("marks the freshness as not fresh, judged against the 15s gate", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("freshness-status")).toHaveText("verified_stale");
    // The gate that produced this verdict is 15s, not the inherited 96h.
    await expect(page.getByTestId("freshness-effective-threshold")).toHaveText("15.00s");
  });

  test("runs no Quant and shows no numbers at all", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("quant-evaluated")).toHaveText("no");
    await expect(page.getByTestId("quant-null")).toBeVisible();
    // The absence must be explicit: no verdict field is rendered with a value.
    await expect(page.getByTestId("quant-action")).toHaveCount(0);
    await expect(page.getByTestId("net-edge")).toHaveCount(0);
    await expect(page.getByTestId("basis")).toHaveCount(0);
  });

  test("still shows the provenance it did read, so the failure is diagnosable", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("source-asof")).toContainText("2026-09-21");
    await expect(page.getByTestId("freshness-age")).not.toHaveText("—");
  });

  test("remains non-executable", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("executable-state")).toHaveText("executable: false");
    await expect(page.getByTestId("authority-label")).toContainText("no execution authority");
  });
});

test.describe("benchmark evidence — provider read failure", () => {
  test("surfaces a typed provider failure and no benchmark", async ({ page }) => {
    await stubEvidence(page, "error");
    await gotoEvidence(page);
    await expect(page.getByTestId("evidence-status")).toHaveText("error");
    await expect(page.getByTestId("evidence-error")).toContainText("HTTP");
    await expect(page.getByTestId("blocking-reasons")).toContainText("BENCHMARK_UNAVAILABLE");
  });

  test("shows no quote and no verdict when the provider fails", async ({ page }) => {
    await stubEvidence(page, "error");
    await gotoEvidence(page);
    await expect(page.getByTestId("midpoint")).toHaveText("—");
    await expect(page.getByTestId("quant-evaluated")).toHaveText("no");
    await expect(page.getByTestId("quant-action")).toHaveCount(0);
  });

  test("surfaces a trading halt as a typed failure, not a usable quote", async ({ page }) => {
    await stubEvidence(page, "halted");
    await gotoEvidence(page);
    await expect(page.getByTestId("evidence-status")).toHaveText("error");
    await expect(page.getByTestId("evidence-error")).toContainText("TRADING_HALT");
  });
});

test.describe("benchmark evidence — engine unreachable", () => {
  test("shows an error state instead of a blank page", async ({ page }) => {
    const { stubEvidenceNetworkError } = await import("./helpers");
    await stubEvidenceNetworkError(page);
    await gotoEvidence(page);
    await expect(page.getByTestId("evidence-transport-error")).toBeVisible();
    await expect(page.getByTestId("evidence-transport-error")).toContainText("Engine unreachable");
    await expect(page.getByTestId("authority-label")).toBeVisible();
  });
});
