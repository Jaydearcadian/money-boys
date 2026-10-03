# QUARANTINE — ab-campaign evidence is control-plane verification, NOT empirical model evaluation

The artifacts in this directory demonstrate that the A/B harness, Portfolio Copilot, and structural risk veto fire correctly by construction.

However:
1. **The LLM arm was not driven by live model inference.** All LLM verdicts in `ab_observations.jsonl` were passed as `authoredFixtureVerdict` scenario objects. No call to DashScope or any LLM API occurred.
2. **Metrics describe the fixture's scenario script**, not Qwen-Plus or any model's empirical behavior:
   - `decisionConsistency: 0.9` reflects repeated runs of the same authored fixture literal.
   - `armsAgreementRate: 0.8` reflects 2 authored disagreements out of 10 scripted cycles.
3. Neither file is admissible as Track 2 agent evaluation benchmark evidence until the harness is driven by live LLM inference calls against live market data.

Tracked by: **GAP-022** (LLM decision authority arm evaluated only with authored fixture verdicts; live inference integration required).
