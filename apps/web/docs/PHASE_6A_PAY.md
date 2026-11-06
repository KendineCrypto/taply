# Phase 6A: premium Pay entry, QR scanner, shareable QR origin, mobile receipt evidence

`apps/web` only, plus one dependency (see "Coordination"). No contract, code
hash, near-client or shared change. Native Taply Wallet signing stays OFF. No
transaction was sent and nothing was deployed. No physical-device testing was done.

## What changed

| Task | Change | Files |
| --- | --- | --- |
| 1. Pay entry | Tap → Pay shows exactly two choices: **Pay with link** (link or bare request ID) and **Scan QR**. `/scan` (was "coming soon") shows the same two choices; visiting it does not open the camera. | `components/scan/PayEntry.tsx`, `components/shell/AppShell.tsx`, `app/scan/page.tsx` |
| 2. Scanner | Full-screen top-layer `<dialog>`: night background, rounded viewport, four lime corner brackets, slow beam, faint glow, status pill, 240–280 ms transitions. **Real camera** (`getUserMedia`, rear camera preferred, no audio), requested only after "Scan QR". Decoding on device: `BarcodeDetector` when it supports `qr_code`, else bundled **jsQR**, loaded on demand (centre square, ≤640 px). No frames leave the device. Tracks stop on close, unmount, success, page hidden or `pagehide` (resume is an explicit button), and when a permission prompt resolves after close. Handles denied / no camera / busy / insecure (HTTP) / unsupported / decoder load failure, invalid QR and other-site links. "Paste a link instead" is always visible. On success: stop camera, short success animation (none with reduced motion), then `/pay/<id>`. Nothing is signed. | `components/scan/QrScanner.tsx`, `lib/qr/camera.ts`, `lib/qr/decoder.ts`, `app/globals.css`, `lib/hooks/browser.ts` |
| Parsing | `parsePayInput`: bare 64-hex ID, or `http(s)` `/pay/<id>` whose origin is **this app's origin or the configured share origin**. Query and fragment are dropped (no amount, recipient or `transactionHashes` survive). Credentials, control, zero-width and bidi characters, other schemes and oversize input are rejected. Another site's pay link is named (`other_site`), never opened. | `lib/payments/pay-link.ts` |
| 3. Share origin | `NEXT_PUBLIC_TAPLY_SHARE_ORIGIN` (optional, validated): HTTPS only, DNS name with a dot, no IP literals, no localhost / `.local` / `.internal` / other private-use names, origin only. Order: valid configured origin → page origin if valid (production) → none. QR, copy and native share use one `canonicalPayUrl`. Without one, the pay screen shows an honest notice and the bare request ID (works with Pay with link) instead of a QR. The receipt's verification link uses the same origin, or is hidden. No hardcoded hostnames. The origin only builds links; the app never navigates to it. | `lib/share/origin.ts`, `lib/share/use-share-origin.ts`, `PaymentScreen.tsx`, `PaymentParts.tsx` (`ShareUnavailable`), `ReceiptScreen.tsx`, `.env.example`, `env.d.ts` |
| 4. Mobile receipt | **Root cause found (reproduced in tests):** after a wallet redirect, if the first `tx_status` lookup cannot see the returned hash yet, the return is retried 5 s later. Meanwhile the pay screen sees FINAL_PAID and marks the hash-less attempt RESOLVED, and the retry then dropped the hash because only unresolved entries were candidates. **Fix:** returned hashes may bind to hash-less RESOLVED entries (still only after the chain confirms signer, contract, method and request ID), and RESOLVED is now sticky: a late update only attaches a hash and never re-blocks. **Follow-up:** when this device's own funding attempt (≤30 min old) reaches FINAL_PAID, the pay screen opens `/receipt/<id>?ftx=<hash>` once per attempt per tab, waiting while a returned hash is still being matched. The "View receipt" button carries the same hint. The verifier then runs by itself. The receipt says "Matching…" while a return is pending, "Your wallet did not return the transaction reference" when this device paid without a hash, and keeps the cross-device message otherwise. Wallets answering with a one-item outcome list are read too. | `lib/payments/wallet-return.ts`, `lib/payments/journal.ts`, `lib/payments/follow-up.ts`, `lib/payments/context.tsx` (`walletReturnsPending`), `PaymentScreen.tsx`, `ReceiptScreen.tsx`, `lib/wallet/adapter.ts` |
| i18n | EN + TR for every new string (`oneTap.payEntry`, `scanner`, `shareOrigin`, `receiptEvidence`, `payLink.otherSite`). | `lib/i18n/*` |

Unchanged: One-Tap layout, Wallet / Tap / Activity navigation, pinned contract and
code hash, finalized reads, stale-chain gate, journal / Web Lock, explicit wallet
review, all Verified Paid checks, no automatic retries or resubmission.

## Coordination

- **New dependency `jsqr@1.4.0`** (Apache-2.0, no transitive deps) in `apps/web/package.json`. `pnpm-lock.yaml` gains 8 lines (importer entry and package). Needed for the requested bundled fallback (iOS Safari has no `BarcodeDetector`). It is loaded only when a scan starts without native support.
- The old `payLink()` in `lib/payments/create.ts` was removed (replaced by `canonicalPayUrl`). `/scan` no longer shows the handshake "coming soon" placeholder.

