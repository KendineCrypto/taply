# NEAR HACKATHON submission package (updated 2026-11-11, not posted, not submitted)

Only the owner posts on X and submits the form. Nothing here has been
published. Rules re-read on 2026-11-09 from
[nearhackathon.com/HACKATHON.md](https://nearhackathon.com/HACKATHON.md);
recheck on submission day.

## Key facts

| Item | Value |
| --- | --- |
| Deadline | **2026-11-14 23:59 UTC** (repository public by then; judging from 2026-11-16, results by 2026-11-18) |
| Track | `realworld` (Real-World Money) |
| Repository (`projectUrl`) | https://github.com/KendineCrypto/taply (default branch `main` = released source) |
| Live app | https://taplyapp.xyz, NEAR Testnet, payments on (keep it up at least until 2026-11-18, ideally 2026-11-25) |
| `demoUrl` | URL of the published X post (with video or screenshots attached) |
| License | MIT, `LICENSE` + `NOTICE` in the repository root |
| AI disclosure | README "How it was built" (Claude Code, Codex) |
| Diff section (Q-003) | README "Hackathon": all commits are inside the window (first commit 2026-10-29) |

## What is live today (2026-11-11)

Every claim in the post, the video and the form must match this list.

- Onboarding: connect an external NEAR Testnet wallet, or pick a username and get a real `username.testnet` Taply Wallet with a 12-word phrase.
- Create a request and pay it, with an external wallet or Taply Wallet, on taplyapp.xyz.
- Pay a NEAR request with USDC, USDT, NST, LNC or PEM (test tokens, swapped to NEAR on Ref/Rhea Testnet first).
- Live Handshake: live two-phone session (online, reviewing, disconnect/reconnect, same sale code, expiry, single-phone join).
- Protected Pay: the payer locks the amount in an escrow contract, can cancel for a refund until the on-chain cutoff (1 minute to 1 hour), and after it the amount is released to the recipient. Proven with two Taply Wallets in a real browser (refund and release).
- Receipts verified on chain by both phones (Verified Paid); the 2026-11-01 pilot payment can be re-verified live.
- **Not live:** contract-bound merchant sessions, sponsored gas, social login. The escrow contract is not audited. Taply Wallet has no independent security review. Testnet only, not audited.

## X post (279/280 characters, X counts each link as 23)

> Built at NEAR HACKATHON: Taply turns a NEAR wallet into a point of sale. Pay in NEAR or USDC, or lock it with Protected Pay and cancel for a refund. Receipts come from the chain.
>
> Live (Testnet): https://taplyapp.xyz
> Code: https://github.com/KendineCrypto/taply
>
> @NEARProtocol #NEARHackathon

Reply in the same thread, so nobody mistakes what is live:

> Live today on NEAR Testnet: username wallets, on-chain requests, paying with NEAR or test tokens swapped on Ref, a live two-phone session and Protected Pay (escrow with a cancel window). "Paid" only comes from the chain. Testnet only, not audited.

Optional tags (allowed by the rules): @NearLegion, @NearBuilders.

Attach the 60-second video. If it fails to upload, attach four screenshots
(for example from [`docs/screenshots/`](screenshots/)); with a hosted demo,
screenshots are acceptable under Q-012. Check the post logged-out before
submitting its URL.

## Form fields

| Field | Value / rule |
| --- | --- |
| `requestId` | UUID generated once, reused on retries |
| `projectName` | `Taply` |
| `leadName` | Owner's real name (2–80 chars). Not filled here |
| `email` | Owner's email (≤160 chars). Not filled here |
| `size` | One of `1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+`. Owner decides |
| `tracks` | `["realworld"]` |
| `nearAddress` | Owner's **mainnet** prize account (`name.near` or 64-hex implicit). Unrelated to the Testnet app. Not filled here |
| `projectUrl` | `https://github.com/KendineCrypto/taply` |
| `demoUrl` | The X post URL |
| `idea` | Text below (1331 characters) |
| `consent` | `true` only after the owner reads the contact notice |

Never commit real personal values. On a 409, do not resubmit; use the
[request changes](https://nearhackathon.com/request-changes) page.

### `idea` (1678 characters, limit 2000)

Taply turns a NEAR wallet into a merchant point of sale where "paid" means verified on chain, not claimed by an app. A new user picks a username and gets a real username.testnet account with a standard 12-word recovery phrase in seconds, or connects an existing NEAR wallet. Each sale is one immutable on-chain payment request; its QR carries only the request ID, so the customer's phone reads the exact amount and receiving account from the contract. The merchant always asks for NEAR, and the customer may pay in NEAR or in another Testnet token (USDC, USDT and more) that Taply swaps to NEAR on Ref/Rhea first. The QR also opens a live two-phone session: both screens see each other online, the customer reviewing, disconnects and reconnects, the same sale code and the expiry, and a second phone with the same QR is refused. The session never decides payment status: both phones read it from the chain and independently verify the funding, transfer and callback receipts before showing "Verified Paid", which is kept distinct from "Paid per contract". For a payment that should be reversible, Protected Pay locks the amount in an escrow contract instead: the payer can cancel for a full refund until an on-chain cutoff (1 minute to 1 hour), after which it is released to the recipient; both screens say "locked, not paid" until then, and a refund gets its own receipt that never reads as a payment. Every Taply Wallet signature shows exactly what will be signed, and an unclear wallet result blocks a repeat payment until the chain explains it. Live on NEAR Testnet at https://taplyapp.xyz with real payments proven in real browsers. Testnet only, not audited, MIT licensed.

## Link checklist (all must open logged-out)

- [ ] https://taplyapp.xyz loads (no Vercel login), English, NEAR Testnet pill, **Welcome to Taply** on first visit
- [ ] Creating a username wallet works (faucet reachable) and a 0.05 NEAR request can be created and paid from a second browser
- [ ] The request page shows the **Live session** card
- [ ] https://taplyapp.xyz/demo shows the DEMO journey
- [ ] https://taplyapp.xyz/pay/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502 shows Paid per contract
- [ ] https://taplyapp.xyz/receipt/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502?ftx=CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su shows Verified Paid (or a labelled archive while an RPC is busy)
- [ ] https://github.com/KendineCrypto/taply opens on `main` with this README
- [ ] The X post shows the video (or screenshots) and both required tags
- [ ] The video's claims match "What is live today" above

## Video

No video file is in the repository, so its content could not be checked here.
Before posting, confirm frame by frame: DEMO screens keep their DEMO stamp;
nothing shows Protected Pay as live; no recovery phrase is readable (keep it
hidden or use a throwaway wallet), no key and no private URL (localhost,
Tailscale) appears. A good 60-second order: welcome → username wallet →
create request → second phone joins the live session → pay with USDC →
both phones show the receipt. Recording plan: [RELEASE_DEMO.md](RELEASE_DEMO.md).

## Q-015

If the owner submits another project, each README must name the other.
