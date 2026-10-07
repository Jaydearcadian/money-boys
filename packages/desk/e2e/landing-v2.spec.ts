import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { usEquityRegime } from "../src/lib/regime";
import { computeBasis, parseClaims } from "../src/lib/landing-data";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n: string) => JSON.parse(readFileSync(join(here, "fixtures", n), "utf8"));

/** Pure logic: no page needed. */
test.describe("landing-v2 pure logic", () => {
  test("regime: weekday session is open", () => {
    const r = usEquityRegime(new Date("2024-06-03T14:00:00Z")); // Mon 10:00 ET
    expect(r.open).toBe(true);
    expect(r.nextOpen).toBeNull();
    expect(r.holidayCalendarModelled).toBe(false);
  });
  test("regime: weekend is closed, next open Monday", () => {
    const r = usEquityRegime(new Date("2024-06-01T15:00:00Z")); // Sat
    expect(r).toMatchObject({ open: false, nextOpen: "Mon 09:30 ET" });
  });
  test("regime: Friday after close rolls to Monday", () => {
    expect(usEquityRegime(new Date("2024-06-07T20:30:00Z")).nextOpen).toBe("Mon 09:30 ET");
  });
  test("regime: pre-open weekday returns same day; midnight is not mis-read as 24h", () => {
    expect(usEquityRegime(new Date("2024-06-03T12:00:00Z")).nextOpen).toBe("Mon 09:30 ET");
    expect(usEquityRegime(new Date("2024-06-04T04:00:00Z"))).toMatchObject({ open: false, nextOpen: "Tue 09:30 ET" });
  });
  test("regime: boundaries 09:30 open, 16:00 closed", () => {
    expect(usEquityRegime(new Date("2024-06-03T13:30:00Z")).open).toBe(true);
    expect(usEquityRegime(new Date("2024-06-03T20:00:00Z")).open).toBe(false);
  });
  test("basis arithmetic", () => {
    const nv = computeBasis({ tokenMid: 132.5, benchmarkClose: 128.8, hurdleDragPct: 0.73 });
    expect(nv.rawPct).toBeCloseTo(2.87, 2);
    expect(nv.edgePct).toBeCloseTo(2.14, 2);
    expect(nv.direction).toBe("SELL_BASIS");
    const ap = computeBasis({ tokenMid: 224.1, benchmarkClose: 224.2, hurdleDragPct: 0.38 });
    expect(ap.edgePct).toBeCloseTo(-0.34, 2);
    expect(ap.clears).toBe(false);
    expect(computeBasis({ tokenMid: 0, benchmarkClose: 1, hurdleDragPct: 0 }).valid).toBe(false);
    expect(computeBasis({ tokenMid: 1, benchmarkClose: 1, hurdleDragPct: -1 }).valid).toBe(false);
  });
  test("claims parser keeps ledger states and skips junk", () => {
    const c = parseClaims('{"id":"A","claim":"x","state":"TESTED","limitations":["l"]}\nnot json\n{"id":"B","claim":"y","state":"LIVE_DEMONSTRATED"}');
    expect(c.map((x) => x.state)).toEqual(["TESTED", "LIVE_DEMONSTRATED"]);
    expect(c[0]!.limitation).toBe("l");
  });
});

async function stubState(page: Page, mode: "ok" | "down" = "ok") {
  const state = fx("desk-state.json");
  state.latestReceipt = fx("receipt-valid.json");
  await page.route("**/api/desk/state", (r) =>
    mode === "ok"
      ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state) })
      : r.abort("connectionrefused"),
  );
}
const open = (page: Page) => page.goto("/index.html#/landing-v2");