## Verification (2026-11-01, local Windows, Node 24.22.2, pnpm 11.5.0)

- `pnpm check` (root): exit 0. shared 92/92, near-client 158/158, web **486/486 in 39 files** (48 more than Phase 5C).
- `pnpm --filter @taply/web exec next build --webpack`: success.
- New tests: `share/origin` (9), `pay-link` (5, rewritten), `qr-scanner` (14), `qr/decoder` (3), `qr/roundtrip` (1: Taply's own QR → real jsQR → parser → same ID), `follow-up` (8), `mobile-receipt` (6), `wallet-return` (+3), `app-shell` (+2, Pay choices and camera requested only after Scan QR). The redirect-race test fails on the previous code and passes now.
- Real browser (Playwright, Chromium 1248, production build on `localhost:3102`, **fake camera** fed with Y4M clips of real QR codes, read-only, no wallet):
  - Pay sheet shows exactly "Pay with link" and "Scan QR".
  - Scanning a Taply pay link opened `/pay/<live pilot id>` in ~1.2 s via the bundled decoder (Windows Chromium has no BarcodeDetector). Constraints were `{audio:false, video:{facingMode:{ideal:'environment'}, …}}` and the camera track was `ended` after navigating. The pay page read "Paid per contract" from the live contract.
  - A Wi-Fi QR gave "That QR code is not a Taply payment request." and another host's pay link gave "…points to taply-pay.evil-site.net…". Neither navigated.
  - Hiding the page left 0 live tracks and showed "Camera paused". Close removed the dialog. Permission denied showed the fix, Try again and Paste link.
  - With reduced motion the beam's `animation-name` was `none`; without it, `taply-scan-beam`.
  - Live pilot receipt `/receipt/9b9a5724…?ftx=CrzQ57Jx…` still shows **Verified Paid**, with no verification link offered on localhost. Without the hint it shows the cross-device message.
- Screenshots: `docs/screenshots/phase6a-pay/` (360 / 390 / 430). The QR in them is the fake-camera clip.

## Remaining mobile limitations

1. **Not tested on physical iOS Safari or Android Chrome**, nor through a real HTTPS tunnel. Camera behaviour, autoplay, `BarcodeDetector` availability and the wallet redirect are verified only in Chromium with a fake camera and in jsdom.
2. **Camera needs HTTPS.** On `http://<LAN IP>` the scanner says so; use the HTTPS share origin or production.
3. **iOS may re-ask for camera permission** each time the scanner opens (Safari's per-session policy).
4. **The wallet may never return a hash** (popup flows where the page was suspended or reloaded, or a wallet that returns no outcome). The receipt then honestly stays "Paid per contract" ("Your wallet did not return the transaction reference"). Recovering the hash from chain history needs an indexer or archival scan, which is out of scope without authorization.
5. **Cross-device:** a payment made on another device still needs that device's verification link (`?ftx=`).
6. jsQR decodes on the main thread (≤640 px every 140 ms). This is fine on recent phones but may feel slower on low-end devices. A Web Worker is a possible later improvement.
7. The follow-up uses `sessionStorage` (per tab). A wallet redirect that opens a new tab follows up once in that tab.

## Manual acceptance steps

Setup: build with the pinned contract env as today. For a local pilot also set
`NEXT_PUBLIC_TAPLY_SHARE_ORIGIN=https://<your-https-tunnel-host>` (origin only) and
open the app on both phones **through that HTTPS address**.

1. **Share QR origin.**
   - On the computer, create a request, then open its pay page. The QR and the printed link start with the HTTPS share origin, not `localhost`. Copy link and Share give the same URL.
   - Unset the variable, rebuild and open via `http://localhost`. No QR appears, the notice "No shareable link from this address" shows, and the request ID can be copied.
2. **Pay with link.** On phone B: Tap → Pay → Pay with link.
   - Paste the link: it opens `/pay/<id>`.
   - Paste the bare ID: it opens too.
   - Paste `https://example.com/pay/<id>`: it is refused, naming the host.
3. **Scan QR.** On phone B: Tap → Pay → Scan QR.
   - The camera permission prompt appears only now, and the rear camera is used.
   - Point it at phone A's request QR: the lime check shows briefly, then the request opens.
   - Confirm the terms come from the contract and the wallet is not asked until you review and approve.
4. **Scanner edge cases.**
   - Scan a non-Taply QR (e.g. Wi-Fi): message shown, scanning continues.
   - Switch apps or lock the screen: the camera indicator turns off, "Resume camera" shows.
   - Close (X): the camera indicator turns off.
   - Deny permission: the explanation, Try again and "Paste a link instead" all work.
   - Turn on Reduce Motion (iOS) or Remove animations (Android): the beam is static.
5. **Mobile receipt.** On phone B, pay 0.01 NEAR Testnet with the mobile wallet and return to Taply.
   - After the contract reports FINAL_PAID, the receipt opens by itself with `?ftx=` and shows **Verified Paid** once receipts are checked.
   - If the wallet returned no hash, the receipt says so and stays "Paid per contract". It must not show Verified Paid.
6. **Cross-device.**
   - Open the same receipt on phone A without `?ftx=`: "Settlement proof not available on this device".
   - Open the verification link copied on phone B (HTTPS origin): Verified Paid.
