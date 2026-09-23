# AUTHORITY_MODEL

| Action | Who | Gate |
|---|---|---|
| Create proposal | Macro Boy / operator / council | Zod schema |
| Veto/allow | Risk Boy only | Deterministic math (I-02) |
| Seal receipt | Engine sealer | SHA-256 (I-03) |
| Sign HTTP | BitgetClient with env keys | HMAC; keys never in LLM context (I-01) |
| Place order | BitgetClient after ALLOW+receipt | Fail closed if either missing |
| Change invariants | Human + ADR | PR review |

**Non-authority:** LLM text, README claims, demo narration.
