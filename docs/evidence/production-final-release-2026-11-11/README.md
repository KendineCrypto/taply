# Final release on taplyapp.xyz: post-deploy check, 2026-11-11

Real Chromium (Playwright) against **https://taplyapp.xyz**, real NEAR Testnet,
fresh disposable faucet accounts created through the app in every run. No owner
wallet, no mainnet. Nothing was changed while testing.

**Build under test:** `release/taplyapp` was fast-forwarded from `ef71d5e` to
`5a7e587` (= `main`, PR #32) at 12:47:24 UTC. Forty seconds later the live site
served two new JavaScript chunks. One of them is the payments chunk, which contains the
`PaymentsProvider` code (`visibilitychange`, `stale_chain`, both contract IDs).
That is a content match; taplyapp.xyz does not expose its Git commit. Every run
below started after that check.

Deployed contracts were not touched. At block 277220375:
- `taply-pay-pilot-1.testnet` has code hash `BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`.
- `taply-e2e-ce38a238.testnet` has code hash `963iSEB8XFKeUMY1gmj5bCuA2JMVD55ksjdLfCwiPA84`.

| Check | UTC | Result | Files |
| --- | --- | --- | --- |
| Pay 0.05 NEAR, receipt, **Verified Paid**, reload, direct second `pay_instant_native` | 12:49–12:52 | PASS. The app opened the receipt itself; **Verified Paid** came from a live check; no Approve after reload; the second payment was refused with `NOT_OPEN`; status still `FINAL_PAID`; merchant +0.05 NEAR exactly | [verified-paid/](verified-paid/) (script: [`verified-paid-e2e.mjs`](../production-regression-2026-11-11/verified-paid/verified-paid-e2e.mjs)) |
| Merchant QR sampled every 250 ms for 15 s, then fed to a second browser's camera | 12:52–12:54 | PASS. One QR value only (the live link); Taply's scanner opened `/s/<room>`; the merchant saw the customer join; `FINAL_PAID`, payout `SUCCEEDED` for the exact amount | [qr-scan/](qr-scan/) (script: [`qr-stable-e2e.mjs`](../qr-stable-2026-11-10/qr-stable-e2e.mjs)) |
| Live Handshake: join, same sale code, reviewing, disconnect → "last seen", reconnect, third phone refused, pay | 12:54–12:56 | PASS. Third phone got `ALREADY_JOINED`; `FINAL_PAID`; both phones showed "Payment recorded" from the chain | [handshake/](handshake/) (script: [`handshake-e2e.mjs`](../live-handshake-2026-11-10/handshake-e2e.mjs)) |
| Protected Pay. A: lock → LOCKED - NOT PAID → payer cancels. B: lock → on-chain cutoff → recipient releases | 13:04–13:09 (third attempt; see note) | PASS. A ended `CANCELLED_REFUNDED`: recipient +0, no "paid" text while locked, and the recipient was offered no release or cancel. B ended `FINAL_PAID`: recipient +0.0494 NEAR net of gas, with no release button before the cutoff and no cancel after it | [protected-pay/](protected-pay/) |
| Create a wallet with a 12-word phrase, import it in a fresh browser | 13:15–13:16 | PASS. Same key imported; phrase not kept in storage; no backup file | [wallet-restore/](wallet-restore/) (script: [`phrase-e2e.mjs`](../onboarding-2026-11-09/phrase-e2e.mjs)) |
| Console errors on 14 routes at 390 px and 1280 px, fresh browser | 13:10–13:13 | No page errors. See the console error notes below | [console-check.json](console-check.json) ([script](console-check.mjs)) |

Console error notes:
- `/this-page-does-not-exist` logs its own 404. That is expected.
- `/receipt/<id>` opened on a device that did not pay has no funding transaction
  to start from. It scans public archival RPCs, and after about 30 requests the
  rate-limited answers fail in the browser (`net::ERR_FAILED`, shown as CORS). The page
  then shows "Payment recorded · Independent receipt check pending · Could not reach the
  RPC. Do not pay again" and retries by itself. It never shows Verified Paid.
- This limitation is already listed in the verification matrix. No receipt or
  verifier code changed in this release (`git diff ef71d5e 5a7e587` touches only
  `lib/payments/context.tsx` and tests).

The Protected Pay script here is the 2026-11-11 production script
(`../production-protected-pay-2026-11-11/protected-e2e.mjs`) with selectors updated
to the screen text from PR #27 (`14434e8`), which was already live before this
release:
- the consent label "I understand: locked, not paid…";
- the "Refunded / Not a payment" receipt;
- the "Payment released" receipt.

The first two attempts with the old text timed out on those labels only. In the second attempt the
chain and screen showed the correct refund.

Room join secrets (`#j=…`) are redacted. The recovery phrase and public key are
removed from `wallet-restore/result.json`. Screenshots are scaled to 1×. QR images that carry a
join secret are not included.

CI on `5a7e587`: `workspace-check` (push), `instant-pay-sandbox`,
`protected-pay-candidate`, `wallet-browser-check` (dispatch). All passed.
