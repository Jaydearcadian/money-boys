#!/usr/bin/env node
/**
 * Thin Node entry for AGENTS.md command: node scripts/check-foundry.mjs
 * Delegates to bash scripts/check-foundry.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const r = spawnSync("bash", [join(root, "scripts/check-foundry")], {
  cwd: root,
  stdio: "inherit",
});
process.exit(r.status ?? 1);
