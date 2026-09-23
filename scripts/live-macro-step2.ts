/**
 * Step 2 — Live catalyst extraction through the noema-qa cognitive shield.
 * Run from repo root with the encrypted token (never paste plaintext):
 *   export BITGET_QWEN_API_KEY="$(openssl enc -d -aes-256-cbc -pbkdf2 -in .secrets/qwen38.enc -pass file:.secrets/qwen38.key)"
 *   pnpm exec tsx scripts/live-macro-step2.ts
 *   unset BITGET_QWEN_API_KEY
 */
import { fetchCatalystProposal } from "../packages/engine/src/agents/macro.js";
import { MacroCatalystProposalSchema } from "../packages/engine/src/skills/noema-qa/schemas.js";

async function testLiveMacro() {
  console.log("=== TESTING LIVE QWEN + NOEMA-QA COGNITIVE SHIELD ===");
  const headline =
    "NVIDIA confirms additional $5B TSMC packaging capacity allocated for Blackwell enterprise servers.";
  const source = "https://reuters.com/markets/nvda-tsmc-allocation";
  const proposal = await fetchCatalystProposal("rNVDAUSDT", headline, source);
  console.log("\nStructured Proposal Output:");
  console.log(JSON.stringify(proposal, null, 2));
  MacroCatalystProposalSchema.parse(proposal);
  console.log(
    "\nnoema-qa Shield: STRICT SCHEMA PARSE PASSED (SHA-256 bound: " +
      proposal.evidenceHash.slice(0, 12) +
      "...)",
  );
  if (proposal.score > 0 && proposal.direction !== "NEUTRAL") {
    console.log("noema-qa Shield: PASSED (Non-zero score, valid schema, SHA-256 bound)");
  } else {
    console.warn("Fell back to neutral — check raw output format.");
    process.exit(2);
  }
}

testLiveMacro().catch((e) => {
  console.error(e);
  process.exit(1);
});
