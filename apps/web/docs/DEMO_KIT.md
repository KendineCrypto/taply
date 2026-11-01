# Taply — hackathon demo kit (NEAR Hackathon, deadline 2026-11-14)

**Tagline: "Your wallet. Your payment. One tap."**

Everything needed to record and present Taply. **Honesty rules for every asset:**

- The `/demo` tour runs on deterministic DEMO data and says so on every screen.
  Never crop the DEMO markers out of a recording.
- The **Taply Wallet** (a Taply-controlled wallet) appears only in the tour, as a
  labelled design preview. In this build Taply connects your **existing**
  NEAR Testnet wallet; creating, restoring and unlocking a Taply Wallet are shown
  as "Not available yet".
- Sending and paying are not signed in this build (signing is off; there is no
  direct-transfer signer yet). Do not present the demo receipt or the demo
  "Sent" screen as real Testnet transactions. Show a real Verified Paid receipt
  only after the Testnet pilot has produced one with evidence (`docs/EVIDENCE.md`).

## 1. Screenshots (real app, Playwright, production build)

All in [`screenshots/wallet/`](screenshots/wallet/), 390 px (EN and TR) plus
desktop. Captured with reduced motion; nothing is retouched.

| File | Screen |
|---|---|
| `01-home-*` | Real home, not connected: "Your wallet. Your payment. One tap.", connect, Send/Receive/Request |
| `02-wallet-onboarding-*` | Real `/wallet`: Connect existing wallet (available), Create/Restore Taply Wallet (not available yet) |
| `03-wallet-create-explained-*` | Why Taply Wallet is not available yet, with the way forward |
| `04-send-connect-*` | Real `/send` before connecting |
| `05-tour-wallet-home-*` | Tour 1: Taply Wallet home (DEMO): account, balance, actions, activity |
| `06-tour-receive-*` | Tour 2: receive ticket with QR and the Testnet-only warning |
| `07-tour-send-review-*` / `08-tour-send-sent-*` | Tour 3: send review and the "Sent" result (DEMO) |
| `09-tour-create-*` / `10-tour-share-*` | Tour 4–5: create a request, share ticket with QR |
| `11-tour-review-*` | Tour 6: payer review with confirmation |
| `12-tour-verified-*` / `13-tour-receipt-*` | Tour 7–8: Verified Paid progress and receipt (DEMO, synthetic references) |

Earlier Phase 3B captures remain in [`screenshots/`](screenshots/).

## 2. Recording storyboard (45–60 s) — "Your wallet. Your payment. One tap."

Record the deployed build on a phone (or Chrome device mode, 390 × 844),
opening `/demo`. The DEMO badge must stay visible in tour shots.

| # | Time | Picture | On-screen text | Voiceover |
|---|---|---|---|---|
| 1 | 0–5 s | Chat bubbles: "which wallet?", "send your address?", "how much again?" | *Getting paid shouldn't take five messages.* | Getting paid in crypto still takes too many steps. |
| 2 | 5–11 s | Taply home on the phone: tagline, lime **Connect wallet** | **Your wallet.** | Taply starts with your wallet. Connect the NEAR wallet you already have; your keys never leave it. |
| 3 | 11–17 s | Tour 1: wallet home — account, balance, Send / Receive / Request | **Your wallet.** | Your account, your balance, and the three things you do: send, receive, request. |
| 4 | 17–23 s | Tour 2: receive ticket, QR, Testnet-only warning | | Receiving is one QR code, with a clear warning about the network. |
| 5 | 23–30 s | Tour 3: send review — recipient checked, exact amount, network | *Exact amount. Full account.* | Sending shows the full account and the exact amount before your wallet signs. |
| 6 | 30–38 s | Tour 4–5: type 12.5 → the cream request ticket with QR rises in | **Your payment.** | Need to get paid? Type an amount. Taply turns it into one link and one QR. |
| 7 | 38–47 s | Tour 6–7: payer ticks the check, taps approve; progress runs to Verified Paid | **One tap.** | The payer reviews and approves with one tap. Every state is shown honestly: paid per contract is not the same as verified. |
| 8 | 47–54 s | Tour 8: receipt seal, amount, references, DEMO stamp visible | *Verified only with on-chain receipts.* | Verified Paid appears only when the receipts on chain prove it. |
| 9 | 54–60 s | Night background, `taply.` wordmark, lime dot | **Your wallet. Your payment. One tap.** · NEAR Testnet | Taply. Your wallet. Your payment. One tap. |

