import { expect, test } from "@playwright/test";

const openDashboard = (page: import("@playwright/test").Page, hash = "#/app") =>
  page.goto(`/index.html${hash}`);

test.describe("in-app dashboard", () => {
  test("cockpit renders telemetry, KPIs, agents, and chart", async ({ page }) => {
    await openDashboard(page, "#/app");
    await expect(page.locator(".db-shell")).toBeVisible();
    await expect(page.getByTestId("telemetry-bar")).toBeVisible();
    await expect(page.getByTestId("kpi-stocks")).toBeVisible();
    await expect(page.getByTestId("kpi-margin")).toBeVisible();
    await expect(page.getByTestId("kpi-receipts")).toBeVisible();
    await expect(page.getByTestId("kpi-latency")).toBeVisible();
    await expect(page.getByTestId("agent-matrix")).toBeVisible();
    await expect(page.getByTestId("margin-gauge")).toBeVisible();
    await expect(page.getByTestId("rwa-cards")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("basis-chart")).toBeVisible({ timeout: 15_000 });
  });

  test("strategy track loads alpha factory evidence", async ({ page }) => {
    await openDashboard(page, "#/strategy");
    await expect(page.getByTestId("strategy-view")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("equity-curve")).toBeVisible();
    await expect(page.getByTestId("corr-matrix")).toBeVisible();
    await expect(page.getByTestId("strategy-view").locator(".db-label", { hasText: "OOS Sharpe" })).toBeVisible();
  });

  test("copilot blast radius classifies oversized buys", async ({ page }) => {
    await openDashboard(page, "#/copilot");
    await expect(page.getByTestId("copilot-view")).toBeVisible();
    await page.getByRole("button", { name: "+$7k rNVDA" }).click();
    await expect(page.getByTestId("blast-verdict")).toHaveText("HARD_VETO");
    await page.getByRole("button", { name: "+$2k rNVDA" }).click();
    await expect(page.getByTestId("blast-verdict")).toHaveText(/PERMITTED|DE_RISKING/);
  });

  test("audit track shows lifecycle proof and three beats", async ({ page }) => {
    await openDashboard(page, "#/audit");
    await expect(page.getByTestId("audit-view")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lifecycle-proof")).toContainText("1491906882204499969");
    await expect(page.getByText("Beat 1 · Perception")).toBeVisible();
  });

  test("sandbox tab runs real engine deliberation and seals a 64-char hash", async ({ page }) => {
    await openDashboard(page, "#/sandbox");
    await expect(page.getByTestId("sandbox-lab")).toBeVisible();
    await expect(page.getByTestId("scenario-grid")).toBeVisible();
    await expect(page.getByTestId("result-panel")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("verdict")).not.toHaveText("");
    await expect(page.getByTestId("seal-hash")).toHaveText(/^[0-9a-f]{64}$/, { timeout: 10_000 });
    await page.getByRole("button", { name: /Run / }).nth(1).click();
    await expect(page.getByTestId("seal-hash")).toHaveText(/^[0-9a-f]{64}$/);
  });

  test("receipt tamper tester reports MISMATCH", async ({ page }) => {
    await openDashboard(page, "#/sandbox");
    await expect(page.getByTestId("seal-status")).toHaveText(/Verified/, { timeout: 10_000 });
    await page.getByRole("button", { name: "Try tampering" }).click();
    await expect(page.getByTestId("seal-status")).toHaveText("MISMATCH: body was changed");
  });

  test("decision feed opens and closes the receipt drawer", async ({ page }) => {
    await openDashboard(page, "#/audit");
    const feed = page.getByTestId("decision-feed");
    await expect(feed).toBeVisible({ timeout: 15_000 });
    await feed.locator("button").first().click();
    await expect(page.getByTestId("drawer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("drawer")).toHaveCount(0);
  });

  test("no horizontal overflow from 320 to 1920 on cockpit", async ({ page }) => {
    for (const w of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width: w, height: 900 });
      await openDashboard(page, "#/app");
      const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      expect(over, `overflow at ${w}`).toBe(false);
    }
  });
});
