---
name: Money Boys Landing v2
route: "#/ (canonical), #/landing-v2 (alias), #/v1 (legacy)"
colors:
  ink-950: "oklch(0.15 0.012 265)"
  ink-900: "oklch(0.18 0.014 265)"
  text: "oklch(0.97 0.005 265)"
  text-muted: "oklch(0.76 0.01 265)"
  accent: "oklch(0.80 0.17 160)"
  warn: "oklch(0.82 0.15 80)"
  light-bg: "oklch(0.945 0.005 265)"
  light-text: "oklch(0.2 0.015 265)"
  light-muted: "oklch(0.42 0.015 265)"
  light-accent: "oklch(0.45 0.11 160)"
typography:
  display: "Plus Jakarta Sans 800, clamp(2.5rem, 1.4rem + 5.2vw, 5.25rem), 1.02, tracking-tight"
  h2: "clamp(1.875rem, 1.2rem + 2.8vw, 3.25rem)"
  mono: "JetBrains Mono (badges, numbers, receipts)"
motion:
  archetype: Premium
  ease-std: "cubic-bezier(0.4,0,0.2,1)"
  ease-enter: "cubic-bezier(0.05,0.7,0.1,1)"
  durations: "quick 150ms / standard 400ms / slow 700ms"
---

# Overview

Reference: the Moneliq banking pin (Pinterest `4GFeA8Avq`, see `../MONELIQ_REFERENCE_SPEC.md`): black rounded hero card, dim-gradient headline, 3-zone glass nav, pill badges, dark glass cards, stair-stepped steps, a light split section with a floating card.

Brand idea: **the desk that trades while Wall Street sleeps** (night / crescent motif) over an honest core: every claim on the page is derived from the engine, the charter, or the claims ledger.

> The hero image the user mentioned was never received. The hero is an original generated render (`public/hero-desk.*`, 1376×768, no text). Swap it by replacing those two files.

# Evidence vs inference

| Item | Source |
|---|---|
| Layout vocabulary, section order, component shapes | Evidence: Moneliq reference frames |
| Colour values, motion curves | Inference: derived from skills, not sampled from the pin |
| 65% / $5k / <50ms / R4 R5 R6 / I-01 / I-03 | Evidence: `AGENTS.md` charter |
| Node status, margin utilisation | Evidence: `/api/desk/state`, labelled demo/paper; offline state when absent |
| Latency numbers | Deliberately **not shown** (seeded values in the demo state) |
| Basis calculator | Fixture, labelled "illustrative fixture, not live data" |
| Proof ledger | Evidence: `foundry/claims.jsonl` imported at build time |
| Open/closed chip | Computed from clock; holidays not modelled (GAP-017), disclosed in FAQ |

# Components

Nav (3-zone, disclosure menu <1024px) · Hero card (scrim + `<picture>`, telemetry card with `role=meter`, hot/warm `aria-pressed` toggle) · Constants strip (`dl`) · Four Boys (stair-stepped `ol`) · Basis calculator (light, radio group, `aria-live` result with icon + text) · Guardrail bento · Verifier (reused, test IDs intact) · Ledger (`details`) · FAQ (`details`) · Closing CTA · Footer (prime directive).

# Skill → decision map

| Skill | Applied as |
|---|---|
| motion-design-skill | Premium archetype, 3 layers (primary rise, secondary reveal stagger ≤300ms, ambient float/glow), no linear spatial motion, no opacity-only reveals, reduced-motion kill-switch |
| inclusive-design-skills | Skip link, one h1, ordered headings, icon+text for every state, ≥44px targets, ≤66ch measure, focus rings, honest offline state |
| wireframer-skill / ux-flow-designer | `UX-FLOW.md` wireframes and flow |
| icon-generator-skill | Crescent mark exported to favicon / apple-touch / 192 / 512 |
| color-expert | OKLCH reference→semantic tokens, 60-30-10, `color-mix(in oklab)` hovers, contrast asserted in e2e |
| designer-skills / frontend-designer | Semantic HTML first, native `details`/`fieldset`/radio, existing React+Tailwind architecture kept |
| brand-to-design-md | This file |
| responsive-craft | Mobile-first, `clamp()`, `100svh`, `min-w-0`, `overflow: clip`, 16px inputs, image width/height, no duplicate DOM except the hero image swap, swept 320→1920 in e2e |

# Do / Don't

- Do keep every number traceable. Don't print latencies or A/B results as performance.
- Do keep in-page links off `location.hash` (routing falls back to v1 for unknown hashes).
- Don't convey state by colour alone.

# Known limits

- Hero is 1376×768; it is upscaled on very wide screens.
- Token contrast is asserted for text tokens; text over the hero image relies on the scrim and was checked by eye, not sampled.
- Holiday calendar not modelled.
