# GAP-019 — Operator Risk Decision (DRAFT, UNSIGNED)

**Status: DRAFT. This document changes nothing until an operator signs it.**
GAP-019 remains `BLOCKED_EXTERNAL` in `foundry/gaps.jsonl`.

---

## 1. What the code actually does

| | |
|---|---|
| Endpoint | `GET https://api.robinhood.com/rhj/prices/{symbol}` |
| Credentials | **None.** No API key, no auth header, no account scope. |
| Data returned | Public price quote: bid, ask, midpoint, quote timestamp |
| Personal data | **None.** No account, position, order or identity data. |
| Rate observed | **1 symbol, 1 request per operator-triggered run** |
| Documented limit | 60 requests/second |
| Observed rate vs limit | **~0.017% of the documented ceiling** |

Source: `packages/engine/src/integrations/robinhood/benchmark.ts:187`

## 2. The ambiguity

Robinhood Chain Terms of Service (last updated 2026-08-24), §2.3 Prohibited Use,
includes "use of automated tools (such as bots, scrapers, or spiders)" and
"bypassing technical or usage restrictions".

Against that:

- The Stock Token API is **documented**, **public**, **read-only**, rate-limited,
  carries published per-endpoint cache windows, and is **intended for developer
  consumption**.
- We use ~4 requests/minute against a published 60 requests/second ceiling —
  roughly 0.07% of the allowance.

**The reasonable reading** is that §2.3 targets unauthorised scraping, and a
published, rate-limited, developer-facing API is the authorised case. Read that
way the ToS and the API documentation are consistent; read the other way they
contradict each other.

**Why this is still a decision and not a settled fact:** ToS text is not API
documentation, "automated tools" is written broadly and nothing in the API docs
says "this clause does not apply to us", and nobody in this repository has the
authority to interpret someone else's contract.

## 3. What is being decided

Whether Money Boys may continue **automated, unattended, scheduled** reads of
the public Robinhood price endpoint, accepting §2.3 as not applying to a
documented read-only developer API used at ~0.07% of its published rate limit.

## 4. Scope of the decision — read this part

**Covered by signing:**
- Unattended/scheduled reads of the public price endpoint, no credentials.
- One symbol or a small fixed symbol list, at or below the published rate limit.
- Read-only. No order, no account, no personal data.

**NOT covered by signing:**
- Any use of Robinhood account, order, portfolio or authentication endpoints.
- Any write, order placement, or anything touching customer funds.
- Any materially higher request rate than the published limit.
- Any other provider whose terms have not been reviewed the same way.
- This decision is about **one provider's read-only public endpoint**. It is
  not a general licence to automate against financial APIs.

## 5. Residual risk accepted

| Risk | Assessment |
|---|---|
| §2.3 read to prohibit *any* automation | Low likelihood, non-zero. Mitigated by documented-API status and negligible volume. |
| Rate limit breach | Effectively nil at 0.07% of ceiling; the client is single-shot with no retry loop. |
| ToS change invalidating this decision | Real. Would require re-review; the decision is scoped to the 2026-08-24 text. |
| Benchmark correctness | Independent of this decision. Handled by the freshness gate and `REFERENCE_BENCHMARK` independence rules. |

## 6. Operator sign-off

By signing, the operator confirms they have read §2.3 and the linked API
documentation, accept the residual risk in §5, and authorise only the scope in
§4.

```
Operator name:
Signature:
Date:
Terms version reviewed: 2026-08-24
Decision:  [ ] APPROVE (scope of §4)      [ ] DECLINE      [ ] ESCALATE to legal counsel
```

## 7. Until signed

- GAP-019 stays `BLOCKED_EXTERNAL`.
- Automated/scheduled Robinhood reads stay prohibited.
- Operator-triggered single reads may continue — they are not the automated
  access this gap governs, and two such reads are already recorded as evidence.
- No claim is promoted to any state implying live benchmark authority.