When a real pilot payment exists, replace scenes 7–8 with that screen recording
and its evidence JSON, never with the demo.

## 3. Voiceover script (English, ~140 words, ~55 s)

> Getting paid in crypto still takes too many steps.
>
> Taply starts with your wallet. Connect the NEAR wallet you already have; your
> keys never leave it.
>
> Your account, your balance, and the three things you do: send, receive,
> request.
>
> Receiving is one QR code. Sending shows the full account and the exact amount
> before your wallet signs.
>
> Need to get paid? Type an amount. Taply turns it into one link and one QR.
>
> The payer reviews and approves with one tap. Every state is shown honestly:
> paid per contract is not the same as verified.
>
> Verified Paid appears only when the receipts on chain prove it.
>
> Taply. Your wallet. Your payment. One tap.

## 4. Judge walkthrough (exact steps, ~2 minutes, no wallet needed)

1. Open the app on a phone (or a desktop browser at 390 px width). The header
   always shows **NEAR Testnet**.
2. Home shows the tagline and **Connect wallet**. Tap **Wallet and account** to
   see onboarding: *Connect existing wallet* works; *Create* and *Restore Taply
   Wallet* say **Not available yet** and explain why.
3. Open the tour: tap **See a full payment in 60 seconds** on Home, or open `/demo`.
4. **1 Your wallet** (DEMO): account, balance, Send / Receive / Request, recent
   activity. Tap **Receive**.
5. **2 Receive:** account ticket with QR, copy, Testnet-only warning. **Next**.
6. **3 Send:** review shows recipient, exact amount, network and fee. Tap
   **Confirm and send (demo)**, then use **Show result** to compare Sending,
   Sent, Transfer failed and Result unknown.
7. **4 Create:** change the amount (for example `25`), note the storage bond and
   that Taply adds no fee, then **Create request (demo)**.
8. **5 Share:** ticket with amount, full recipient, QR and the same link in text.
   Scanning the QR on another phone opens the tour at the review step.
9. **6 Review:** tick the check, then **Approve in wallet (demo)**.
10. **7 Progress:** watch it run, then use **Show state** for *Paid per contract*,
    *Verified Paid*, *Transfer failed — recoverable* and *Transfer unresolved*.
11. **8 Receipt:** seal, exact amount, parties, references; stamped DEMO, no
    explorer links because the references are synthetic.
12. Optional: Settings → Language → Türkçe, and repeat.

Real (non-demo) screens: `/` and `/wallet` (connect a Testnet wallet to see the
real balance and identity), `/receive`, `/send` (prepare and review; confirming is
unavailable in this build), `/request/new`, `/pay/<id>`, `/receipt/<id>`.

## 5. Draft launch post for X (not posted)

> Your wallet. Your payment. One tap.
>
> Meet **taply.** — a payments app for @NEARProtocol:
>
> → connect the NEAR wallet you already have
> → send, receive, or request with one link or QR
> → the payer sees the full account and exact amount before signing
> → "paid per contract" ≠ "verified" — Verified Paid only when on-chain receipts prove it
>
> On NEAR Testnet · built for the NEAR Hackathon
> 60-second tour: <link>
>
> #NEAR #NEARHackathon

Before posting: replace `<link>`, confirm the handle, and do not claim mainnet,
real funds, a native Taply Wallet or completed Testnet payments unless
`docs/EVIDENCE.md` records them.
