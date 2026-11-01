# Phase 7: merchant POS, customer checkout and Handshake UX

Branch `feature/frontend`, 2026-11-01. `apps/web` only. No contract, `packages/*`,
root manifest or lockfile change. No dependency added. No transaction sent, nothing
deployed, nothing pushed or merged. `NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE`,
Protected Pay and native Taply Wallet signing stay off.

## What works today (real, against the pinned Instant-only contract)

| Feature | Route | How it works |
| --- | --- | --- |
| Merchant hub | `/merchant` (account menu → Merchant) | Shows the exact connected Testnet account, New sale, Store QR, and a local list of requests started on this device. The list shows **no status**; status is read from the contract on `/pay/<id>`. |
| POS sale request | `/merchant/register` | The **same `CreateRequest` flow** as personal requests, in a `sale` variant: visible sale reference (memo), Amount → Review → QR progress, and an "unverified merchant" notice at review. Same wallet signer, journal, Web Lock, nonce, quote, freshness and signing-flag gates. Terms keep `merchantAccountId: null` and `sessionBinding: null`, which the deployed contract requires. After signing it opens `/pay/<id>`, the existing QR ticket, live chain status and Verified Paid receipt. |
| Unique sale IDs | — | Each sale uses a fresh 32-byte CSPRNG nonce, so it gets a new deterministic request ID. An unconfirmed earlier sale blocks the next one on the same device until the chain explains it (existing guard, now tested for the POS). |
| Store (discovery) QR | `/merchant/setup` | Permanent `https://<share origin>/checkout/<account>` QR on a cream card labelled "Discovery only, not a payment". It is drawn only for a public HTTPS share origin. Copy, native share and preview are available. |
| Customer checkout | `/checkout/[accountId]` | Discovery state only: the exact Testnet account, no display name, no amount, no wallet prompt. "Scan sale QR" / "Paste sale link", how-to-pay steps, and what the page does and does not prove. Invalid or non-Testnet accounts are refused. The merchant viewing their own page gets a New sale shortcut. |
| Merchant QR scanning | Tap → Pay, `/scan`, checkout | `parseScanInput` accepts approved-origin `/checkout/<account>` links as well as `/pay/<id>`. Query and fragment are dropped (no recipient or amount substitution). Other hosts are named, not followed. Invalid or non-Testnet accounts get a specific message. Bare account IDs are not accepted. A merchant code only navigates; nothing is signed or created. The Phase 6B camera lifecycle is unchanged. |

**Limitation shown in the UI:** a sale is an ordinary Instant Testnet request to the
merchant's account. It is **not** an authenticated merchant checkout: there is no
NEP-413 profile, no merchant binding and no session binding.

## Preview-only / gated

| Item | State |
| --- | --- |
| Live Handshake (merchant) | Inert "Coming later" tile on `/merchant`, whatever the flags say. |
| Handshake customer link `/s/[sessionId]` | Validates the session ID, then shows "Live Handshake is not available yet" with a route to scan the sale QR. No pairing, code or terms are rendered. |
| `lib/handshake/adapter.ts` | Typed boundary for the pending API. The only shipped adapter refuses every call. With the flag off, even a supplied backend is ignored; with the flag on, a reviewed backend adapter is still required. |
| `lib/handshake/present.ts` | Pure presenter, ready for integration. The comparison code is derived **on device from chain terms** with the canonical `@taply/shared` algorithm (fixture A `XMBVTN`, B `684MZB`). Any disagreement in session ID, nonce, expiry, intent ID, terms hash, code or merchant is `mismatch`. Presence is per role. Expiry uses chain time. It has no paid output. |
| `/demo/handshake` | DEMO-stamped, synthetic two-device walkthrough through the **real** presenter. Includes a substituted-terms mismatch (+1 yoctoNEAR → different code → blocked) and an explicit review gate. It stops before payment. The mock data is import-guarded to this route. |
| Merchant profile (NEP-413) | Inert tile and notice; needs the backend. |
| Active-sale listing on checkout | Not implemented; needs the backend. Said on screen. |

