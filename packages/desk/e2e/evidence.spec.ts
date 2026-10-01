import { expect, test } from "@playwright/test";
import { gotoEvidence, stubEvidence } from "./helpers";

/**
 * The evidence surface must make provenance VISIBLE and must never read as an
 * authorization surface. Every assertion here is about what a human can see.
 */
test.describe("benchmark evidence — provenance", () => {
  test.beforeEach(async ({ page }) => { await stubEvidence(page, "fresh"); });

  test("renders symbol mapping end to end", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("map-repo")).toHaveText("rNVDAUSDT");
    await expect(page.getByTestId("map-venue")).toHaveText("NVDAUSDT");
    await expect(page.getByTestId("map-reference")).toHaveText("NVDA");
  });

  test("renders bid, ask and midpoint", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("bid")).toHaveText("132.600");
    await expect(page.getByTestId("ask")).toHaveText("132.820");
    await expect(page.getByTestId("midpoint")).toHaveText("132.710");
  });

  test("renders sourceAsOf and fetchedAt as two distinct instants", async ({ page }) => {
    await gotoEvidence(page);
    const source = page.getByTestId("source-asof");
    const fetched = page.getByTestId("fetched-at");
    // The provider instant, verbatim, never rewritten to our clock.
    await expect(source).toHaveText("2026-09-30T13:59:59.514Z");
    // Our own local request time. Distinct, and displayed as such.
    await expect(fetched).toHaveText("2026-09-30T14:00:00.000Z");
    await expect(source).not.toHaveText(await fetched.textContent() ?? "");
  });

  test("labels the timestamp as provider-generated, not an exchange trade time", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("timestamp-type")).toHaveText("PROVIDER_GENERATED_QUOTE");
  });

  test("renders freshness age, the effective gate and the inherited ceiling distinctly", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("freshness-age")).toHaveText("486ms");
    // The EFFECTIVE gate is the provider cache window: 15s, NOT 96h.
    await expect(page.getByTestId("freshness-effective-threshold")).toHaveText("15.00s");
    // The inherited 96h ceiling is still displayed, explicitly marked as NOT
    // the gate so it cannot be misread as the acceptance threshold.
    await expect(page.getByTestId("freshness-inherited-threshold")).toHaveText("96.00h");
    await expect(page.getByTestId("freshness-inherited-threshold")).toHaveClass(/text-amber-700/);
    await expect(page.getByTestId("freshness-status")).toHaveText("verified_fresh");
  });

  test("renders provider identity and halt status", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("provider")).toHaveText("robinhood_stock_token_api");
    await expect(page.getByTestId("provider-symbol")).toHaveText("NVDA");
    await expect(page.getByTestId("halt-status")).toHaveText("no");
  });

  test("discloses that the multiplier is never applied to the price", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("multiplier-applied")).toHaveText("false");
    await expect(page.getByTestId("price-basis")).toHaveText("RAW_UNDERLYING_EQUITY_NOT_MULTIPLIER_ADJUSTED");
  });
});

test.describe("benchmark evidence — regime and carry", () => {
  test.beforeEach(async ({ page }) => { await stubEvidence(page, "fresh"); });

  test("renders regime, carry horizon and the reopen instant", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("regime")).toHaveText("tradfi_open");
    await expect(page.getByTestId("carry-horizon")).toHaveText("0");
    await expect(page.getByTestId("required-source")).toHaveText("live_intraday");
  });

  test("always discloses the unmodelled holiday calendar (GAP-017)", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("holiday-support")).toContainText("not modelled");
    await expect(page.getByTestId("holiday-support")).toContainText("GAP-017");
  });
});

test.describe("benchmark evidence — Quant verdict", () => {
  test.beforeEach(async ({ page }) => { await stubEvidence(page, "fresh"); });

  test("renders basis, hurdle, net edge and the verdict", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("quant-action")).toHaveText("NEUTRAL");
    await expect(page.getByTestId("basis")).toHaveText("0.0000%");
    await expect(page.getByTestId("hurdle")).toHaveText("0.1501%");
    await expect(page.getByTestId("net-edge")).toHaveText("-0.1501%");
  });

  test("reports that Quant was actually evaluated", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("quant-evaluated")).toHaveText("yes");
  });
});

test.describe("benchmark evidence — no execution authority", () => {
  test.beforeEach(async ({ page }) => { await stubEvidence(page, "fresh"); });

  test("shows a persistent read-only / no-execution-authority label", async ({ page }) => {
    await gotoEvidence(page);
    const label = page.getByTestId("authority-label");
    await expect(label).toBeVisible();
    await expect(label).toContainText("read-only");
    await expect(label).toContainText("no execution authority");
  });

  test("shows executable state as false, not as a green light", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("executable-state")).toHaveText("executable: false");
  });

  test("states the missing packet-to-dispatch bridge rather than hiding it", async ({ page }) => {
    await gotoEvidence(page);
    await expect(page.getByTestId("execution-authority")).toContainText("execution authority: none");
    await expect(page.getByTestId("execution-authority")).toContainText("packet→dispatch bridge: absent");
    await expect(page.getByTestId("blocking-reasons")).toContainText("NO_PACKET_TO_DISPATCH_BRIDGE");
  });

  test("contains no order, size, dispatch or authorization control", async ({ page }) => {
    await gotoEvidence(page);
    // The only interactive control on this surface is the operator-triggered
    // re-read. One button, and it is not an order control.
    await expect(page.getByRole("button")).toHaveCount(1);
    await expect(page.getByTestId("reload-evidence")).toBeVisible();
    // No text inputs either: nothing on this page can be turned into a size.
    await expect(page.locator('input, select, textarea')).toHaveCount(0);
    // No form can be submitted from here.
    await expect(page.locator("form")).toHaveCount(0);
    // Submission vocabulary must not appear as a CONTROL. It may appear in the
    // blocking-reason text, which is exactly where the missing bridge belongs.
    for (const forbidden of ["submit order", "place order", "send order"]) {
      await expect(page.getByRole("button", { name: forbidden })).toHaveCount(0);
      await expect(page.getByRole("link", { name: forbidden })).toHaveCount(0);
    }
    // And the blocking reason that names the gap must still be rendered.
    await expect(page.getByTestId("blocking-reasons")).toContainText("no execution authority");
  });

  test("separates the evidence surface from the Bitget Demo lifecycle route", async ({ page }) => {
    await gotoEvidence(page);
    // A separate route, not a tab: the two are not one pipeline.
    await expect(page.locator('a[href="#/desk"]')).toHaveCount(1);
    await expect(page.locator('a[href="#/evidence"]')).toHaveCount(1);
  });
});
