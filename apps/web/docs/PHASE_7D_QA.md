# Phase 7D: merchant commerce reliability and UX hardening

Branch `feature/frontend`, 2026-11-01/02. Base `062cb46`. `apps/web` only. No
contract, `packages/*`, root manifest, lockfile, env file or Codex worktree
change. No dependency added. No transaction sent, nothing deployed, pushed or
merged. No flag turned on. The journal, Web Lock, reconcile rules, wallet
checks and Verified Paid verifier are unchanged.

## Bugs found and fixed

| # | Severity | Finding (confirmed) | Fix | Commit |
| --- | --- | --- | --- | --- |
| 1 | Medium | **Second sale stuck until reload.** The creation gate reconciled unexplained `create_request` entries once per mount. If the previous sale was not yet visible at a final block at that moment, "still unconfirmed" stayed until a reload, though the chain confirmed it seconds later. | Bounded re-check (3 s, 6 s, 12 s, 24 s, then every 30 s) while any creation is still `pending`. It stops once the chain explains it, or at the existing 2-minute `may_reattempt` hold. | `26eb6ef` |
| 2 | Medium | **Another account's draft blocked this account.** The pending list was not cleared when the connected account changed (the effect returned early when the new account had nothing unresolved). | Pending drafts are filtered at render to the connected account and pinned contract; the effect always settles its state. | `26eb6ef` |
| 3 | Medium | **Stale review after an account switch.** The review kept showing the old account as "You (the connected account)". Signing was already refused by `prepareCreateRequest` (signer ≠ creator), but the error read "quote failed". | A review prepared for another account is never shown or signed. The screen returns to the form with "Connected account changed … Nothing was signed". | `26eb6ef` |
| 4 | Medium (UX) | **No way back to the sale QR after a wallet redirect.** Returning to `/merchant/register` (e.g. after a mobile redirect wallet) showed an empty form. | "Sale ready for payment" card with **Show sale QR**, for the newest sale (≤30 min) that a finalized read shows `OPEN` and unexpired. Declined, discarded, missing, paid or expired sales never show it. | `26eb6ef` |
| 5 | Medium (UX) | **Hidden digits while typing an amount.** Past ~8 characters the amount input scrolled sideways (at 360 px `123456789.1234…` showed only `…39123456`). It is shared with personal requests. | Font and `NEAR` suffix step down by length. A full 24-decimal value is fully visible at 360/390/430 px (`scrollWidth == clientWidth` measured). | `84168ac` |
| 6 | Low (honesty) | **"Paid to"** appeared before any payment (POS chip, Handshake terms, demo). The checkout eyebrow **"Merchant on NEAR Testnet"** asserted merchant status for any account in the URL. | "Pay to"; "Payments go to this NEAR Testnet account" (TR likewise). A dictionary test guards both. | `8c7a311` |

No critical issue was found. No false paid or verified label, no account-binding
bypass and no scanner path that signs, creates or pays was found.

## Stage 2: why a second sale waits

- **Where the restriction lives:** a UI gate in `CreateRequest` (shared by
  `/request/new` and the POS). It is not `journal.begin` (which blocks only the
  same request/method/signer), the wallet lifecycle or request status.
- **What it blocks:** while any `create_request` by the connected account on the
  pinned contract is unexplained (`AWAITING_SIGNATURE`, `OUTCOME_UNKNOWN`, or
  `SUBMITTED` but not yet seen at a final block), a new creation is disabled.
- **Why it stays account-wide:** the screen cannot tell "a new sale" from "the
  same sale again because the wallet outcome was unknown". The frozen rule is
  never to allocate another intent on an unknown submission. A per-sale gate
  would let exactly that happen. **Kept unchanged.**
- **How long it lasts in practice:** with a returned hash, until the request is
  visible at a final block (normally a few seconds). The screen now re-checks by
  itself. Without a hash, or if the chain never shows it, the existing 2-minute
  hold applies. After that the merchant may explicitly re-sign the **same** terms
  (same nonce and ID; it cannot be created twice) or discard it.
- **UX now:** the notice names the pending sale (exact amount and reference), says
  a new sale starts as soon as it is confirmed, says Taply re-checks
  automatically, and links to its status. After the hold it lists the three
  options. Nothing is stored beyond the existing journal, so the state survives
  reloads. There is no spinner: it is a text notice with a working link.

Regression tests (`merchant.test.tsx`, `creation-gate.test.ts`):

- The block shows the pending sale and its status link.
- It lifts with no reload once the fake chain confirms the sale, and offers Show sale QR. Still exactly one signature.
- Another account on the same device is not blocked.
- An account switch during review is never signed.
- Gate selection, the recent window and the bounded backoff are covered.

## Stage 3: QR security results

`lib/payments/__tests__/qr-security.test.ts`, 46 cases, all pass with **no parser change**.

