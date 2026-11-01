# Phase 6C: iPhone mobile Instant Pay pilot

Status: **user-reported mobile pilot, chain proof for this payment not yet archived.**
Recorded 2026-11-01 on `feature/frontend`. Documentation only: no code, contract,
flag or deployment change, and no transaction was sent while writing it.

This file deliberately does **not** update the authoritative `docs/EVIDENCE.md`.
That file only gains a row once the proof data listed in section 4 exists.

## 1. User-reported observations (not independently verified here)

The operator reported the following after testing on their own devices.

| Item | Reported result |
| --- | --- |
| Device | iPhone 13 (iOS version not recorded) |
| Browser | Not recorded (assumed Safari, to be confirmed) |
| Hosting | Private pilot over Tailscale HTTPS, reachable only by the operator's devices |
| Wallet | External NEAR Testnet mobile wallet (name and version not recorded) |
| Contract | Pinned Instant-only pilot contract (`taply-pay-pilot-1.testnet` per `docs/EVIDENCE.md`; to be confirmed for this payment) |
| QR scan | Real camera scan of a Taply request QR opened the correct `/pay/<id>` |
| Payment | 0.01 NEAR Testnet Instant payment approved in the external wallet |
| Mobile result | After returning from the wallet, the receipt reached **Verified Paid** without manual action |
| Cross-device | Opening the receipt's verification link (`/receipt/<id>?ftx=<hash>`) on desktop also showed **Verified Paid** |

What this means: the Phase 6A/6B mobile path (real camera, wallet redirect,
automatic receipt follow-up, cross-device verification link) worked at least once
on a physical iPhone with a real external wallet.

What it does not mean: it is one run on one device. It is not an archived proof,
not an Android result and not a public deployment.

## 2. Automated test results (from earlier phases, not re-run for this pilot)

| Source | Result |
| --- | --- |
| Phase 6A (`PHASE_6A_PAY.md`) | `pnpm check` exit 0, web 486/486; Chromium fake-camera smoke |
| Phase 6B (`PHASE_6B_REVIEW.md`) | `pnpm check` exit 0, web 515/515; production Webpack browser smoke |

These cover the scanner, the wallet-return race, receipt follow-up and verifier
binding. They use jsdom and Chromium with synthetic camera frames. They are not
physical-device evidence.

## 3. Independently archived chain evidence

| Payment | Archived? | Where |
| --- | --- | --- |
| Earlier 0.1 NEAR CLI-funded pilot (`9b9a5724…`, funding tx `CrzQ57Jx…`) | Yes | `docs/EVIDENCE.md`, `docs/evidence/instant-pay-2026-11-01-receipt.json` |
| **This 0.01 NEAR iPhone payment** | **No** | Placeholders below |

## 4. Missing proof for the iPhone payment

These values were not supplied with the report. They are left empty on purpose.
Do not fill them from memory or from another payment.

| Field | Value |
| --- | --- |
| Request ID (64 hex) | `<TO COLLECT>` |
| Terms hash | `<TO COLLECT>` |
| Funding transaction hash | `<TO COLLECT>` |
| Payer account | `<TO COLLECT>` |
| Recipient account | `<TO COLLECT>` |
| Exact amount (yoctoNEAR) | `<TO COLLECT>` (expected `10000000000000000000000`) |
| Contract account and code hash | `<TO COLLECT>` |
| Verifier result (`verified_final`), RPC name, verification time | `<TO COLLECT>` |
| Wallet name/version, iOS version, browser | `<TO COLLECT>` |
| Screenshots (mobile receipt, desktop receipt) | `<TO COLLECT>` |

### How to collect them from the existing receipt

No new payment is needed.

1. On the iPhone (or desktop with the verification link), open the receipt that
   showed **Verified Paid**: `/receipt/<requestId>?ftx=<fundingHash>`.
2. Open **Technical proof** and use **Copy receipt evidence (JSON)**. It contains
   the request ID, terms hash, contract, code hash, payer, recipient, amount,
   funding transaction, payout/callback status, RPC and verification time.
3. Save that JSON as `docs/evidence/instant-pay-<date>-mobile-receipt.json`
   (lead-owned path; coordinate before committing there).
4. Check the funding hash on `https://testnet.nearblocks.io/txns/<fundingHash>`:
   the signer must be the payer and the receiver the pilot contract.
5. Take screenshots of the mobile and desktop receipts.
6. Record the wallet, iOS and browser versions.
7. Only then add a row to `docs/EVIDENCE.md` ("Mobile wallet redirect Instant Pay").

If the receipt no longer shows Verified Paid (for example, the hash was lost),
record that honestly. Do not substitute the earlier CLI pilot's data.

## 5. Limitations

- **Android not tested.** No Android Chrome camera, wallet redirect or receipt run.
- **Tailscale is private pilot hosting.** Only devices on the operator's tailnet
  can open it. It is not a public HTTPS deployment and proves nothing about
  public DNS, TLS or reachability.
- **Mainnet not tested** and not supported. Testnet funds only.
- **Payment history discovery is incomplete.** Activity relies on this device's
  local journal. A payment made elsewhere, or after storage is cleared, may not
  appear without the verification link. No indexer is integrated.
- **Native Taply Wallet signing remains disabled.** The pilot used an external wallet.
- One run, one device, one wallet. Repeatability, other iOS versions and
  low-end devices are untested.
- The configured RPC is trusted by the verifier; no second-provider cross-check
  was recorded for this payment.

## 6. Next steps

1. Collect section 4 data from the existing receipt.
2. Repeat on Android Chrome with a second wallet.
3. Repeat the iPhone run once more and record timing (scan to Verified Paid).
