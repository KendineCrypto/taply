# Phase 5 one-tap redesign: before/after screenshots

Captured 2026-11-01 with Playwright (Chromium 1248) against this branch:
`before/` from commit f69a8e5 (`next dev`), `after/` from the production build (`next start`).
`.env.local` pointed at `taply-pay-pilot-1.testnet` with live Testnet RPC reads.

- `*-receipt*.png` is the real pilot receipt from docs/EVIDENCE.md
  (`/receipt/9b9a5724…?ftx=CrzQ57Jx…`), verified live by the in-app verifier.
- `*-pay-status.png` is the same request's live `/pay/[id]` page.
- No wallet was connected, so home/request show the disconnected state. The
  connected balance hero and the amount-first request/review steps are covered
  by unit tests (home.test.tsx, create-request.test.tsx), not by these images.
- `after/overflow.txt`: horizontal overflow in px per page and width (all 0).

File names: `<locale>-<viewport width>-<screen>.png`.