## Needs the Codex backend / contract

1. NEP-413 auth: `POST /api/v1/auth/challenges`, `/auth/verify`, merchant profile `PUT/GET /api/v1/merchants/:accountId`.
2. Contract support for non-null `merchantAccountId` and `sessionBinding` in `create_request` (currently rejected).
3. Session service: `POST /api/v1/sessions`, `/:id/bind`, `/:id/join`, `/:id/review` (`{termsHash}`), `GET /:id`, `GET /:id/events` (SSE hints, cookie auth), `/:id/close`.
4. Optional: `GET /api/v1/merchants/:accountId/payments?cursor=` for a merchant sales list with provenance.

### Integration expectations

- Implement `HandshakeAdapter` in a separate reviewed module. Pass it to `resolveHandshakeAdapter(FLAGS, backend)`. Keep the shipped refusal adapter as the default.
- Never use the server's `comparisonCode` for display. Feed `presentHandshake` with terms read from the contract.
- SSE events trigger a session and chain re-read only. No event sets any payment state.
- Join token: fragment only, consumed and stripped with `history.replaceState`, never logged.
- POS with sessions: create the session draft, then call `CreateRequest` with the binding (a new prop; `buildInstantTerms` would accept `merchantAccountId`/`sessionBinding`), then `bind`. Until then, keep both fields `null`.
- Checkout with profiles: show a display name only after NEP-413 verification of name, account, network, contract, origin and expiry, and keep "account control is not KYC".

## Tests and results (local Windows, Node 24.22.2, pnpm 11.5.0)

