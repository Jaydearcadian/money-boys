# Money Boys Desk — Live QA Report

## Scope
Local Vite preview `:3000` + public quick tunnel. Landing + five desk routes.

## Public URL
https://blacks-andreas-alto-feet.trycloudflare.com

## Fixed
1. **CSS tokens** — `var(--accent)` / `var(--warn)` unresolved on daemon metrics → aliased to emerald/amber on `.db-shell`.
2. **Mobile overflow** — strategy correlation matrix and cockpit blew past 320–390px → shell/main `overflow-x: clip`, matrix internal scroll, tighter mobile padding.
3. **Daemon uptime** — hardcoded “3+ Days” → computed from evidence `startedAt`/`asOf`.
4. **Halt UX** — disabled run buttons only → sandbox halt banner when halted.
5. **Daemon tiles** — nested `db-card` → `db-gauge-card` micro tiles.
6. **Public tunnel** — dead/530 after metrics port collision → clean quick tunnel on free metrics port.

## Verified
- Playwright e2e: **18/18 passed**
- Overflow matrix 320/390/768 × all routes: **0 issues**
- Accent resolves to `rgb(52, 211, 153)`
- Moneliq parity: black canvas, gradient cards, white active nav
- Seals 64-hex, tamper MISMATCH, blast HARD_VETO, lifecycle order id present
- Local + public desk/evidence: HTTP **200**

## Residual
- `money-boys-engine` remains stopped (not required for static desk + browser sandbox).
