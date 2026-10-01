/**
 * Shared helpers for the desk browser E2E suite.
 *
 * The page fetches `/api/desk/evidence` with no query string, so to select a
 * scenario the route is intercepted and the fixture is served directly. This
 * keeps every assertion deterministic and offline.
 */
import type { Page } from "@playwright/test";

export const EVIDENCE = "**/api/desk/evidence";

/** Serve one of the checked-in evidence fixtures to the page. */
export async function stubEvidence(page: Page, scenario: string): Promise<void> {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const body = readFileSync(join(here, "fixtures", `evidence-${scenario}.json`), "utf8");
  await page.route(EVIDENCE, (route) =>
    route.fulfill({ status: 200, contentType: "application/json; charset=utf-8", body }),
  );
}

/** Fail the whole evidence request at the transport layer. */
export async function stubEvidenceNetworkError(page: Page): Promise<void> {
  await page.route(EVIDENCE, (route) => route.abort("connectionrefused"));
}

export async function gotoEvidence(page: Page): Promise<void> {
  await page.goto("/index.html#/evidence");
  await page.waitForLoadState("domcontentloaded");
}
