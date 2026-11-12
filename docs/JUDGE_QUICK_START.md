# Judge quick start (updated 2026-11-12)

**Taply is live at [https://taplyapp.xyz](https://taplyapp.xyz) on NEAR
Testnet with payments on.** You need no wallet and no funds of your own: the
app can create a real `username.testnet` account with free test NEAR from the
public faucet. Everything uses test tokens with no real value.

## 0. Two minutes, no wallet

The [README](../README.md#check-it-in-2-minutes-no-wallet-needed) lists five links
you can open without signing: two **Verified Paid** receipts checked live in
your browser, a refunded and a released Protected Pay request, the escrow
contract with no access keys, and the synthetic demo.

## 1. Full flow in the browser (about 5 minutes)

Use a phone, or a desktop browser at about 390 × 844. For the two-phone part,
use a second browser or a private window as the "customer".

| Step | Do | Expect |
| --- | --- | --- |
| 1 | Open [taplyapp.xyz](https://taplyapp.xyz) | **Welcome to Taply**: *Connect an existing wallet* or *Create a Taply Wallet*. NEAR Testnet pill, English by default. |
| 2 | **Choose a username** → accept → name → password (8+ characters) | The 12-word **Secret Recovery Phrase**, hidden until tapped. Then "*name*.testnet is live on NEAR Testnet", confirmed by a final chain read, with 10 test NEAR. The wallet stays unlocked on this device until **Lock now**. |
| 3 | Tap **Request**, enter `0.05`, **Continue**, **Create request in wallet** | The review shows amount, recipient, deadline and cost (storage deposit + network fee). Taply's **Confirm transaction** dialog shows exactly what will be signed. After Confirm: the request page with QR, sale code and a **Live session** card ("Waiting for the customer to scan"). |
| 4 | **Copy link**, open it in the second browser, create a second wallet there | Both phones show **Live session**: merchant *Online*, customer *Reviewing the payment*, and the **same sale code**. The join secret disappears from the customer's URL. |
| 5 | Close the customer tab, then reopen `taplyapp.xyz/s/<room>` | The merchant sees *Disconnected · last seen N s ago*, then *Customer reconnected*. A third browser opening the original link is refused ("already joined"). |
| 6 | On the customer phone, tick the check box → **Approve in wallet** → **Confirm** | Both phones move to **Payment recorded**, read from the chain (never from the live session). The payer's phone opens the receipt by itself; the merchant taps **Verify receipt**. On both, the independent verifier reaches **Verified Paid**; the merchant's Taply Wallet balance shows the extra 0.05 NEAR without a reload. |
| 7 | Optional: on a new request, choose **USDC** (or USDT, NST, LNC, PEM) under *Pay with* | Enable → Get test USDC → Convert → Pay, each with its own confirmation. The merchant still receives exactly the NEAR requested. |
| 8 | **Protected Pay:** tap the centre **Tap** button → **New Protected request**, enter `0.05`, keep **60 seconds**, create it; open its link in the second browser, tick the box and **Lock payment in wallet** | Both screens say **LOCKED - NOT PAID** with a countdown. Before it ends, **Cancel and refund me** returns the amount to the payer (`CANCELLED_REFUNDED`); after it, **Release to recipient** pays the recipient (`FINAL_PAID`). A refund is never shown as a payment. The escrow contract is not audited. |
| 9 | Optional: Settings → **Türkçe** | The whole app in Turkish; the choice persists. |

Already have a NEAR Testnet wallet (Meteor, HERE, MyNearWallet…)? Choose
**Connect wallet** in step 1 instead; your wallet signs, Taply never sees its key.

## 2. Things you can open without signing

| Open | Expect |
| --- | --- |
| [Pilot sale](https://taplyapp.xyz/pay/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502) | The first real payment (2026-11-01), read now from `taply-pay-pilot-1.testnet`: 0.1 NEAR to `taplytest.testnet`, sale code `KED 5E9`, **Payment recorded · Awaiting verification** (the contract's word; the receipt below is the independent check). |
| [Pilot receipt](https://taplyapp.xyz/receipt/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502?ftx=CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su) | The verifier re-checks funding, transfer and callback receipts, code hash and keys: **Verified Paid**. If a public RPC is busy it says so and shows the 2026-11-01 result as **"Archived record · not a live check"**, never as a fresh verification. |
| [taplyapp.xyz/demo](https://taplyapp.xyz/demo) | The whole journey with synthetic data, **DEMO** on every screen. Nothing touches the chain. |

## 3. What is real, what is synthetic

| Screen | Data |
| --- | --- |
| Wallet, balances, `/request/new`, `/pay/<id>`, `/receipt/<id>`, `/checkout/<account>` | **Real NEAR Testnet**: read live, signed by your wallet |
| `/s/<room>` live session | **Real** presence via the room service (Upstash Redis); payment status still comes from the chain |
| `/evidence/instant-pay-2026-11-01-receipt.json` | **Archived** verifier output from 2026-11-01 |
| `/demo`, `/demo/handshake` | **Synthetic DEMO** |
| `/contacts`, `/recurring`, `/split` | Tools stored on your device; Split and Recurring only pre-fill normal requests |

## 4. Locally (about 5 minutes plus install)

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
# set NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=on in .env.local to sign like taplyapp.xyz
pnpm --filter @taply/web build && pnpm --filter @taply/web start
```

Then repeat section 1 on `http://localhost:3000`. Live Handshake needs a
Redis REST endpoint; see "Live Handshake locally" in the [README](../README.md#run-it-locally).
Contract (Rust/WASM/sandbox) checks run in the `instant-pay-sandbox` GitHub
workflow.

## 5. Evidence and limits

- What is proven where (CI, Testnet, production browser) and what is not:
  [VERIFICATION_MATRIX.md](VERIFICATION_MATRIX.md).
- [Proof ledger](EVIDENCE.md), the [archived verifier JSON](evidence/instant-pay-2026-11-01-receipt.json)
  and the production browser runs for [onboarding](evidence/production-2026-11-09-onboarding/),
  [Taply Wallet payments](evidence/production-taply-wallet-2026-11-09/),
  [Live Handshake](evidence/production-live-handshake-2026-11-10/),
  [Protected Pay](evidence/production-protected-pay-2026-11-11/) and the
  [2026-11-11 regression on the current build](evidence/production-regression-2026-11-11/)
  (including a live **Verified Paid** check).
- Known open risk **R-2 (High impact, no known user path)**: a transfer that
  succeeds while its callback fails stays in flight with no retry. Nothing is
  paid twice and the app never calls it paid. Reachability evidence and the
  three design options: [R2_REACHABILITY.md](R2_REACHABILITY.md); the
  [review](SECURITY_REVIEW_2026-11-09.md).
- Testnet only, not audited. Taply Wallet has not had an independent security
  review; it is on for Testnet by the owner's decision. Contract-bound merchant sessions are off; the Protected Pay escrow contract
  is not audited. Android was checked with Chromium's Pixel 7 emulation, not on
  a physical device.
- If an RPC answers `429` or times out, the app keeps the uncertain result and
  signs nothing. Retry later; never pay again to make a demo succeed.
