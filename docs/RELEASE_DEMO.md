# Final judge demo — screenshots, 60-second recording and X post

Nothing here has been recorded, posted or submitted. A human records, edits,
publishes and submits. Every DEMO screen is synthetic; no new chain payment is
needed or authorized. Frames live in
[`apps/web/docs/screenshots/final/`](../apps/web/docs/screenshots/final/)
(offline production build, 2026-11-06, every external request blocked).

> **Superseded on 2026-11-11.** This shot list was written while taplyapp.xyz was a
> read-only build (2026-11-06/09). Since then payments are signed on the live site
> (Instant Pay, Taply Wallet, other-asset pay), the live two-phone Handshake is on and
> Protected Pay is on (Testnet, escrow not audited). For what the video may claim use
> "What is live today" and the "Video" section of
> [HACKATHON_SUBMISSION_PACKAGE.md](HACKATHON_SUBMISSION_PACKAGE.md); the current
> status of every feature is in [VERIFICATION_MATRIX.md](VERIFICATION_MATRIX.md).
> The DEMO walkthrough below still works and stays stamped DEMO.

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

1. Open https://taplyapp.xyz in a fresh private window (English by default).
2. Browser at 390 × 844 (device toolbar), reduced motion on, notifications off,
   zoom 100 %. Close other tabs; hide bookmarks bar.
3. Open the pilot sale once to confirm the RPC answers. If it is throttled, use
   the fallback in the 34–46 s scene.
4. A local production build (README "Run it locally") works the same way.

| Sec | Do | Say (voice or caption) | Must be visible |
| --- | --- | --- | --- |
| 0–6 | Open `/` | "At a counter, a sent transaction is not proof the shop was paid." | Taply logo, NEAR Testnet pill |
| 6–14 | `/demo?step=create`, then type `/demo?step=review` in the address bar | "The merchant creates one on-chain request per sale." | DEMO badge. Show the Share step only if its link reads `https://taplyapp.xyz` |
| 14–24 | On review, tick the check, tap Approve (demo) | "The payer sees the exact amount, account and contract, then approves in their own wallet." | DEMO badge; caption "Synthetic walkthrough — no transaction sent" |
| 24–34 | `progress`, then `receipt` | "Paid per contract and Verified Paid are different. Verified needs the funding, transfer and callback receipts." | DEMO badge on the receipt |
| 34–46 | `/pay/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502`, then its receipt | "This is a real 0.1 NEAR Testnet sale from 1 November, read from the contract right now." | Caption "Historical pilot payment, 1 Nov 2026". Show Verified Paid only if the live check succeeds. **Fallback:** show [the archived verifier JSON](evidence/instant-pay-2026-11-01-receipt.json) with caption "Archived verification, 1 Nov 2026" |
| 46–53 | Cut to `en-fixture-unresolved-390.png` | "If the wallet result is unclear, even a 'declined', Taply blocks paying again until the chain explains it." | Caption "Synthetic UI state" |
| 53–60 | README status section | "NEAR Testnet only. Live at taplyapp.xyz, open source on GitHub. Not audited." *(Was: "payment signing, Handshake and Protected Pay are switched off"; true on 2026-11-09, no longer true.)* | `https://taplyapp.xyz` and the repository URL |

Never: fake a network read or a "paid" screen, show a wallet seed or key, call the
sale code merchant authentication, or call the escrow contract audited. (A new real
Testnet payment recorded on the live site is fine since 2026-11-11.)

### Screenshot fallback

Q-012, verbatim: "Yes: public repo, reproducible README, X post with a video;
screenshots are not enough when judges cannot open the demo." Since 2026-11-09
judges can open the demo at https://taplyapp.xyz, so screenshots are acceptable;
the video is still preferred. Keep the site up through 2026-11-18 (ideally
2026-11-25).

## 3. X post — human edits and publishes

The current draft (with the live link and a clarifying reply) is in
[HACKATHON_SUBMISSION_PACKAGE.md](HACKATHON_SUBMISSION_PACKAGE.md). The
2026-11-06 drafts that pointed only to GitHub are kept in Git history.

Before posting: the links must open logged-out, the video or the four
screenshots must be attached, and the post must not claim mainnet, an audit,
live payment signing, live Handshake or Protected Pay.
