# Taply — hackathon demo kit (NEAR Hackathon, deadline 2026-11-14)

Everything needed to record and present the product. **Honesty rules for every
asset:** the `/demo` tour runs on deterministic DEMO data and says so on every
screen. Do not cut the DEMO markers out of a recording, do not describe the
demo receipt as a real Testnet payment, and do not show "Verified Paid" from a
real payment until the Testnet pilot (`TESTNET_PILOT_RUNBOOK.md`) has produced
one with evidence. Signing is switched off in this build.

## 1. Screenshots (390 px phone, real app, Playwright)

All in [`screenshots/`](screenshots/). Captured from the production build with
`reducedMotion: reduce`; nothing is retouched.

| File | Screen |
|---|---|
| `01-home-en.png` | Home: balance hero (disconnected state), Request/Send, product-tour card |
| `02-tour-home-en.png` | Tour step 1: demo wallet balance |
| `03-create-en.png` | Tour step 2: amount entry, storage bond and fee information |
| `04-share-en.png` / `04-share-tr.png` | Tour step 3: request ticket with QR and link |
| `05-review-en.png` | Tour step 4: payer review with confirmation |
| `06-progress-transfer-en.png` | Transfer in progress |
| `06-progress-contract_paid-en.png` | Paid per contract (verification pending) |
| `06-progress-verified-en.png` | Verified Paid (DEMO) |
| `06-progress-failed-en.png` | Transfer failed, recoverable |
| `06-progress-unresolved-en.png` | Transfer unresolved |
| `07-receipt-en.png` / `07-receipt-tr.png` | Tour step 6: receipt (stamped DEMO, synthetic references) |

The QR codes in these captures encode a `localhost` tour link; on a deployed
build they encode that origin.

## 2. Recording storyboard (45–60 s)

Record the real app: a phone (or Chrome device mode at 390 × 844) on the
deployed build, opening `/demo`. Keep the DEMO badge visible in every shot.

| # | Time | Picture | On-screen text | Voiceover |
|---|---|---|---|---|
| 1 | 0–6 s | A chat thread: "send me your account?", "which network?", "how much again?" | *Getting paid shouldn't take five messages.* | Asking someone to pay you in crypto still takes too many steps. |
| 2 | 6–11 s | Phone wakes; Taply home with the hero balance and the lime **Request** button | **taply.** | This is Taply. Payment requests on NEAR, designed for people. |
| 3 | 11–20 s | `/demo?step=create`: type `12.5`; memo, expiry, storage bond visible; tap **Create request (demo)** | *You are the recipient. Nobody can swap the payee.* | Type an amount. You're the recipient, so the payee can't be swapped. |
| 4 | 20–27 s | Step 3: the cream request ticket rises in; QR and link; tap **Copy link** | *One link. One QR.* | Taply turns it into one link and one QR code. |
| 5 | 27–37 s | Step 4: full recipient, exact amount, network, wallet action; tick the check; tap **Approve in wallet (demo)** | *Exact amount. Full account. Before you sign.* | The payer sees the full account, the exact amount and what their wallet will do, before anything is signed. |
| 6 | 37–47 s | Step 5 auto-plays: Approve in wallet → Transfer in progress → Paid per contract → Verified Paid | *Observed ≠ verified.* | Every state is shown as it is. "Paid per contract" is not the same as verified, and Taply never blurs the two. |
| 7 | 47–54 s | Step 6: receipt seal, amount, references, DEMO stamp visible | *Verified only with on-chain receipts.* | Verified Paid appears only when the funding, transfer and confirmation receipts check out on chain. |
| 8 | 54–60 s | Night background, the `taply.` wordmark, lime dot | **Request. Share. Get paid. Verified.** · NEAR Testnet | Taply. Request, share, get paid, verified. |

Notes: scene 6 shows the demo's own state player, so call it out as the demo if
asked. When a real pilot payment exists, replace scenes 6–7 with that screen
recording and its evidence JSON, never with the demo.

## 3. Voiceover script (English, ~140 words, ~55 s)

> Asking someone to pay you in crypto still takes too many steps.
>
> This is Taply: payment requests on NEAR, designed for people.
>
> Type an amount. You're the recipient, so the payee can't be swapped.
>
> Taply turns it into one link and one QR code.
>
> The payer sees the full account, the exact amount and what their wallet will
> do, before anything is signed.
>
> Then every state is shown as it is. "Paid per contract" is not the same as
> verified, and Taply never blurs the two.
>
> Verified Paid appears only when the funding, transfer and confirmation
> receipts check out on chain.
>
> Taply. Request, share, get paid. Verified.

## 4. Judge walkthrough (exact steps, ~2 minutes, no wallet needed)

1. Open the app on a phone (or desktop browser at 390 px width). The header
   always shows **NEAR Testnet**.
2. On Home, tap **See a full payment in 60 seconds** (or open `/demo`).
3. **Step 1 – Your wallet:** demo balance, marked DEMO. Tap **Request**.
4. **Step 2 – Create:** change the amount (e.g. `25`). Note the storage bond and
   that Taply adds no fee. Tap **Create request (demo)**.
5. **Step 3 – Share:** the ticket shows your amount, the full recipient, a QR
   code and the same link in text. Tap **Copy link**. Scanning the QR on
   another phone opens the tour at the review step.
6. **Step 4 – Review:** tick *I checked the recipient account and the amount*,
   then **Approve in wallet (demo)**. In the real app this opens the payer's
   own wallet instead.
7. **Step 5 – Progress:** watch the automatic sequence, then use **Show state**
   to compare *Paid per contract*, *Verified Paid*, *Transfer failed —
   recoverable* and *Transfer unresolved*.
8. **Step 6 – Receipt:** seal, exact amount, parties, references. The receipt
   is stamped DEMO and has no explorer links because its references are synthetic.
9. Optional: **For reviewers: every payment state** shows the full status matrix
   for every role and assurance level.
10. Optional: switch to Turkish in **Settings → Language** and repeat.

The real (non-demo) screens are `/request/new`, `/pay/<id>` and
`/receipt/<id>`. They need a connected Testnet wallet and a deployed,
code-hash-pinned contract, and signing is off until the pilot is approved.

## 5. Draft launch post for X (not posted)

> Getting paid in crypto shouldn't take five messages.
>
> Meet **taply.** — payment requests on @NEARProtocol, built for people:
>
> → type an amount, share one link or QR
> → the payer sees the full account and exact amount before signing
> → every state shown honestly: "paid per contract" ≠ "verified"
> → Verified Paid only when on-chain receipts prove it
>
> Live on NEAR Testnet · built for the NEAR Hackathon
> Try the 60-second tour: <link>
>
> #NEAR #NEARHackathon

Before posting: replace `<link>` with the deployed URL, confirm the mention
handle, and do not claim mainnet, real funds or completed Testnet payments
unless `docs/EVIDENCE.md` records them.
