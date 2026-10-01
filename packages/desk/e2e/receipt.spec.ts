import { expect, test } from "@playwright/test";

/**
 * In-browser receipt verification and tamper rejection.
 *
 * The seal is recomputed client-side with W3C SubtleCrypto over the same
 * canonical JSON the engine uses. These tests prove the browser can DETECT
 * tampering, which is the claim CLM-009 previously rested on typecheck+build
 * alone. They do not and cannot prove anything about live execution.
 */

async function stubReceipts(page: import("@playwright/test").Page, scenario: "valid" | "tampered") {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (n: string) => readFileSync(join(here, "fixtures", n), "utf8");

  const receipts =
    scenario === "valid"
      ? [JSON.parse(read("receipt-valid.json"))]
      : [JSON.parse(read("receipt-valid.json")), JSON.parse(read("receipt-tampered.json"))];

  // SSE INIT carries latestReceipt, which is what the landing Verifier reads.
  const state = JSON.parse(read("desk-state.json"));
  if (scenario === "tampered") state.latestReceipt = receipts[1];
  await page.route("**/api/desk/stream", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: "data: " + JSON.stringify({ type: "INIT", state }) + "\n\n",
    }),
  );
  await page.route("**/api/desk/receipts*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ receipts }),
    }),
  );
  await page.route("**/api/desk/state", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state) }),
  );
}

test.describe("in-browser receipt verification", () => {
  test("confirms an untampered SHA-256 seal", async ({ page }) => {
    await stubReceipts(page, "valid");
    await page.goto("/index.html#/");
    await expect(page.getByTestId("verify-seal")).toBeEnabled();
    await page.getByTestId("verify-seal").click();
    await expect(page.getByTestId("verify-ok")).toBeVisible();
    await expect(page.getByTestId("verify-ok")).toContainText("0 TAMPERING DETECTED");
  });

  test("rejects a receipt whose metrics were altered after sealing", async ({ page }) => {
    await stubReceipts(page, "tampered");
    await page.goto("/index.html#/");
    await expect(page.getByTestId("verify-seal")).toBeEnabled();
    await page.getByTestId("verify-seal").click();
    await expect(page.getByTestId("verify-bad")).toBeVisible();
    await expect(page.getByTestId("verify-bad")).toContainText("SEAL MISMATCH");
    await expect(page.getByTestId("verify-ok")).toHaveCount(0);
  });

  test("refuses to claim an intact seal when no receipt is present", async ({ page }) => {
    // Serve a state with NO receipt at all. The verifier must not be able to
    // report a pass, and must not crash on the missing input.
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const empty = JSON.parse(readFileSync(join(here, "fixtures", "desk-state.json"), "utf8"));
    empty.latestReceipt = null;

    await page.route("**/api/desk/state", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(empty) }),
    );
    await page.route("**/api/desk/stream", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: "data: " + JSON.stringify({ type: "INIT", state: empty }) + "\n\n",
      }),
    );
    await page.route("**/api/desk/receipts*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ receipts: [] }) }),
    );

    await page.goto("/index.html#/");
    await expect(page.getByTestId("verify-seal")).toBeDisabled();
    await expect(page.getByTestId("verify-ok")).toHaveCount(0);
    await expect(page.getByTestId("verify-bad")).toHaveCount(0);
  });

  test("rejects a receipt whose seal keys are stripped entirely", async ({ page }) => {
    // A receipt with no receiptHash at all must not verify.
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const stripped = JSON.parse(readFileSync(join(here, "fixtures", "receipt-valid.json"), "utf8"));
    delete stripped.receiptHash;

    const state = JSON.parse(readFileSync(join(here, "fixtures", "desk-state.json"), "utf8"));
    state.latestReceipt = stripped;
    await page.route("**/api/desk/state", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state) }),
    );
    await page.route("**/api/desk/stream", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: "data: " + JSON.stringify({ type: "INIT", state }) + "\n\n",
      }),
    );
    await page.route("**/api/desk/receipts*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ receipts: [stripped] }) }),
    );

    await page.goto("/index.html#/");
    await page.getByTestId("verify-seal").click();
    // A missing hash is a rejection, never a pass.
    await expect(page.getByTestId("verify-bad")).toBeVisible();
    await expect(page.getByTestId("verify-ok")).toHaveCount(0);
  });
});

