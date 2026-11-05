# Taply: Phase 7G demo kit (hackathon video, teaser, judge walkthrough)

Prepared 2026-11-05 on `feature/phase7g-ux`. **Nothing here has been recorded,
published or submitted.** The human records, edits and posts. Every shot below
is labelled:

- **REAL**: real app, real NEAR Testnet, real wallet. Allowed as proof.
- **REAL (re-record)**: real flow that needs a fresh run by the operator (a new
  sale costs a real Testnet transaction and a human wallet approval).
- **DEMO**: `/demo` or `/demo/handshake`, synthetic, DEMO-stamped. Never shown
  as a real payment and never narrated as live.

The only transaction hash this kit cites is the archived pilot funding
transaction `CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su` (`docs/EVIDENCE.md`).
A new recording produces new hashes: read them from the app's receipt
(**Technical proof → Copy receipt evidence (JSON)**). Never type or invent one.

## Product promise and one-line story

> **Your wallet. Your payment. One tap.**

A merchant opens Taply POS and prepares a unique sale. The customer scans the
QR. Both phones show the same amount, the same receiving account and the same
sale code. The customer approves in their own wallet. The chain settles, and
each phone checks the receipt on chain by itself.

What NEAR does here, in one sentence: **a Taply contract on NEAR Testnet holds
the sale terms, pays the merchant atomically when the customer funds it, and
leaves receipts that any phone can check without trusting Taply's servers.**

## What is real today (say it), and what is not (don't)

| Capability | Status for the video |
| --- | --- |
| Instant Pay on `taply-pay-pilot-1.testnet` (native NEAR) | **REAL**, Testnet verified (`docs/EVIDENCE.md`) |
| Merchant POS: unique sale request signed by the merchant's wallet, sale QR | **REAL** (user-reported iPhone 13 run; re-record for the video) |
| Customer scan, immutable terms review, approval in an external Testnet wallet | **REAL** (user-reported iPhone 13 run; re-record) |
| Merchant phone moves to "Paid per contract" by itself (finalized chain reads) | **REAL** |
| Customer receipt: **Verified Paid** from funding, transfer and callback receipts | **REAL** |
| Merchant receipt: **Verified Paid without the customer's link** (Phase 7G locator) | **REAL**, browser-checked on the pilot payment (needs an RPC that still has the blocks) |
| Same six-character sale code on both phones | **REAL**, but it identifies the sale. It does **not** authenticate the merchant |
| Live Handshake (customer joined, live presence, comparison of a session code) | **DEMO only**. Not live, not on chain |
| Protected Pay (escrow, cancel, refund, release) | **Disabled**. Do not show or narrate |
| Taply-native wallet signing, social login, sponsored gas | **Disabled / research**. Do not show |
| Mainnet | Never. Testnet only |

Words to avoid: "live Handshake", "verified merchant", "instant settlement on
mainnet", "escrow", "refund", "audited", "secure custody". The sale code is a
"sale code", never a "security code" or "verification code".

## 1. 45–60 second product video storyboard

Total ≈ 55 s. Portrait phone captures, composed side by side on a dark-forest
(`#0B120E`) canvas. Lime only on Verified Paid moments.

| # | Time | Picture | On-screen text | Label |
| --- | --- | --- | --- | --- |
| 1 | 0–4 s | `taply.` logo on Night, from `brand/assets` (no re-drawn logo) | Your wallet. Your payment. One tap. | Brand |
| 2 | 4–9 s | Counter. Merchant phone: Merchant home → **New sale** | Accept NEAR at the counter | **REAL (re-record)** |
| 3 | 9–15 s | Merchant enters 0.1 NEAR, reviews, approves in wallet; sale QR appears with sale code and "Ready for customer" | One unique sale. Signed by the merchant | **REAL (re-record)** |
| 4 | 15–21 s | Customer phone scans the QR (real camera); review screen | Scan. See exactly what you pay | **REAL (re-record)** |
| 5 | 21–28 s | Split screen: both phones show the same amount, the same Pay to account, the same sale code | Same sale. Same amount. Same account | **REAL (re-record)** |
| 6 | 28–34 s | Customer ticks "I checked", taps Approve in wallet, wallet opens, approves | Nothing moves until you approve | **REAL (re-record)** |
| 7 | 34–41 s | Merchant phone moves by itself: Payment observed → **Paid per contract**; customer phone: Transaction submitted → Paid per contract | Settled on NEAR Testnet | **REAL (re-record)** |
| 8 | 41–49 s | Customer receipt: **Verified Paid** (one lime burst). Merchant taps **Verify receipt**: "Finding the payment on chain" → "Checking every receipt" → **Verified Paid** | Each phone checks the receipt itself | **REAL (re-record)** |
| 9 | 49–53 s | Receipt "Technical proof" open; cut to the funding transaction on testnet.nearblocks.io | Public proof on NEAR | **REAL** (use the new hash from the app) |
| 10 | 53–56 s | Logo + "NEAR Testnet only · Built at NEAR HACKATHON" | Taply. Payments you can check. | Brand |

