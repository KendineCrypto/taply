# Judge quick start (updated 2026-11-09)

No wallet, seed phrase or funds needed. **Taply is live at
[https://taplyapp.xyz](https://taplyapp.xyz) as a public, read-only NEAR Testnet
build: payment signing is off on the public site.** The real 0.1 NEAR Testnet
payment from 2026-11-01 can be re-read and re-verified live.

## 1. In the browser (2 minutes)

Use a phone, or a desktop browser at about 390 × 844.

| Step | Open | Expect |
| --- | --- | --- |
| 1 | [taplyapp.xyz](https://taplyapp.xyz) | English home, NEAR Testnet pill, **Connect wallet**. No login page. |
| 2 | [taplyapp.xyz/demo](https://taplyapp.xyz/demo) | The whole payment journey with a **DEMO** stamp on every screen. Synthetic: nothing is read from or sent to the chain. |
| 3 | [Pilot sale](https://taplyapp.xyz/pay/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502) | Read now from `taply-pay-pilot-1.testnet` at a finalized block: 0.1 NEAR to `taplytest.testnet`, sale code `KED 5E9`, **Paid per contract**. |
| 4 | [Pilot receipt](https://taplyapp.xyz/receipt/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502?ftx=CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su) | The verifier re-checks funding, transfer and callback receipts, code hash and keys: **Verified Paid**. If a public RPC is busy it says so, and the 2026-11-01 result appears as **"Archived record · not a live check"**, never as a fresh verification. |
| 5 | Settings → Türkçe | Turkish everywhere; reload keeps it. English is the default for first visits. |

Optional, with any NEAR Testnet wallet (Meteor, HERE, MyNearWallet…): connect,
tap **Request**, enter an amount, **Continue**. The review shows amount,
recipient, deadline and the real cost (non-refundable storage deposit; the
wallet shows the network fee). **Create request in wallet** is disabled with
"Payments not enabled yet". Nothing can be signed on the public site.

## 2. What is real, what is synthetic

| Screen | Data |
| --- | --- |
| `/pay/<id>`, `/receipt/<id>`, `/checkout/<account>`, wallet balance | **Real Testnet**, read live |
| `/evidence/instant-pay-2026-11-01-receipt.json` | **Archived** verifier output from 2026-11-01 |
| `/demo`, `/demo/handshake` | **Synthetic DEMO** |
| `/contacts`, `/recurring`, `/split` | Local tools on your device; Split and Recurring only pre-fill normal requests |

## 3. Locally (about 5 minutes plus install)

Node **24.22.2**, pnpm **11.5.0**. Install needs package access; the build may
fetch Google Fonts.

```sh
git clone https://github.com/KendineCrypto/taply.git
cd taply
git rev-parse HEAD                     # record the commit you judged (main = release/taplyapp)
pnpm install --frozen-lockfile
pnpm check                             # brand, build, types, lint, all workspace tests
node --test apps/api/test/*.test.mts   # standalone API tests (CI runs these too)
cp apps/web/env/public-readonly.env.example apps/web/.env.local
pnpm --filter @taply/web build && pnpm --filter @taply/web start
```

Then repeat section 1 on `http://localhost:3000`. Contract (Rust/WASM/sandbox)
checks run in the `instant-pay-sandbox` GitHub workflow.

## 4. Evidence and limits

- [Proof ledger](EVIDENCE.md) and the [archived verifier JSON](evidence/instant-pay-2026-11-01-receipt.json).
- [Nightly release report 2026-11-09](NIGHTLY_RELEASE_REPORT_2026-11-09.md): production deployment, CI runs, browser results and what is still open.
- Public signing stays off until a fresh owner-signed acceptance run
  ([plan](TESTNET_ACCEPTANCE_PLAN.md)). Handshake (G2) and Protected Pay are
  disabled. Not audited. Android is untested on a physical device.
- If an RPC answers `429` or times out, the app keeps the uncertain result and
  signs nothing. Retry later; never pay again to make a demo succeed.
