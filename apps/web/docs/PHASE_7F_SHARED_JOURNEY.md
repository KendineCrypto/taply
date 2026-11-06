# Phase 7F: shared payment journey (handoff)

Branch `feature/phase7-integration`, 2026-11-02. `apps/web` only. No contract,
`packages/*`, root manifest, lockfile or env change. No dependency. No
transaction sent, nothing deployed, pushed or merged. No flag changed
(Handshake stays off). Journal, creation gate, Web Lock, reconcile rules,
wallet checks and the Verified Paid verifier are unchanged.

## What is now live

| Surface | What changed |
| --- | --- |
| `/pay/<id>`, both phones | One **shared session hero**: the same amount, Pay to account, **sale code** and five-step timeline (Created, Wallet, On chain, Contract, Receipt check). Headlines depend on the side: the merchant sees *Ready for the customer*, *Payment seen on chain*, *Paid per contract*; the customer sees *Merchant is ready* (or *Ready to pay*), *Waiting for your wallet*, *Payment submitted*, *Paid per contract*. |
| Merchant phone, open sale | **Live chain watch.** The receiver of an OPEN, still-payable request re-reads `get_request` every 5 s (15 s after 10 min), only while the tab is visible. The same finalized, code-hash-checked read as before. It stops once the request leaves OPEN or its funding deadline passes. A "Live" pill shows it. The merchant no longer sits on an idle QR screen. |
| Paid per contract vs Verified Paid | Side by side in the hero: "✓ Paid per contract" and "○ Verified Paid: receipt check not run here". The timeline's last step reads *not yet*, never *in progress*. The lime tone appears only for `verified`. |
| Sale code | Six characters both phones derive from the on-chain request ID (same alphabet as the Handshake code, but **not** a session commitment). Shown in the hero (customer), on the QR ticket (merchant) and on the receipt. Copy says it identifies the sale; the amount and account are still checked in full. |
| Context wording | A POS sale on its creator's device reads "Your sale" and offers **New sale** once it ends. A sale opened from this account's `/checkout` page reads "Live checkout". Stored as hints (`taply.posSales.v1` local, `taply.checkout.v1` session, 30 min, same receiving account only). Wording only: they never unlock an action. |
| Motion (CSS-first) | Breathing glow on the session card (neutral, gold while money moves, lime only when verified) and on the QR ticket and pay review. A one-time "recognized" ring from the sale code. The timeline fills, with a gold ripple on the current step. Stage changes fade in. A **one-time lime burst** on the Verified Paid seal. Under `prefers-reduced-motion` all of it stands still (measured: `animation-name: none`). |
| Information architecture | The amount is shown once per screen: the hero hides it when the QR ticket or pay review below shows it. The second explanatory paragraph is quieter. Request details stay collapsed. The Store QR (discovery) and sale QR (payment) are unchanged and still labelled. |

## What is still gated / DEMO

- **Live presence** ("Customer joined", "Waiting for wallet approval" on the
  merchant's phone) needs Handshake, which is not live. In live screens the
  merchant sees only chain facts ("No payment on chain yet", "Payment seen on
  chain", "Paid by …"). A POS sale says plainly: *Live customer presence needs
  Handshake, which is not live yet.* A test checks that no live hero contains
  "joined", "connected" or "online".
- `/demo/handshake` (DEMO-stamped, synthetic) now shows the coordinated journey:
  status headlines on both phones (Waiting for the customer → Customer joined /
  Merchant is ready → Reviewing payment → Waiting for wallet approval / Waiting
  for your wallet) and the same timeline. Still no network, wallet or paid state.
- **Merchant-side Verified Paid** still needs the funding hash (the customer's
  verification link or a future indexer). The merchant phone stops at "Paid per
  contract", which is the honest state.

## Tests and build

| Command | Result |
| --- | --- |
| `pnpm --filter @taply/web test` | 665/665 (52 files; +34 new) |
| `pnpm --filter @taply/web run check` (brand, types, lint, tests) | exit 0 |
| `pnpm check` (workspace) | exit 0, 2/2 runs after `context-sync` wait fix (see below) |
| `pnpm --filter @taply/web exec next build --webpack` | exit 0, 21/21 pages |

New tests:
- `lib/merchant/__tests__/journey.test.ts`: roles, sale code, live-watch rule and cadence, and hostile or corrupt hint storage.
- `components/payments/__tests__/shared-journey.test.tsx`: the merchant sees payment arrive with no tap (a mutation check fails it with the watch off), the customer never live-polls, checkout wording only for the same account, and no presence or verified claims.
- `components/experience/__tests__/shared-session.test.tsx`: stage copy, lime tone only when verified, screen-reader timeline, Turkish copy, a single burst and the demo coordination.
- `merchant.test.tsx`: records the POS hint.

**Flaky test note.** `context-sync` "re-verifies an aged contract check" timed
out at the 1 s `waitFor` default under the parallel root run (2 of 3 failures
with this change, 0 of 2 on base `819a65e`; it was also seen once in 7D).
`PaymentsProvider` is untouched. The extra suite load pushes one async read
past 1 s. Fixed by a 5 s timeout with the same assertion (separate commit).

## Browser QA and screenshots

`scripts/phase7f-journey-shots.mjs`, production Webpack build, against the
pilot's **real** FINAL_PAID request `9b9a…4502` on `taply-pay-pilot-1.testnet`
(docs/EVIDENCE.md). The injected read-only wallet throws on any signing, and only
the app and RPC hosts are allowed. Results: `docs/screenshots/phase7f-journey/phase7f-qa.json`.

- 360/390/430 px, EN + TR: 0 overflow, 0 unnamed controls, 0 targets under 44 px. The receipt's transaction link was raised to 44 px in this phase.
- RPC: `status`, `block`, `view_account`, `get_config`, `get_request`, `get_receipt`, `EXPERIMENTAL_tx_status`, `view_access_key_list`. No broadcast, no page errors.
- The receipt reached real **Verified Paid** with the funding hash, and the burst played once.

Screenshots (`docs/screenshots/phase7f-journey/`): `merchant-paid-{360,390}`,
`customer-paid-{360,390}` (same sale code `KED 5E9` on both),
`receipt-verified-{360,390}`, `receipt-verified-burst-{360,390}`,
`tr-merchant-paid-360`, `demo-joined-390`, `demo-wallet-390`.

**Not captured:** OPEN-state screens (sale QR with Live pill, customer review).
They need a newly created request, i.e. a transaction. They are covered by the
integration tests; capture them during the physical iPhone POS run.

## Device checklist additions

1. On the merchant phone, show a fresh sale QR and confirm "Your sale · Live" and the code on the ticket.
2. Scan from `/checkout/<merchant>` on the customer phone. Expect "Live checkout · Merchant is ready" and the **same** sale code.
3. Pay. The merchant phone should move to "Payment seen on chain" or "Paid per contract" within ~5 s without a tap, then offer New sale.
4. The customer receipt reaches Verified Paid with the one-time burst. Turn on Reduce Motion and confirm everything is still.
