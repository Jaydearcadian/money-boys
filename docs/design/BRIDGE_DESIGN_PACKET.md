# Bridge Design Packet — Benchmark Packet to Demo Dispatch

**Status:** DESIGN ONLY. No bridge code. No order. No authorization.
**Phase:** authorized as design; implementation not authorized.
**Baseline:** `ae4c6a8`

---

## 1. What exists today, and what is missing

Two proven halves that meet nowhere:

| Half | Path | Status |
|---|---|---|
| Benchmark | `fetchRobinhoodBenchmark` → `robinhoodToEvidence` → gate → Quant | proven, read-only |
| Venue | `sealReceipt` → `OrderDispatcher.dispatch` → fill → read-back → flatten | proven, Demo-only |

`buildPacket` is called from exactly one place (`scripts/demo-strategy-preflight.ts:130`) and never reaches the dispatcher. The evidence surface imports no dispatcher at all. `bridge.packetToDispatch === "absent"`.

The gap is not "wiring two functions". It is the absence of a **control path** that decides whether a benchmark-derived intent may become a venue intent.

---

## 2. Closed-session policy — resolved

**Decision: Option 4. Block Quant while `tradfi_closed`.**

### Why the previous behavior was wrong

The first live positive verdict — `SELL_BASIS`, net edge **+0.030%** — was produced at `2026-10-01T08:23Z`, regime `tradfi_closed`, carry **5.27h** to reopen.

The provider quotes NVDA continuously, so `sourceAsOf` was 7.4s old and passed freshness. That freshness describes **provider responsiveness**, not **underlying tradability**. Those are different claims, and the old code conflated them.

Compounding it: `assertBenchmarkProvable` *widens* the freshness ceiling to 7 days during closure. So a 24-hour-old quote is admitted as usable. Verified in a test — a 24h-old quote is inside the 7-day ceiling and the freshness check alone does **not** block it.

A +0.030% edge against 5.27h of unmodelled overnight gap risk is not a trade. It is an artifact of a permissive gate.

### Classification

**Not** an overnight indicative-price strategy — that would require accepting unbounded gap risk until reopen, with no declared policy behind it.

**Not** a latest-close strategy — that requires verifying `sourceAsOf` falls on or before the last 16:00 ET boundary, which is a *different* validation than freshness.

**Not** a separate closed-session decision policy — no such policy exists yet.

It was **a condition that should block Quant**, and it now does.

### Why not the alternatives

| Option | Rejected because |
|---|---|
| 1. Overnight indicative | Requires a product/risk decision nobody has made. Carry + gap risk unbounded to reopen, and GAP-017's holiday gap is unmodelled. |
| 2. Latest-close | Verifiable and sane, but "is this the last close?" is a different question from "is this fresh?". Needs its own validation. |
| 3. Separate policy | The right eventual shape, but designing a second decision path before proving the first one is premature. |
| **4. Block Quant** | **Chosen.** Cheap, honest, and yields `NO_TRADE`. |

### Guarantee against silent drift

`CLOSED_SESSION_VETO` is computed from the regime **before any I/O**, so it applies on every exit path including provider failure. The veto is independent of freshness — a perfectly fresh quote is still refused. `CLOSED_SESSION_POLICY` is a typed constant surfaced in the payload and rendered in the UI.

A test pins that a 24h-old quote in closure is blocked by the **veto alone**, with freshness explicitly *not* failing. If that ever flips, the closure ceiling changed and this policy needs re-review.

---

## 3. Receipt-relative admission

Two local instants, never conflated:

```
requestedAt          local clock when the provider request was issued
responseReceivedAt   local clock when the response landed

ageAtRequestStartMs   sourceAsOf -> requestedAt          diagnostics only
ageAtReceiptMs        sourceAsOf -> responseReceivedAt   THE ADMISSION BASIS
receiptLatencyMs      responseReceivedAt - requestedAt
```

**Why receipt-relative.** A quote can be fresh when we ask and stale by the time we can act on it. Admission must reflect the age at the moment of possible action. Gating on the request-start age is the *more permissive* of the two — it under-reports true latency by the round trip, unbounded under a slow or hung provider.

**The 15s policy is unchanged.** `EVIDENCE_EFFECTIVE_MAX_AGE_MS = 15_000` remains the documented `/rhj/prices` cache window. Changing it needs more evidence than one sample.

**Safety detail worth naming:** a negative receipt age (`sourceAsOf` in our future) is `unverifiable`, never fresh. A naive `age >= gate` test would classify it as fresh. Pinned by a mutation test — removing the guard fails 2 tests.

---

## 4. Bridge design

### 4.1 Typed `StrategyPacket`

```ts
interface StrategyPacketV1 {
  version: 1;
  issuedAt: string;            // local
  expiresAt: string;            // issuedAt + TTL

  symbolMapping: { repoSymbol; venueSymbol; referenceSymbol };

  benchmark: {
    provider; sourceAsOf; requestedAt; responseReceivedAt;
    ageAtReceiptMs; freshnessBasis: "receipt-relative";
    effectiveThresholdMs; freshness: "verified_fresh";
    timestampType; bid; ask; midpoint; isTradingHalt;
  };

  regime: { regime: "tradfi_open"; hoursToNextReopen; requiredBenchmarkSource };

  quant: { action; rawBasisPct; hurdleRatePct; netEdgePct; quantScore };
  sizing: { compliantQuantity; roundedNotionalUsd; minQty; minNotionalUsdt; multiplier };
  risk: { decision: "APPROVED"; exposureUsd; projectedMarginUtilization };
  council: { compositeScore; macro; quant; risk; exec };
}
```

Deliberately **not** a `PreflightPacket`. That type carries `executable`, which is authorization vocabulary; this one carries no such field.

