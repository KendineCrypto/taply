# Production regression on taplyapp.xyz — 2026-11-11

Real Chromium (Playwright) against **https://taplyapp.xyz**, real NEAR Testnet,
fresh disposable faucet accounts (new `name.testnet` Taply Wallets created
through the app in every run). No owner wallet, no mainnet.

**Build under test:** source `main` = `release/taplyapp` = `ce5e9e9` (PR #27
merged 07:10 UTC). At 07:22:49 UTC the live JavaScript contained PR #27's new
Protected Pay copy, the escrow contract ID and code hash. That is a content
match; taplyapp.xyz does not expose its Git commit. Every run below started
after that check.

| Run | UTC | Result | Files |
| --- | --- | --- | --- |
| Live Handshake: merchant creates a request in the app, customer joins from the QR link, same sale code, "Reviewing the payment", disconnect → "last seen", reconnect, third phone refused (`ALREADY_JOINED`), pay, both phones "Payment recorded" | 07:23–07:25 | PASS, `FINAL_PAID` | [handshake/](handshake/) (script: [`handshake-e2e.mjs`](../live-handshake-2026-11-10/handshake-e2e.mjs)) |
| Taply Wallet pays 0.2 NEAR in NEAR and 0.25 NEAR with test USDC (register → get USDC → convert → pay, five confirmation dialogs) | 07:25–07:27 | PASS, both `FINAL_PAID`, payout records exact. The USDC balance delta reads +0.0306 too high: the merchant's own create-request refund landed after the script's reading ([block-by-block explanation](pay-near-usdc/usdc-delta-explained.json)) | [pay-near-usdc/](pay-near-usdc/) (script: [`taply-wallet-pay-e2e.mjs`](../taply-wallet-signing-2026-11-09/taply-wallet-pay-e2e.mjs)) |
| Merchant QR sampled every 250 ms for 15 s, then fed to a second browser's camera; Taply's own scanner opens it | 07:32–07:33 | PASS: one QR value only (live link), scanner opened `/s/<room>`, merchant saw the customer reviewing, `FINAL_PAID` | [qr-scan/](qr-scan/) (script: [`qr-stable-e2e.mjs`](../qr-stable-2026-11-10/qr-stable-e2e.mjs)) |
| Pay 0.05 NEAR, receipt page, **Verified Paid**; reload; direct second `pay_instant_native` | 07:35–07:38 | PASS: the app opened the receipt by itself with the funding tx, **Verified Paid** from a live check (not the archived record), no Approve after reload, second payment refused `NOT_OPEN`, status still `FINAL_PAID` | [verified-paid/](verified-paid/) (script: [`verified-paid-e2e.mjs`](verified-paid/verified-paid-e2e.mjs)) |

Earlier runs the same morning (06:58–07:20) also passed, but some of them
overlapped the switch from `7c30061` to `ce5e9e9`, so only the runs above are
kept. One earlier attempt of the Verified Paid script failed only because it
waited for a "Check receipt" button; the current build opens the receipt
automatically, and the script now accepts both.

Room join secrets (`#j=…`) are redacted in the result files. Screenshots are
scaled to 1×.

Not covered here: external browser wallets (Meteor, HERE), declined or failed
signatures, RPC outages, physical phones. See
[VERIFICATION_MATRIX.md](../../VERIFICATION_MATRIX.md).

Re-run: `TAPLY_E2E_RPC=https://test.rpc.fastnear.com node <script> https://taplyapp.xyz <outDir> <playwright index.mjs> packages/near-client/testnet-e2e/lib.mjs`.