No Handshake footage in the main film. If space allows, a 3-second end card
"Coming next: live Handshake (preview)" may show `/demo/handshake` **with the
DEMO stamp visible** and that exact caption.

## 2. Full English voiceover (≈ 120 words, ≈ 50 s)

> Paying a shop with crypto usually means copying an address and hoping it's right.
>
> With Taply, the merchant opens the point of sale and creates one unique sale, signed by their own wallet.
>
> The customer scans the code. Both phones now show the same amount, the same receiving account and the same sale code.
>
> The customer checks it and approves in their own wallet. Nothing moves until they do.
>
> The payment settles on NEAR. The merchant's screen updates by itself.
>
> And then each phone checks the receipt on chain, the funding, the transfer and the confirmation, without trusting anyone's server.
>
> Verified Paid.
>
> Taply. Your wallet. Your payment. One tap. Built on NEAR Testnet.

## 3. 15-second teaser script

| Time | Picture | Voice / text |
| --- | --- | --- |
| 0–3 s | Merchant phone shows the sale QR | "One sale." |
| 3–7 s | Split screen, matching amount, account and sale code | "Same amount. Same account. On both phones." |
| 7–11 s | Customer approves in wallet | "Your wallet approves. Nothing else can." |
| 11–15 s | Both receipts: Verified Paid. Logo | "Checked on NEAR. Taply." |

All teaser shots are **REAL (re-record)**.

## 4. Exact two-minute judge walkthrough

For a live demo or screen recording. Two phones (or two browser windows at
390 px), each with its own external NEAR Testnet wallet and a little Testnet
NEAR. Budget: one 0.01–0.1 NEAR payment.

| Clock | Do | Judges see | Say |
| --- | --- | --- | --- |
| 0:00 | Phone A (merchant) on **Merchant** | Receiving account card, New sale, Store QR | "This is the merchant's own Testnet account. Every sale pays only this account." |
| 0:10 | **New sale**, 0.01 NEAR, reference "Demo 1", Review | Exact amount, account, 15-minute window | "The merchant reviews the exact terms." |
| 0:20 | **Create request in wallet**, approve | Wallet prompt, then sale QR, status **Ready for customer**, sale code, Live pill | "That created one request on the contract. This QR is for this sale only." |
| 0:35 | Phone B (customer) scans the QR | Review: amount, Pay to, sale code, Instant | "The customer's phone read the terms from the chain, not from the QR." |
| 0:45 | Point at both sale codes | Same 6 characters on both | "Same code means same sale. It is not identity: the full account is still on screen." |
| 0:55 | B: tick the check, **Approve in wallet**, approve | Status **Awaiting wallet approval**, then **Transaction submitted** | "One approval, in the customer's own wallet." |
| 1:10 | Look at A, no touch | **Payment observed**, then **Paid per contract**, "Paid by …" | "The merchant's phone re-reads the finalized chain every five seconds. No tap." |
| 1:25 | B opens the receipt | **Verified Paid**, one lime burst | "The customer's phone checked the funding, transfer and callback receipts." |
| 1:35 | A: **Verify receipt** | Find on chain → Check every receipt → **Verified Paid**, "No link from the customer was needed" | "The merchant's phone found the payment on chain by itself and ran the same check." |
| 1:50 | Receipt → Technical proof → explorer | Transaction on testnet.nearblocks.io | "All of it is public on NEAR Testnet." |
| 1:55 | Optional: `/demo/handshake` | DEMO-stamped preview | "Live Handshake is next. This preview is synthetic and labelled as such." |

If the merchant-side check says "This payment is too old for this RPC" or
"Could not search the chain", say so: it falls back to Paid per contract, and
the customer's **Copy verification link** opens Verified Paid on the merchant
phone. Never retry the payment.

## 5. Mobile shot list (portrait, 1170×2532 or device native)

| ID | Screen | State to capture | Label |
| --- | --- | --- | --- |
| M1 | `/merchant` | Receiving account card, New sale primary | REAL |
| M2 | `/merchant/register` | Amount 0.01, review step | REAL (re-record) |
| M3 | Wallet app | Merchant approval prompt for `create_request` | REAL (re-record) |
| M4 | `/pay/<id>` merchant | Sale QR, **Ready for customer**, Live pill, sale code | REAL (re-record) |
| M5 | Camera | Scanner recognising the QR (corners close) | REAL (re-record) |
| M6 | `/pay/<id>` customer | Review card, exact terms, confirmation tick (terms sweep) | REAL (re-record) |
| M7 | Wallet app | Customer approval prompt for `pay_instant_native` | REAL (re-record) |
| M8 | `/pay/<id>` merchant | **Payment observed** (gold pulse on the track) | REAL (re-record; only if the in-flight read is caught) |
| M9 | `/pay/<id>` merchant | **Paid per contract**, Verify receipt | REAL (re-record) |
| M10 | `/receipt/<id>` customer | **Verified Paid** with burst | REAL (re-record) |
| M11 | `/receipt/<id>` merchant | Locator two-step progress, then Verified Paid + "No link … needed" | REAL (re-record) |
| M12 | Settings → Reduce Motion on | Same receipt, no motion | REAL (accessibility) |
| M13 | `/demo/handshake` | Room adapter preview, DEMO stamp visible | **DEMO** |

