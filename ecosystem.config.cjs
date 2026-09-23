/**
 * Production Runtime Ecosystem (PM2) — money-boys stack.
 *
 * Three tiers, started together for live demo / production capture:
 *   1. money-boys-engine — native node:http + SSE telemetry server (:3001)
 *   2. money-boys-desk   — Vite preview of the operator console (:3000)
 *   3. money-boys-paper  — live Bitget Demo (TESTNET) paper-trading daemon
 *
 * Usage:
 *   pnpm --filter @money-boys/desk build   # desk preview needs dist/
 *   pm2 start ecosystem.config.cjs
 *   pnpm exec tsx scripts/smoke-test-stack.ts   # end-to-end smoke (6 checks)
 *   pm2 logs
 *
 * Notes:
 *   - Engine/desk run keyless (PAPER deliberation + seeded telemetry).
 *   - money-boys-paper is fail-closed on boot: it requires
 *     BITGET_API_KEY / BITGET_SECRET_KEY / BITGET_PASSPHRASE with
 *     BITGET_ENV=testnet (see scripts/live-paper-runner.ts). Without live
 *     demo keys PM2 will keep it in errored/retry state by design — set the
 *     keys in .env (never commit) before expecting it online.
 */
module.exports = {
  apps: [
    {
      name: "money-boys-engine",
      script: "packages/engine/src/server.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      env: {
        PORT: 3001,
        NODE_ENV: "production",
      },
    },
    {
      name: "money-boys-desk",
      script: "node_modules/.bin/vite",
      args: "preview --host 0.0.0.0 --port 3000",
      cwd: "packages/desk",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "money-boys-paper",
      script: "scripts/live-paper-runner.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
