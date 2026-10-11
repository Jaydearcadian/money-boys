import { expect, test } from "@playwright/test";

const open = (page: import("@playwright/test").Page) => page.goto("/index.html#/");

test.describe("landing page", () => {
  test("renders one h1 and every section from the specification", async ({ page }) => {
    await open(page);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toContainText("while Wall Street sleeps");
    for (const name of [
      "What is Money Boys?",
      "The gap that never sleeps",
      "Every decision starts from real numbers",
      "Four helpers, one decision",
      "Rules that never bend",
      "Watch the desk decide",
      "Read the actual records",
      "How it was built",
    ]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
  });

  test("names the four helpers and the five safety rules", async ({ page }) => {
    await open(page);
    for (const n of ["Macro Boy", "Quant Boy", "Risk Boy", "Execution Boy"]) {
      await expect(page.getByRole("heading", { name: n, exact: true })).toBeVisible();
    }
    for (const id of ["I-01", "I-02", "I-03", "I-04", "I-05"]) {
      await expect(page.getByText(id, { exact: true })).toBeVisible();
    }
  });

  test("shows a computed US session status", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("session-status")).toContainText(/US stock market: (open|closed)/);
  });

  test("sandbox: approves, refuses and vetoes with the right reasons", async ({ page }) => {
    await open(page);
    const verdict = page.getByTestId("verdict");
    await expect(verdict).toHaveText("Approved");
    await page.getByRole("tab", { name: "Thin order book" }).click();
    await expect(verdict).toHaveText("Refused: no edge");
    await page.getByRole("tab", { name: "Overstretched account" }).click();
    await expect(verdict).toHaveText("Vetoed by Risk Boy");
    await expect(page.getByText("over the 65% limit")).toBeVisible();
    await page.getByRole("tab", { name: "Trade too large" }).click();
    await expect(verdict).toHaveText("Vetoed by Risk Boy");
    await expect(page.getByText("over the $5,000 limit")).toBeVisible();
  });

  test("sandbox receipt is sealed with a real SHA-256 that changes per scenario", async ({ page }) => {
    await open(page);
    const hash = page.getByTestId("receipt-hash");
    await expect(hash).toHaveText(/^[0-9a-f]{64}$/);
    const first = await hash.textContent();
    await page.getByRole("tab", { name: "Thin order book" }).click();
    await expect(hash).toHaveText(/^[0-9a-f]{64}$/);
    expect(await hash.textContent()).not.toBe(first);
  });

  test("record downloads resolve", async ({ page, request }) => {
    await open(page);
    for (const href of ["/money_boys_paper_trades.csv", "/money_boys_89d_trades.csv"]) {
      await expect(page.locator(`a[href="${href}"]`)).toBeVisible();
      const res = await request.get(href);
      expect(res.ok(), href).toBe(true);
    }
  });

  test("no invented performance figures or ledger jargon", async ({ page }) => {
    await open(page);
    const text = (await page.locator("main").innerText()).toLowerCase();
    for (const banned of ["clm-", "claim", "proof ledger", "governance ledger", "sharpe", "win rate", "drawdown"]) {
      expect(text, banned).not.toContain(banned);
    }
  });

  test("every in-page link points at an existing anchor", async ({ page }) => {
    await open(page);
    const hrefs = await page.$$eval('a[href^="#"]', (as) => as.map((a) => a.getAttribute("href")!));
    for (const h of hrefs) {
      // SPA hash routes (#/… and bare #/) are page transitions, not DOM anchors.
      if (h === "#/" || h.startsWith("#/")) continue;
      expect(await page.locator(h).count(), h).toBe(1);
    }
  });

  test("Try the sandbox pill navigates to the in-app dashboard", async ({ page }) => {
    await open(page);
    await page.locator("a.mh-pill", { hasText: "Try the sandbox" }).first().click();
    await expect(page).toHaveURL(/#\/sandbox/);
    await expect(page.locator(".db-shell")).toBeVisible();
    await expect(page.getByTestId("scenario-grid")).toBeVisible();
  });

  test("no horizontal overflow from 320 to 1920", async ({ page }) => {
    for (const w of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width: w, height: 900 });
      await open(page);
      const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(over, `overflow at ${w}`).toBe(false);
    }
  });
});