test.describe("landing-v2 page", () => {
  test("structure: one h1, skip link, ordered landmarks", async ({ page }) => {
    await stubState(page);
    await open(page);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Skip to content" })).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("img:not([alt])")).toHaveCount(0);
  });

  test("anchor navigation scrolls without leaving the route", async ({ page }) => {
    await stubState(page);
    await open(page);
    await page.getByRole("link", { name: "Guardrails", exact: true }).first().click();
    expect(page.url()).toContain("#/landing-v2");
    await expect(page.locator("#guardrails")).toBeFocused();
    await expect(page.locator("h1")).toHaveCount(1); // still v2, not v1
  });

  test("canonical root #/ renders LandingV2 and legacy #/v1 renders LandingPage", async ({ page }) => {
    await stubState(page);
    await page.goto("/index.html#/");
    await expect(page.locator(".lv2")).toBeVisible();
    await expect(page.locator("h1")).toHaveText(/The desk that trades while Wall Street sleeps/i);

    await page.goto("/index.html#/v1");
    await expect(page.locator(".lv2")).toHaveCount(0);
    await expect(page.getByText("DESK-01").first()).toBeVisible();
  });

  test("calculator derives the verdict from inputs", async ({ page }) => {
    await stubState(page);
    await open(page);
    const out = page.getByTestId("basis-result");
    await expect(out).toContainText("+2.14%");
    await expect(out).toContainText("Clears the hurdle");
    await page.getByText("rAAPL", { exact: true }).click();
    await expect(out).toContainText("-0.34%");
    await expect(out).toContainText("no trade");
    await page.getByLabel("Token mid ($)").fill("abc");
    await expect(out).toContainText("Enter positive prices");
  });

  test("telemetry reports engine state and the hot/warm toggle is a pressed button", async ({ page }) => {
    await stubState(page);
    await open(page);
    await expect(page.getByRole("meter")).toHaveAttribute("aria-valuenow", /\d/);
    const warm = page.getByRole("button", { name: "Warm path" });
    await warm.click();
    await expect(warm).toHaveAttribute("aria-pressed", "true");
  });

  test("engine down: honest offline state, no invented numbers", async ({ page }) => {
    await stubState(page, "down");
    await open(page);
    await expect(page.getByText("engine offline")).toBeVisible();
    await expect(page.getByRole("meter")).toHaveCount(0);
  });

  test("verifier accepts the sealed receipt", async ({ page }) => {
    await stubState(page);
    await open(page);
    await page.getByRole("button", { name: /Verify Cryptographic Seal/i }).click();
    await expect(page.getByTestId("verify-ok")).toBeVisible();
  });

  test("proof ledger renders every claim with a text state", async ({ page }) => {
    await stubState(page);
    await open(page);
    await expect(page.locator("#proof li details")).toHaveCount(9);
    await expect(page.locator("#proof").getByText("Live demonstrated", { exact: true })).toHaveCount(2);
  });

  test("reduced motion: content is visible immediately", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await stubState(page);
    await open(page);
    await expect(page.locator(".lv2")).not.toHaveAttribute("data-motion", "on");
    await expect(page.locator("#faq h2")).toBeVisible();
    expect(await page.locator("#faq h2").evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
    await ctx.close();
  });

  test("no horizontal overflow from 320 to 1920", async ({ page }) => {
    await stubState(page);
    for (const w of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width: w, height: 900 });
      await open(page);
      const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(over, `overflow at ${w}`).toBe(false);
    }
  });

  test("design tokens meet WCAG contrast", async ({ page }) => {
    await stubState(page);
    await open(page);
    const ratios = await page.evaluate(() => {
      const root = document.querySelector(".lv2") as HTMLElement;
      const c = document.createElement("canvas").getContext("2d")!;
      const rgb = (v: string) => {
        const probe = document.createElement("span");
        probe.style.color = v;
        root.appendChild(probe);
        const col = getComputedStyle(probe).color; // browser resolves oklch -> rgb()/color()
        probe.remove();
        c.fillStyle = "#000"; c.clearRect(0, 0, 1, 1);
        c.fillStyle = col; c.fillRect(0, 0, 1, 1);
        const d = c.getImageData(0, 0, 1, 1).data;
        return [d[0]!, d[1]!, d[2]!];
      };
      const lum = ([r, g, b]: number[]) => {
        const f = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
      };
      const ratio = (a: string, b: string) => {
        const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
        return (x! + 0.05) / (y! + 0.05);
      };
      const v = (n: string) => `var(${n})`;
      return {
        text: ratio(v("--text"), v("--bg")),
        muted: ratio(v("--text-muted"), v("--bg")),
        mutedOnSurface: ratio(v("--text-muted"), v("--surface")),
        accent: ratio(v("--accent"), v("--bg")),
        warn: ratio(v("--warn"), v("--bg")),
        lightText: ratio(v("--light-text"), v("--light-bg")),
        lightMuted: ratio(v("--light-muted"), v("--light-bg")),
        lightAccent: ratio(v("--light-accent"), v("--light-surface")),
        lightWarn: ratio(v("--light-warn"), v("--light-surface")),
        lightDanger: ratio(v("--light-danger"), v("--light-surface")),
      };
    });
    for (const [k, r] of Object.entries(ratios)) expect(r, k).toBeGreaterThanOrEqual(4.5);
  });

  test("performance tabs switch between backtest and live execution without vanishing", async ({ page }) => {
    await stubState(page);
    await open(page);
    const liveBtn = page.getByRole("button", { name: "Live Bitget Execution" });
    await liveBtn.click();
    await expect(page.getByText("Tokenized US Equity Round-Trip")).toBeVisible();
    await expect(page.getByText("GAP-020 RESOLVED")).toBeVisible();
    await expect(page.getByText("1491458794516021249", { exact: true }).first()).toBeVisible();

    const backtestBtn = page.getByRole("button", { name: "Track 1 Alpha Backtest" });
    await backtestBtn.click();
    await expect(page.getByText("Out-of-Sample Sharpe", { exact: true })).toBeVisible();
    await expect(page.getByText("3.89", { exact: true })).toBeVisible();
  });
});
