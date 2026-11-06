# Final judge demo — 60-second script and X draft

Recording plan only; no video or post has been produced or published. Use the
[judge quick start](JUDGE_QUICK_START.md) with signing OFF (no env file needed
for scenes 1–3). Every DEMO scene is synthetic. No new chain payment is needed
or authorized. Reference frames are in
[`apps/web/docs/screenshots/final/`](../apps/web/docs/screenshots/final/).

## Before recording

1. `pnpm install --frozen-lockfile && pnpm check` on the judged commit.
2. `pnpm --filter @taply/web build && pnpm --filter @taply/web start`.
3. Phone-width browser window (390 px), reduced motion on, notifications off.
4. For scene 4 only: configure section B of the README (read-only pilot
   contract, `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=off`), rebuild, and check the
   pilot sale loads. If RPC is throttled, use the archived proof instead and say so.

## Shot list

| Sec | Shot | Reference frame | Narration / on-screen disclosure |
| --- | --- | --- | --- |
| 0–6 | Home | `en-home-390.png` | "At a counter, a sent transaction is not proof the merchant was paid." |
| 6–14 | `/demo`: merchant creates a sale, shares the QR | `en-demo-create-390.png`, `en-demo-share-390.png` | "One on-chain request per sale. The QR carries only its ID." Keep the DEMO badge in frame. |
| 14–24 | `/demo`: payer review | `en-demo-review-390.png` | "The payer sees the exact amount, account and contract, then approves in their own wallet." Overlay: "Synthetic walkthrough — no transaction sent." |
| 24–34 | `/demo`: processing, then receipt | `en-demo-progress-390.png`, `en-demo-receipt-390.png` | "Paid per contract and Verified Paid are different. Verified Paid needs the funding, transfer and callback receipts." |
| 34–46 | Real pilot sale `/pay/9b9a5724…4502`, then its receipt | (live read; see README section B) | "This is a real 0.1 NEAR Testnet sale from 1 Nov 2026, read from the contract now." Label: "Historical pilot: 1 Nov 2026." Show Verified Paid only if the verifier succeeds live; otherwise show the [archived JSON](evidence/instant-pay-2026-11-01-receipt.json) and say "archived verification, 1 Nov". |
| 46–53 | Uncertain-result card | `en-fixture-unresolved-390.png` | "If the wallet result is unclear, even a 'decline', Taply says so and blocks paying again until the chain explains it." Label: "Synthetic UI state." |
| 53–60 | README status table | — | "NEAR Testnet only. Instant Pay works on Testnet; iPhone acceptance and an independent review are still open. Handshake and Protected Pay are off." |

Rules for the edit: phone-width legible captures, no rapid explorer flashes,
DEMO markers and historical dates visible. Do not stage a new payment, fake a
network read, imply two authenticated live devices, or show Protected
refund/release as shipped. A fresh wallet recording needs separate human
approval and is not part of this plan.

## X draft — human edits and publishes

Primary (258 of 280 characters, counting the link as 23):

> A sent crypto transaction isn't proof a shop got paid. Taply, built for #NEARHackathon, shows each sale's exact terms and checks the payout receipts on NEAR Testnet before saying "Verified Paid". Testnet MVP, demo below. @NEARProtocol
> https://github.com/KendineCrypto/taply

Shorter alternative:

> Taply: merchant payments on NEAR Testnet where "paid" means the payout receipts checked out, not that a wallet said OK. Built for #NEARHackathon @NEARProtocol
> https://github.com/KendineCrypto/taply

Attach the 60-second video. Before posting: the linked repository must show the
judged branch with these docs, the video must separate DEMO UI from the
historical chain proof, and the post must be checked logged-out. Do not claim
mainnet, an audit, live Handshake or Protected Pay.
