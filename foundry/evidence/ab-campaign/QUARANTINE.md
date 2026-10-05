# QUARANTINE — ab-campaign evidence is control-plane verification, NOT empirical model evaluation

The artifacts in this directory demonstrate that the A/B harness, Portfolio Copilot, and structural risk veto fire correctly by construction.

Status update (GAP-022 PARTIALLY RESOLVED):
1. **Live Inference Pipeline Integrated:** `AbPaperRunner` and `scripts/run-ab-paper-campaign.ts` now support live DashScope / Qwen gateway inference via `queryLiveLlmVerdict()`. When `BITGET_QWEN_API_KEY` or `DASHSCOPE_API_KEY` is present, the LLM arm queries `qwen3.8-max` over native `fetch` with Zod schema enforcement and records empirical round-trip latency and SHA-256 payload digests.
2. **Provenance-Derived Stamping Enforced:** `derivePerformanceStamp()` automatically inspects telemetry records (checking latency > 0ms, valid 64-char SHA-256 hex, and non-fixture model IDs). It refuses to claim live performance evidence if runs were driven by authored fixture literals or fail-closed fallbacks.
3. **Current Artifact State:** The present `ab_metrics_summary.json` was generated in an environment without live API keys; telemetry confirmed 0 live evaluations, so the artifact is automatically stamped `provenance: "ALL_SYNTHETIC"` and `syntheticFixture: true`.
4. **Admissibility Constraint:** Neither file is admissible as empirical agent evaluation benchmark evidence until a sustained paper campaign is executed against live Bitget Demo market quotes with real model calls.

Tracked by: **GAP-022** (Status: **PARTIAL** — inference pipeline & telemetry-derived provenance implemented; sustained empirical campaign remaining).