Already captured, production build, real pilot data (archived payment, no new
transaction): `apps/web/docs/screenshots/phase7g/`. Use them for the README
and as a fallback B-roll, captioned "Testnet pilot payment, 2026-11-01".

## 6. Desktop / phone shot list

| ID | Setup | Use | Label |
| --- | --- | --- | --- |
| D1 | Two phones on a table, overhead, merchant left, customer right | Hero shot for storyboard 5 and 7 | REAL (re-record) |
| D2 | `two-phones-paid-side-by-side.png` | README / thumbnail | REAL (pilot) |
| D3 | Desktop 1280 px receipt via verification link | "Any device can check" | REAL |
| D4 | testnet.nearblocks.io transaction page | Proof cutaway | REAL |
| D5 | Terminal: `pnpm --filter @taply/web run check` passing | Engineering credibility (optional) | REAL |
| D6 | `/demo/handshake` at 1280 px, two room panels | "What's next" end card | **DEMO** |

## 7. Real-evidence vs demo-only annotations for the edit

- Put a small lower-third on every REAL payment shot: **"NEAR Testnet · real
  transaction"**. On every DEMO shot: **"DEMO · synthetic"**, and keep the
  in-app DEMO stamp visible.
- Never cut from a DEMO shot directly into a Verified Paid shot.
- Do not speed-ramp the wait between Approve and Paid per contract so that it
  looks instant; a caption "≈ 5 s, real time" is fine if you trim.
- Blur nothing on chain (account IDs and hashes are public), but **never show a
  seed phrase, private key, wallet password or the `.env.local` file**.
- If a shot was re-recorded on a different day, the receipt hash changes. Use
  the one on screen; do not reuse `CrzQ57Jx…` except for the archived pilot.
- Physical-device claims: only for runs the operator actually performed. The
  existing record is one user-reported iPhone 13 Instant Pay run
  (`apps/web/docs/PHASE_6C_MOBILE_PILOT.md`) whose receipt JSON is still to be
  archived. Android is untested.

## 8. Subtitle-friendly narration (≤ 42 characters per line, 2 lines max)

```
1  Paying a shop with crypto
   usually means copying an address.
2  With Taply, the merchant creates
   one unique sale.
3  Signed by their own wallet.
4  The customer scans the code.
5  Both phones show the same amount,
   the same account, the same code.
6  The customer approves
   in their own wallet.
7  Nothing moves until they do.
8  The payment settles on NEAR.
9  The merchant's screen
   updates by itself.
10 Each phone checks the receipt
   on chain, by itself.
11 Verified Paid.
12 Taply. Your wallet.
   Your payment. One tap.
13 Built on NEAR Testnet.
```

SRT timing should follow the recorded voiceover, not this table.

## 9. Short product descriptions

**English (≈ 280 characters)**

> Taply turns a NEAR wallet into a point of sale. The merchant creates one
> unique sale, the customer scans it and sees the exact amount and receiving
> account, approves in their own wallet, and both phones check the receipt on
> chain. NEAR Testnet only.

**English (one line)**

> Merchant payments on NEAR where both phones see the same sale and check the receipt themselves.

**Türkçe (≈ 280 karakter)**

> Taply, bir NEAR cüzdanını satış noktasına dönüştürür. Satıcı tek ve benzersiz
> bir satış oluşturur, müşteri QR kodu okutur, tam tutarı ve alıcı hesabı
> görür, kendi cüzdanında onaylar; iki telefon da makbuzu zincirde kendisi
> doğrular. Yalnızca NEAR Testnet.

**Türkçe (tek satır)**

> İki telefonun aynı satışı gördüğü ve makbuzu kendisinin doğruladığı NEAR ödemeleri.

## 10. Draft X post (for the human to edit and publish; not posted)

Per the live HACKATHON.md (re-checked 2026-11-05): say it was built at NEAR
HACKATHON, tag **@NEARProtocol** and **#NEARHackathon** (optionally
@NearLegion, @NearBuilders), attach the video, lead with the user problem,
show one complete moment, say what NEAR does concretely, give a next step.

> Paying a shop in crypto still means copying addresses and hoping.
>
> Taply: the merchant creates one sale, the customer scans, both phones show the same amount and account, the customer approves in their own wallet, and each phone checks the receipt on NEAR by itself.
>
> Built at NEAR HACKATHON on @NEARProtocol Testnet. #NEARHackathon
>
> Repo: <public repo link> · What would you need to trust a QR payment at a counter?

Placeholders in angle brackets stay until the human fills them in.