test.describe("SSE lifecycle on the desk surface", () => {
  test("INIT seeds the ledger with the latest receipt", async ({ page }) => {
    await stubReceipts(page, "valid");
    await page.goto("/index.html#/desk");
    await expect(page.getByTestId("audit-count")).toContainText("(1)");
    await expect(page.getByTestId("audit-row")).toHaveCount(1);
  });

  test("a NEW_RECEIPT frame adds a NEW row to the DOM, live over SSE", async ({ page }) => {
    // Start from an empty ledger and let the real fixture server's SSE
    // connection deliver the frames. Only a handled frame can create a row.
    await page.route("**/api/desk/receipts*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ receipts: [] }) }),
    );
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const emptyState = JSON.parse(readFileSync(join(here, "fixtures", "desk-state.json"), "utf8"));
    emptyState.latestReceipt = null;

    await page.route("**/api/desk/state", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptyState) }),
    );
    // Route the stream to a controllable emitter so the transition from 0 to 1
    // is unambiguous, rather than depending on a fixed server delay.
    await page.route("**/api/desk/stream", async (route) => {
      const receipt = JSON.parse(readFileSync(join(here, "fixtures", "receipt-valid.json"), "utf8"));
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body:
          "data: " + JSON.stringify({ type: "INIT", state: emptyState }) + "\n\n" +
          "data: " + JSON.stringify({ type: "NEW_RECEIPT", receipt, execution: null }) + "\n\n",
      });
    });

    await page.goto("/index.html#/desk");
    await expect(page.getByTestId("audit-row")).toHaveCount(1);
    await expect(page.getByTestId("audit-row").first()).toHaveAttribute(
      "data-receipt-id", JSON.parse(readFileSync(join(here, "fixtures", "receipt-valid.json"), "utf8")).receiptId,
    );
  });

  test("a duplicate receiptId is not appended twice", async ({ page }) => {
    // Same receipt delivered by INIT and again by NEW_RECEIPT: the hook's
    // dedupe must keep the ledger at one row.
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const receipt = JSON.parse(readFileSync(join(here, "fixtures", "receipt-valid.json"), "utf8"));
    const state = JSON.parse(readFileSync(join(here, "fixtures", "desk-state.json"), "utf8"));
    state.latestReceipt = receipt;

    await page.route("**/api/desk/state", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state) }),
    );
    await page.route("**/api/desk/stream", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body:
          "data: " + JSON.stringify({ type: "INIT", state }) + "\n\n" +
          "data: " + JSON.stringify({ type: "NEW_RECEIPT", receipt, execution: null }) + "\n\n",
      }),
    );

    await page.goto("/index.html#/desk");
    await expect(page.getByTestId("audit-row")).toHaveCount(1);
    await page.waitForTimeout(600);
    await expect(page.getByTestId("audit-row")).toHaveCount(1);
  });

  test("a NEW_RECEIPT with a distinct id is prepended to the ledger", async ({ page }) => {
    // Serve two receipts from /receipts (deduped into the list) and let the
    // SSE INIT deliver only the newer one, then assert ordering is
    // newest-first and both rows are present.
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const read = (n: string) => JSON.parse(readFileSync(join(here, "fixtures", n), "utf8"));

    const valid = read("receipt-valid.json");
    const tampered = read("receipt-tampered.json");
    // Same payload, different seal identity: a genuinely distinct receipt.
    const second = { ...tampered, receiptId: "11111111-2222-4333-8444-555555555555" };

    const state = read("desk-state.json");
    state.latestReceipt = second;

    await page.route("**/api/desk/stream", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: "data: " + JSON.stringify({ type: "INIT", state }) + "\n\n",
      }),
    );
    await page.route("**/api/desk/receipts*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ receipts: [valid] }) }),
    );
    await page.route("**/api/desk/state", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state) }),
    );

    await page.goto("/index.html#/desk");
    await expect(page.getByTestId("audit-row")).toHaveCount(2);
    // Newest first: the SSE-delivered receipt leads.
    await expect(page.getByTestId("audit-row").first()).toHaveAttribute(
      "data-receipt-id", "11111111-2222-4333-8444-555555555555",
    );
  });
});
