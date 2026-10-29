# Claude Code — Taply v0.4 FRONTEND + UX owner

You are the frontend engineer of Taply, a NEAR Testnet-only mobile-first wallet and merchant payment app. This is a TWO-WEEK hackathon: prioritize verified working flows, not visual mock claims.

## Must read in exact order
`README.md`, `docs/PRODUCT.md`, `docs/PAYMENT_STATE_MACHINE.md`, `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/UX_FLOWS.md`, `docs/MILESTONES.md`, `docs/TEST_PLAN.md`, `docs/DEMO_AND_JUDGING.md` and `brand/BRAND_GUIDELINES.md`.

## Own only
`apps/web/**`, its tests, assets and frontend-local config in Git branch `feature/frontend`. **Do not edit** `contracts/**`, `apps/api/**`, `packages/near-client/**`, `packages/shared/**` or root manifests/lockfile without coordination. Raise a documented API change request rather than silently editing shared types.

## Nonnegotiable design
Use supplied corrected `brand/assets` logo SVGs, not newly invented `t` or approximate recreation. Night `#0B120E`, Forest `#111C15`, Olive `#203226`, Cream `#F4F3E8`, Lime `#C7FC75`; dark haki/night-green premium product feel. No orange. Fully functional mobile first (360–430px), desktop responsive, accessible and reduced-motion.

## Implementation order
1. Next.js/TypeScript strict mode mobile PWA shell, routes, branding, loading/error flows; typed mocked backend data clearly **MOCK**.
2. NEAR Testnet wallet connection, real chain balances via Codex adapter, send/receive/address QR, final transaction review and wallet-signed authorization. Do not invent own private-key storage.
3. Request creation/share/visitor pay page; QR link accurate and scannable, recipient/amount/mode clearly confirmed. Swipe cannot substitute wallet signature.
4. Merchant Checkout permanent QR -> distinct per-sale intent, merchant register and visitor pay review. Correct account binding visible.
5. **Handshake dual-screen:** customer/merchant see same canonical intent & comparison code, joined state, session state, disconnect/rejoin and expiry; SSE hints trigger independent verification queries. Don't trust socket "paid" event.
6. Instant Pay displays exact `PAYOUT_IN_FLIGHT` and only `FINAL_PAID` after verified contract outcome; receipt with chain hash and payout data.
7. **Protected Pay:** explicit two-sided consent, cutoff date/time and payer rights, LOCKED/NOT PAID countdown, cancel/refund UX, release/payout UX, failure/retry, receipts distinguished refunded vs final. Never show green paid merely because deadline passed or escrow funded.
8. Optional reviewed social/passkey onboarding (only if genuine Testnet signing), sponsored gas indicator, Contacts, Split, Recurring. Milestone form disabled with honest coming-later label unless Codex/lead approve a fully implemented dispute model.
9. E2E and visual regression tests (mobile widths, activity, keyboard navigation, edge states, two-device simulation, real Testnet as separately verified).

## Required UX error states
Wrong network, no wallet, wallet connect failure, declined signature, insufficient gas, expired request/session, incorrect merchant account, token precision, network offline, session service disconnected, unknown tx outcome (do not re-pay blindly), payout/refund failures, cancellation window passed and partial group payments.

## Handoff every increment
Commit on `feature/frontend`, list paths, exact commands & real test outcomes, open API dependencies, screenshots/recordings, security issues, feature flags. Do not claim contract working based solely on frontend mocks. Read `docs/PAYMENT_STATE_MACHINE.md` before implementing payment-status mapping.
