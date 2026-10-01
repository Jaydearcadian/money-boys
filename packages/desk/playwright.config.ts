import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E for the read-only evidence surface.
 *
 * ZERO live network. `webServer` is the local `e2e/fixture-server.mjs`, which
 * serves the built `dist/` and backs every engine route with checked-in JSON.
 * The suite therefore asserts RENDERING, SSE handling and in-browser receipt
 * verification — it does not and cannot assert anything about live providers.
 */
/**
 * 3001, not an arbitrary port: `API_BASE` is compiled into the bundle as
 * `http://localhost:3001`, so the fixture API must be same-origin with the page.
 */
const PORT = 3001;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node e2e/fixture-server.mjs",
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { EVIDENCE_PORT: String(PORT), EVIDENCE_SSE_DELAY_MS: "500" },
  },
});