### 4.2 Packet expiry

`expiresAt = issuedAt + TTL` (proposed 60s, well inside the 15s freshness budget's intent). Expired packets are rejected at dispatch. TTL rationale: the quote is already admitted at ≤15s old; a packet that lives longer than a minute is describing a stale world.

### 4.3 Eligibility — every condition must hold

```
valid provider quote (typed, shape-validated)
  AND receipt-relative freshness within 15,000ms
  AND regime == tradfi_open
  AND symbol mapping resolves and matches
  AND netEdge > 0 AND action != NEUTRAL
  AND packet not expired
  AND Risk decision == APPROVED
  AND Council decision == APPROVED
  AND receipt sealed and verifiable
  AND environment == Demo
  AND operator confirmed
-> ELIGIBLE FOR DEMO DISPATCH

ANY condition false -> NO_TRADE, no venue call
```

### 4.4 Revalidation at the dispatcher

The dispatcher must **not** trust the packet's own claims. It independently recomputes:

1. `now < expiresAt`
2. `ageAtReceiptMs = Date.parse(responseReceivedAt) - Date.parse(sourceAsOf)` still within gate **as of dispatch time** — so a packet that sat in a queue is refused
3. `resolveRegime() == "tradfi_open"` **re-evaluated now**, not read from the packet
4. `verifyReceipt(receipt) === true`
5. `mapToVenueSymbol(repoSymbol) === venueSymbol`
6. environment is Demo

**Point 2 is the important one.** Admission-time freshness is necessary but not sufficient; the packet must still be fresh when acted on.

### 4.5 Demo/live separation

- `BITGET_ENV` must be `testnet`/`demo`; `client.demoTrading === true` (`paptrading: 1` header).
- **Fail closed if live is requested.** The bridge is Demo-only. There is no flag to enable it live.
- Credentials resolved from env only, never logged.
- A live-env assertion failure must block before any private route is touched.

### 4.6 Idempotency

`sealIntents` already mixes intent into the digest so open and close cannot collide (the real 40786 fix). Bridge requirements:

- `clientOid` derived from the receipt hash, deterministic across restarts
- On retry, re-read position state; if the intent is already reflected, treat as satisfied, do not re-send
- Persist `receiptHash → clientOid` so a restart cannot mint a colliding id

### 4.7 Position read-back and flatten

- Fill → **read position back from the venue**; never trust the fill response alone
- Assert the observed position matches the intent; mismatch → halt, do not retry blindly
- Flatten uses a separate intent and separate `clientOid`
- Final reconciliation must show zero open positions and `accountFlat`
- `closePosition` on failure must be attempted; an unflattened position is a hard stop

### 4.8 Failure and restart

| Failure | Behaviour |
|---|---|
| Provider read fails | `NO_TRADE`, no packet, no venue call |
| Freshness fails at admission | `NO_TRADE` |
| Freshness fails at dispatch | `NO_TRADE`, packet discarded |
| Risk veto | `NO_TRADE`, receipt retained as VETOED |
| Council quorum fails | `NO_TRADE` |
| Receipt verify fails | halt; **no dispatch** |
| Place-order rejects | halt; reconcile actual position state before any retry |
| Fill ambiguous | halt; read back; never blind-retry |
| Process dies mid-cycle | restart re-reads position state first; no assumption of FLAT |
| Flatten fails | hard stop; surface the open position, never report FLAT |

---

## 5. Closed-session policy inside the bridge

`tradfi_closed` → `NO_TRADE` at step 3 of eligibility, and re-checked at dispatch step 3.

This means **the bridge will not trade outside 09:30–16:00 ET.** The Demo campaign must be run during open hours. That is a scheduling constraint on humans, not something the system automates.

Future replacement requires, by explicit product/risk decision and not by default:
- latest-close validation, **or**
- an overnight policy with its own hurdle, sizing, expiry and risk limits

---

## 6. Deterministic E2E plan

**Happy path:** fresh open-hours fixture → positive edge → Risk → Council → sealed receipt → dispatcher → fill → read-back → close → flatten → FLAT.

**Fail-closed cases:** stale-at-admission · fresh-at-request-stale-at-receipt · slow response · closed session (fresh quote) · provider halt · provider HTTP failure · missing `sourceAsOf` · unparseable `sourceAsOf` · future `sourceAsOf` · symbol mismatch · expired packet · Risk veto · Council quorum fail · receipt tampered · live-env rejection · duplicate `clientOid`.

Every negative case asserts **zero venue calls**, not merely a rejected result. A test that proves "no order" must observe the absence of the call.

---

## 7. Open risks

1. **The +0.030% closed-session edge is now correctly suppressed**, so the first genuinely eligible live read has not happened. Whether an open-hours dislocation exists is unknown.
2. **7.4s of a 15s budget consumed in one sample.** Not alarming, but headroom is thinner than the earlier 398ms sample suggested. If live open-hours reads routinely exceed 15s at receipt, the gate will fail closed correctly and the policy will need review on evidence.
3. **GAP-017 remains unmodelled.** Holidays will report `tradfi_open` when the venue is shut. During a holiday the bridge would admit a packet it should refuse. **This is a live risk for the Demo campaign** — check the ET calendar before running.
4. **Robinhood terms (GAP-019) remain unresolved.** The bridge design does not change that. A Demo campaign using this path still rests on an `BLOCKED_EXTERNAL` gap.
5. **Single venue, single symbol.** No cross-venue or portfolio construction.

---

## 8. Authorization boundary

Not authorized by this document: bridge code, any order, any scheduler, any daemon, any live-env capability, any claim promotion.

Authorized next: implement the bridge under this design, then the deterministic E2E, then an open-hours live read, then — **separately authorized** — one bounded Demo campaign.