| Command | Result |
| --- | --- |
| `pnpm --filter @taply/web run check` | Exit 0. Brand assets byte-identical, typecheck, lint, **563/563 tests in 45 files** (+48 since Phase 6B's 515). |
| `pnpm --filter @taply/web exec next build --webpack` | Exit 0, 21/21 pages. |
| `pnpm check` (root) | **Exit 1, not caused by this phase.** `@taply/shared` 92/92 passes. `@taply/near-client` fails 3/158 in `test/wallet-payment-signer.test.mjs` with `INVALID_ARGUMENT`. Its fixture `request-open.json` hard-codes `createdAtNs` (2026-10-31 21:21 UTC) while the test sets expiry from `Date.now()`, so more than 24 h later the lifetime exceeds the maximum and the guard correctly refuses. `packages/**` is identical to the Phase 6B base. **Codex must fix the fixture** (derive `createdAtNs` from the fixture clock). The web suite does not run because the root script stops at the first failure; it passes on its own (above). |
| Flake note | One run of `context-sync.test.tsx` ("re-verifies an aged contract check") timed out under full-suite load. It passed 5/5 in isolation and in every other full run. Unchanged code; worth a longer `waitFor` later. |

New tests:

- `lib/merchant/__tests__/discovery.test.ts`: account checks, canonical URL, no parameters.
- `lib/payments/__tests__/scan-input.test.ts`: discovery parsing, query substitution, other host, invalid/non-Testnet accounts, schemes, credentials, invisible characters, pay-link regression.
- `components/merchant/__tests__/merchant.test.tsx`: POS uses the existing create path with null merchant/session binding; unique IDs and nonces; no wallet prompt before the explicit click; unconfirmed sale blocks the next; signing flag off; wallet and non-Testnet gates; inert tiles; discovery QR content and local-only refusal; sales selection.
- `components/merchant/__tests__/checkout.test.tsx`: discovery state without amount, name or paid claim and with no write/quote calls; invalid accounts; paste routes; own page; Turkish.
- `components/scan/__tests__/qr-scanner.test.tsx` (+2): merchant QR navigation and camera stop; rejection without `onMerchant`; invalid/non-Testnet/other-host messages.
- `lib/handshake/__tests__/handshake.test.ts`: fixture codes, mismatch matrix, presence, expiry, no paid output, adapter gating, mock containment.
- `components/handshake/__tests__/handshake-ui.test.tsx`: unavailable session state, invalid ID, DEMO labelling, matching codes, substituted terms block, explicit review, no paid state, Turkish.

### Real-browser smoke (production build, Chromium 1248)

`scripts/phase7-screenshot-smoke.mjs`, result in [`phase7/smoke.json`](phase7/smoke.json):

- It injects a **read-only fake account** (`taply-merchant.testnet`) through near-connect's injected-wallet event. Its signing methods always throw.
- Only the app origin and the configured RPC host are reachable. RPC methods seen: `status`, `block`, `view_account`, `get_config`, `quote_create_request`. **No broadcast.**
- 34 screens: 0 px horizontal overflow at 360/390/430/1280, no page errors, no visible control under 44 px on the merchant/checkout screens at 360 px.
- Tab reaches "Scan sale QR". The checkout pulse is `none` with reduced motion.
- The build used the placeholder share origin `https://taply-preview.app`, so the QRs in the screenshots point there (not a deployed host).

Reproduce: `NEXT_PUBLIC_TAPLY_SHARE_ORIGIN=https://taply-preview.app pnpm --filter @taply/web exec next build --webpack`, `next start -p 3207 -H 127.0.0.1`, then
`node apps/web/scripts/phase7-screenshot-smoke.mjs <playwright/index.mjs> <out dir> apps/web/.env.local`.

## Screenshots

`docs/screenshots/phase7-commerce/`: `merchant-hub-*`, `discovery-qr-*`, `pos-amount-*`,
`pos-review-390`, `checkout-own-*`, `checkout-customer-*` (incl. 1280 and TR),
`checkout-not-testnet-390`, `checkout-paste-invalid-390`, `session-unavailable-390`,
`session-invalid-390`, `demo-handshake-*` (create, compare, mismatch, wallet, 1280, TR),
`merchant-hub-390-tr`, `discovery-qr-390-tr`. Full-page captures show the fixed bottom
navigation over mid-page content; that is a capture artifact.

## Remaining device tests (iPhone and Android)

Not done: no physical device was used in this phase.

1. POS end-to-end with a real wallet: create a 0.01 NEAR sale, wallet redirect return, `/pay/<id>` QR, customer pays from a second phone, Verified Paid on both.
2. Store QR printed or on screen → scan from the customer phone → checkout → scan the sale QR → pay.
3. Scanner: merchant QR on iOS Safari (bundled decoder) and Android Chrome (BarcodeDetector); non-Testnet / foreign-host merchant QR messages; camera indicator off after merchant navigation.
4. Two sales in a row on one device: the second is blocked until the first is confirmed. Confirm the blocking notice is clear at the counter.
5. Safe-area insets on notched phones; VoiceOver/TalkBack reading of the comparison code; large text.
6. Android has not been tested in any phase.

## Manual QA checklist

- [ ] Account menu shows Merchant; the bottom navigation still has exactly Wallet / Tap / Activity.
- [ ] `/merchant` without a wallet asks to connect; with a `.near` account it refuses.
- [ ] The receiving account is shown in full on the hub, the POS chip and the review.
- [ ] POS review shows the amount, reference, recipient, who can pay, expiry, storage bond, gas and the unverified-merchant notice before "Create request in wallet".
- [ ] Declining in the wallet creates nothing and is not listed.
- [ ] Store QR card says "Discovery only, not a payment"; no QR on localhost/LAN.
- [ ] Checkout shows no amount, no name and no wallet prompt.
- [ ] A merchant QR with `?recipient=…` opens the original account only.
- [ ] `/s/<uuid>` shows "not available yet"; `/s/garbage` shows "Invalid session link".
- [ ] `/demo/handshake` carries the DEMO stamp on every device frame and never shows a paid state.
- [ ] EN/TR switch on every new screen; reduced motion stops the checkout pulse.
- [ ] Existing request → pay → Verified Paid flow unchanged (`/request/new`, `/pay/<id>`, `/receipt/<id>?ftx=`).