| Input class | Result |
| --- | --- |
| Valid `/pay/{id}`, valid `/checkout/{account}` | Opens only this app's own `/pay/<id>` or read-only `/checkout/<account>` |
| Query/fragment: `amount`, `recipient`, `to`, `next=https://…`, `transactionHashes`, `errorCode` | Dropped; only the ID or account is kept |
| Equivalent spellings (uppercase scheme/host, `:443`, `/x/../`) | Same origin, same result |
| `/checkout/%2e%2e/pay/<id>` | Normalized by the URL parser to this app's `/pay/<id>`: the same as scanning that request's QR (chain-read review, wallet approval required). Never a merchant result. |
| Spoofed suffix host, Cyrillic homograph (punycode), trailing-dot host, `http://` downgrade, other port | `other_site` with the host named; never followed |
| Origin hidden in another host's path, `user@`/credentials | Rejected |
| `.near` / uppercase / percent-encoded / NUL / >64-char / leading-hyphen account, extra or empty segments, `//checkout` | Rejected (`invalid` or `invalid_merchant` with a message) |
| `javascript:`, `data:`, `intent://`, `taply://`, `near:`, `ftp:`, JSON, bare account, bidi/zero-width/newline, 5 000 chars | Rejected |
| Expired request | Opens `/pay/<id>`, which shows "This request expired" and no pay control (existing `payment-screen.test.tsx`, chain time) |
| Merchant QR "with an amount" | The amount is ignored; checkout shows no amount and asks no wallet (`checkout.test.tsx`: no `quote/create/pay` RPC, zero signatures) |

The Phase 6B camera lifecycle is unchanged; its 30 scanner tests pass. In the browser,
the scanner opened from checkout had focus inside the dialog and a live camera
track; Escape closed it and returned focus to "Scan sale QR".

## Stage 4: mobile QA

`scripts/phase7d-mobile-qa.mjs` (production Webpack build, Chromium 1248). It uses
an injected read-only account whose signing always throws, and allows only the
app and RPC hosts. Result: [`phase7d/qa.json`](phase7d/qa.json); screenshots:
`docs/screenshots/phase7d-qa/`.

| Check | Result |
| --- | --- |
| Wallet-disconnected `/merchant`, `/merchant/register`, `/merchant/setup` at 360/390/430/1280 | Connect prompt, 0 overflow |
| 64-char implicit account on hub, Store QR, POS, checkout (360, 430) | Full ID wraps on hub/QR/checkout and review; the POS form chip truncates with the full ID in `title` (non-decision chrome) |
| 24-decimal amount: form and review | Fully visible after fix 5; review wraps |
| Long Turkish reference on review | Wraps |
| Turkish at 360 px on merchant, POS, Store QR, checkout, demo | 0 overflow |
| Unnamed visible controls / targets under 44 px (main, header, nav) | 0 / 0 |
| Reduced motion | Checkout pulse `animation-name: none` (Phase 7 smoke) |
| RPC methods | `status`, `block`, `view_account`, `get_config`, `quote_create_request` only; no broadcast; no page errors |

Not measurable headlessly:

- The real iOS keyboard. The amount field is the first control and the shell pads the bottom by 7 rem plus the safe area.
- Notch and home-indicator safe areas (the shell uses `env(safe-area-inset-*)`; unchanged).
- VoiceOver/TalkBack reading.

These are on the device checklist.

## Stage 5: honesty boundaries (verified in source, tests and screenshots)

| Surface | What it is | What it never claims |
| --- | --- | --- |
| POS (`/merchant/register`) | A real signed Instant request through the existing flow | A verified merchant checkout. "Not a verified merchant checkout yet" is shown at review. |
| Store QR | Discovery link only, labelled on the card | That it is payable or contains an amount |
| Checkout | The exact account; "No verified name" | Merchant status, business identity or KYC |
| Handshake tile, `/s/[id]` | Inert / "not available yet" | Pairing, a code or terms |
| `/demo/handshake` | DEMO-stamped synthetic walkthrough through the real presenter | A wallet prompt, a network call or any paid state |
| Receipts | Verified Paid only from the existing independent verifier with a funding hash | Unchanged in this phase |

## Remaining issues

1. **Merchant-side Verified Paid needs the funding hash.** The merchant's phone
   sees "Paid per contract" from the contract. Verified Paid on that device needs
   the customer's verification link (`?ftx=`) or a future indexer/backend.
   This was already documented in Phase 6A and needs a backend.
2. `/pay/<id>` for a not-yet-visible creation offers "Resume this request" →
   `/request/new`, not the POS. It works (same gate, same draft) but leaves the
   merchant context. This is low impact and was left as is.
3. Root `pnpm check` on this branch still includes the near-client fixture
   failure until Codex's `6a34a94` is merged. Not edited here.
4. The POS form's "Pay to" chip truncates a 64-char implicit account. The full ID
   is on the hub, the review and the receipt.
5. No physical-device run in this phase.

## Physical iPhone POS test plan (ready)

1. **Merchant phone:** Merchant → New sale, 0.01 NEAR, reference. Review shows exact amount, "Pay to" account and storage bond. Approve in the wallet.
2. If the wallet redirects back to the POS: expect "Sale ready for payment" → Show sale QR. Otherwise it opens `/pay/<id>` directly.
3. Immediately start a second sale: expect "Waiting for the previous sale", clearing by itself within seconds.
4. **Customer phone:** scan the Store QR → checkout (no amount, no wallet) → Scan sale QR → `/pay/<id>` → approve → Verified Paid on the customer's phone.
5. **Merchant phone:** `/pay/<id>` shows "Paid per contract". Open the customer's verification link for Verified Paid.
6. Decline in the wallet once: nothing is created; the next sale is not blocked.
7. Test with VoiceOver, large text and both orientations, and confirm the camera indicator turns off after each scan.
