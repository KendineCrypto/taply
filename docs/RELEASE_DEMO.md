# Final judge demo — screenshots, 60-second recording and X post

Nothing here has been recorded, posted or submitted. A human records, edits,
publishes and submits. Every DEMO screen is synthetic; no new chain payment is
needed or authorized. Frames live in
[`apps/web/docs/screenshots/final/`](../apps/web/docs/screenshots/final/)
(offline production build, 2026-11-06, every external request blocked).

## 1. Publication screenshot sequence

X allows four images per post. Use these four, in this order:

| # | File | Caption | Label |
| --- | --- | --- | --- |
| 1 | `en-home-390.png` | Connect any NEAR Testnet wallet. Your keys stay in your wallet. | Real UI, no data |
| 2 | `en-demo-review-390.png` | The payer sees the exact amount, account and contract before signing. | DEMO badge visible |
| 3 | `en-demo-receipt-390.png` | "Verified Paid" only after the payout receipts check out on chain. | DEMO badge visible |
| 4 | `en-fixture-unresolved-390.png` | Unclear wallet result? Taply says so and blocks paying twice. | "DEMO · Synthetic UI fixture" line visible |

Extended set (README, slides or a reply thread): `en-demo-create-390.png`,
`en-demo-progress-390.png`, `en-fixture-contract_paid-390.png`,
`en-fixture-verified-390.png`, `en-checkout-1280.png`,
`en-demo-receipt-1280.png`, `tr-demo-review-390.png` (Turkish).

Do not crop away the DEMO badge or the fixture label line. Do not use the
older `phase7i/*-demo-share-*` captures: their share link shows a loopback
address. The final set deliberately has no share-step capture for that reason.

## 2. 60-second screen recording

Setup (about 5 minutes, no wallet, no funds):

1. `pnpm install --frozen-lockfile && pnpm check` on the judged commit.
2. `pnpm --filter @taply/web build && pnpm --filter @taply/web start`.
3. Browser at 390 × 844 (device toolbar), reduced motion on, notifications off,
   zoom 100 %. Close other tabs; hide bookmarks bar.
4. Scene 4 only: configure README section B (read-only pilot contract,
   `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=off`), rebuild, and open the pilot sale
   once to confirm RPC answers. If it is throttled, use the fallback in scene 4.

| Sec | Do | Say (voice or caption) | Must be visible |
| --- | --- | --- | --- |
| 0–6 | Open `/` | "At a counter, a sent transaction is not proof the shop was paid." | Taply logo, NEAR Testnet pill |
| 6–14 | `/demo?step=create`, then type `/demo?step=review` in the address bar | "The merchant creates one on-chain request per sale." | DEMO badge. Skip the Share step: its link shows `localhost` |
| 14–24 | On review, tick the check, tap Approve (demo) | "The payer sees the exact amount, account and contract, then approves in their own wallet." | DEMO badge; caption "Synthetic walkthrough — no transaction sent" |
| 24–34 | `progress`, then `receipt` | "Paid per contract and Verified Paid are different. Verified needs the funding, transfer and callback receipts." | DEMO badge on the receipt |
| 34–46 | `/pay/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502`, then its receipt | "This is a real 0.1 NEAR Testnet sale from 1 November, read from the contract right now." | Caption "Historical pilot payment, 1 Nov 2026". Show Verified Paid only if the live check succeeds. **Fallback:** show [the archived verifier JSON](evidence/instant-pay-2026-11-01-receipt.json) with caption "Archived verification, 1 Nov 2026" |
| 46–53 | Cut to `en-fixture-unresolved-390.png` | "If the wallet result is unclear, even a 'declined', Taply blocks paying again until the chain explains it." | Caption "Synthetic UI state" |
| 53–60 | README status section | "NEAR Testnet only. Open source on GitHub. Handshake and Protected Pay are switched off." | Repository URL |

Never: stage a new payment, fake a network read, show a wallet seed or key,
imply two live authenticated phones, or show Protected Pay as shipped.

### Screenshot fallback

Q-012, verbatim: "Yes: public repo, reproducible README, X post with a video;
screenshots are not enough when judges cannot open the demo." Taply has no
hosted demo, so **the X post needs the video**. Screenshots are a fallback only
for these cases:

- the video upload fails at the last minute: post the four images from
  section 1, then reply with the video as soon as it uploads, and submit the
  post URL only once the video is attached;
- slides, README or a reply thread that supplements the video;
- if a separately approved public HTTPS demo goes live, screenshots alone
  become acceptable, but keep it up through 2026-11-18 (ideally 2026-11-25).

## 3. X post — human edits and publishes

Primary (251 of 280 characters, counting the link as 23):

> A sent crypto transaction isn't proof a shop got paid. Taply, built at NEAR HACKATHON for #NEARHackathon, shows each sale's exact terms and checks the payout receipts on NEAR Testnet before saying "Verified Paid". @NEARProtocol
> https://github.com/KendineCrypto/taply

Shorter alternative:

> Taply: merchant payments on NEAR Testnet where "paid" means the payout receipts checked out, not that a wallet said OK. Built at NEAR HACKATHON. #NEARHackathon @NEARProtocol
> https://github.com/KendineCrypto/taply

Before posting: the link must open the public repository with the judged
branch visible, the video or the four screenshots must be attached, and the
post must be checked logged-out. Do not claim mainnet, an audit, live
Handshake or Protected Pay. Optional extra tags: @NearLegion, @NearBuilders.
