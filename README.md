# taply. — merchant payments on NEAR you can check yourself

> **Your wallet. Your payment. One tap.**
> NEAR **Testnet only**. No mainnet, no real funds, no bridges.

**Live: [https://taplyapp.xyz](https://taplyapp.xyz)** — public, read-only NEAR Testnet build. No login, no wallet needed to look around.

Taply is a mobile-first web app (PWA) that turns a NEAR Testnet wallet into a
point of sale. A merchant creates one unique sale; the customer scans its QR,
sees the exact amount and receiving account read from the chain, approves in
their own wallet, and both phones check the receipt on chain by themselves.

## Status on 2026-11-09

| | |
| --- | --- |
| Public site | **Live** at https://taplyapp.xyz (Vercel production, branch `release/taplyapp`, HTTPS, English by default, Turkish in Settings) |
| Payment signing on the public site | **On** (NEAR Testnet; Vercel `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=on`, set by the owner). Create a request and pay it with an external wallet (NEAR Connect) or with Taply Wallet. |
| Onboarding | First launch: connect an external wallet **or** pick a username and get a real `username.testnet` Taply Wallet (faucet-created, confirmed on chain) with a 12-word recovery phrase. No sponsored gas. |
| Pay with other assets | The merchant asks for NEAR; the payer may pay with NEAR, USDC, USDT, NST, LNC or PEM (test tokens, converted to NEAR on Ref/Rhea Testnet first). The merchant always receives exactly the NEAR requested. |
| Taply Wallet signing | **On for NEAR Testnet by the owner's explicit decision (2026-11-09), WITHOUT an independent security review.** Every signature needs an unlocked vault and a confirmation dialog showing the exact transaction. Test funds only. |
| Real Testnet payment proof | A real 0.1 NEAR Instant Pay payment (2026-11-01) reached `FINAL_PAID` and **Verified Paid** in Taply's independent receipt verifier ([evidence](docs/EVIDENCE.md)). It can be re-read live on the site. |
| Real browser proofs (2026-11-09) | Taply Wallet in Chromium on real Testnet paid a 0.2 NEAR request in NEAR and a 0.25 NEAR request with test USDC (both `FINAL_PAID`, exact payout) — [evidence](docs/evidence/taply-wallet-signing-2026-11-09/result.json). An external browser-wallet (Meteor) payment still needs a human run. |
| Disabled by design | Protected Pay (escrow), live two-phone Handshake (G2), merchant sale signing, sponsored gas |

## For judges: 5 minutes, no wallet, no funds

| Do | See |
| --- | --- |
| Open [taplyapp.xyz](https://taplyapp.xyz) on a phone or a 390 px browser | Home in English; a NEAR Testnet pill in the header; **Connect wallet** |
| Open [taplyapp.xyz/demo](https://taplyapp.xyz/demo) | The full payment journey, every screen stamped **DEMO** (synthetic, nothing sent) |
| Open [the real pilot sale](https://taplyapp.xyz/pay/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502) | Read live from the Testnet contract: 0.1 NEAR to `taplytest.testnet`, sale code `KED 5E9`, **Paid per contract** |
| Open [its receipt](https://taplyapp.xyz/receipt/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502?ftx=CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su) | The independent verifier re-checks funding, transfer and callback receipts and shows **Verified Paid**, or, if a public RPC is busy, says so and shows the **archived** 2026-11-01 verifier record clearly labelled as archive |
| Optional: connect any NEAR Testnet wallet, tap **Request**, enter an amount, **Continue** | The final review: amount, recipient, deadline and the real cost (non-refundable storage deposit, network fee in wallet). The create button is disabled on the public site |
| Optional: Settings → Türkçe | The whole app in Turkish; the choice persists |
| Read [docs/JUDGE_QUICK_START.md](docs/JUDGE_QUICK_START.md) | Local build and test commands, what each screen proves |

Nothing on the site moves funds. DEMO screens are synthetic; the pilot sale and receipt are real Testnet data.

## The problem

Paying a shop in crypto usually means copying an address, trusting a
screenshot as a receipt, and hoping the merchant's screen means what it says.
Payment-link tools solve part of it. What is still missing at a counter:

- the customer cannot easily confirm that **this** QR is **this** sale for
  **this** amount to **this** account;
- the merchant often cannot tell "a transaction was sent" from "I was paid";
- a receipt is usually a claim by an app, not something either side can check.

## What Taply does

1. **One on-chain request per sale**: the merchant enters an amount and signs
   one immutable payment request (recipient, exact amount in yoctoNEAR, expiry,
   optional payer restriction).
2. **QR carries only the request ID**: the customer's phone reads the terms
   from the contract at a finalized block, never from the QR.
3. **Same sale on both phones**: amount, Pay to account, a six-character sale
   code and the same status timeline. The code identifies the sale; it is
   **not** merchant authentication.
4. **Explicit approval**: the customer approves exactly one
   `pay_instant_native` call in their own external wallet.
5. **Honest settlement states**: Ready for customer → Payment observed →
   Paid per contract. Nothing turns green until finalized chain state says so.
6. **Verified Paid**: each phone runs Taply's independent receipt verifier
   against the funding, transfer and callback receipts, code hash and access
   keys. The merchant phone can find the funding transaction by itself.

What makes it different: receipts either side can verify from public chain
data; "Paid per contract" and "Verified Paid" are different states; wallet
returns, server events and timers never mark a payment paid. We do not claim to
have invented QR payments, payment links or escrow.

## Supported network

| Item | Value |
| --- | --- |
| Network | NEAR **Testnet** only (genesis hash checked on every read) |
| Contract | [`taply-pay-pilot-1.testnet`](https://testnet.nearblocks.io/address/taply-pay-pilot-1.testnet) |
| Approved code hash | `BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B` (checked by the app before any signature) |
| Asset | Native Testnet NEAR |
| Wallets | External NEAR Testnet wallets via `@hot-labs/near-connect` |

## Feature status (2026-11-09)

| Feature | On taplyapp.xyz | Evidence |
| --- | --- | --- |
| Connect an external Testnet wallet, balance, receive address + QR | **Working** (read-only) | Live site; owner iPhone check 2026-11-09 |
| Real request/payment pages and receipts read from the contract | **Working** | [pilot sale](https://taplyapp.xyz/pay/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502) |
| Independent receipt verifier (Verified Paid) with archival fallback | **Working**; archived record is labelled "Archived record · not a live check" | [EVIDENCE.md](docs/EVIDENCE.md) |
| Request creation (cost disclosed) | **Working, signing on** | Live site |
| Signed request creation and Instant payout `FINAL_PAID` | **Working on the public site**; Testnet verified (2026-11-01 and 2026-11-09 browser runs) | funding tx [`CrzQ57Jx…`](https://testnet.nearblocks.io/txns/CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su) |
| Pay a NEAR request with USDC / USDT / NST / LNC / PEM | **Working**: Ref/Rhea Testnet swap to NEAR, then the normal payment | [USDC](docs/evidence/testnet-e2e/2026-11-09T17-43-37-563Z-usdc-pay.json), [USDT](docs/evidence/testnet-e2e/2026-11-09T18-19-47-447Z-usdt-pay.json) |
| QR scanner, pay-by-link | **Working** | Live site |
| Merchant register and store QR (`/merchant`, `/checkout/<account>`) | **UI working; sale signing off** | Live site |
| Contacts | **Working, local to the device** (no server) | `/contacts` |
| Split Pay | **Preparation tool**: equal shares, then one normal request per person (needs signing to go on chain) | `/split` |
| Recurring templates | **Preparation tool**: saved templates pre-fill a request; nothing runs automatically | `/recurring` |
| DEMO journey | **Synthetic**, stamped DEMO | `/demo`, `/demo/handshake` |
| Live two-phone Handshake (G2) | **Not live**; contract cannot bind sessions | [PHASE_7_SHARED_ROOM.md](docs/PHASE_7_SHARED_ROOM.md) |
| Protected Pay (escrow, refund, release) | **Disabled** | — |
| Taply Wallet: username.testnet, 12-word phrase, send, pay, swaps | **Working on NEAR Testnet**; owner decision, **no independent security review** | `/wallet/create` |
| Social login, sponsored gas | **Disabled** | — |

## Development branch: Testnet-verified candidates (not on taplyapp.xyz yet)

Branch `claude/kind-cerf-c4n261` adds isolated, **unreviewed** contract candidates (the G1 pilot is untouched)
and proves them with real NEAR Testnet transactions from disposable automation accounts
([evidence index](docs/RELEASE_EVIDENCE_INDEX.md), [AI review — not an audit](docs/SECURITY_REVIEW_2026-11-09.md)):

| Capability | Testnet proof |
| --- | --- |
| Fresh G1 Instant Pay on the pilot | FINAL_PAID, exact payout, duplicate refused, Verified on 2 RPC providers |
| Protected Pay (escrow) | real refund and real release on locked contract accounts; early release / late cancel / wrong canceller / double release refused |
| NEP-141 token payments (TEST-ONLY token, no value) | exact token deltas, duplicate and fake-token transfers returned, token escrow refund |
| Merchant sale bound to a Handshake session (G2) | contract session commitment = comparison code on both phones; replay refused; Verified |
| Receipt verifier | whole-proof fallback to a second archival RPC (fixes "Could not reach the RPC") |
| Verified Request chip | shows the provenance checks behind every request page |

These capabilities stay **off** on the public site until the owner's wallet acceptance and a human security review.

## Run it locally

Requirements: Node **24.22.2** (`.node-version`) and pnpm **11.5.0**.

```sh
git clone https://github.com/KendineCrypto/taply.git
cd taply                      # default branch main = the released source
pnpm install --frozen-lockfile
pnpm check                    # brand, build, types, lint and all workspace tests (no funds)
cp apps/web/env/public-readonly.env.example apps/web/.env.local   # same read-only config as taplyapp.xyz
pnpm --filter @taply/web build && pnpm --filter @taply/web start  # http://localhost:3000
```

- `/demo` works with no configuration. The pilot sale and receipt need the
  read-only contract settings above.
- Public Testnet RPCs rate-limit per IP (`HTTP 429`). Taply then says the RPC is
  busy, waits as instructed and signs nothing; the receipt page falls back to the
  labelled archived record. Never pay again to make a demo succeed.
- Signing is gated by `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=on` **and** a passing
  on-chain contract check at a fresh final block. Turning it on is an owner
  decision ([acceptance plan](docs/TESTNET_ACCEPTANCE_PLAN.md)).

Contract checks (Rust/WASM/sandbox) run in CI (`instant-pay-sandbox`). The
standalone API checks are `node --test apps/api/test/*.test.mts` (see
`.github/workflows/workspace-check.yml`).

## Verified Testnet evidence

- Ledger with hashes, receipts, blocks and reproduction commands: [`docs/EVIDENCE.md`](docs/EVIDENCE.md).
- Verifier output for the pilot payment: [`docs/evidence/instant-pay-2026-11-01-receipt.json`](docs/evidence/instant-pay-2026-11-01-receipt.json) (also served at `/evidence/instant-pay-2026-11-01-receipt.json`).
- Public read-only contract check, re-run 2026-11-09, 10/10 PASS:
  `node apps/web/scripts/deploy-preflight.mjs post taply-pay-pilot-1.testnet --rpc https://test.rpc.fastnear.com`.
- Nightly release report with the exact production deployment, CI runs and browser results: [`docs/NIGHTLY_RELEASE_REPORT_2026-11-09.md`](docs/NIGHTLY_RELEASE_REPORT_2026-11-09.md).

## Readiness gates

| Gate | Meaning ([MILESTONES.md](docs/MILESTONES.md)) | State |
| --- | --- | --- |
| G1 | Real native NEAR request → signed settlement → verified `FINAL_PAID` | Historical Testnet proof exists; public read-only site live; **public signing waits for a fresh owner-signed acceptance run** |
| G2 | Merchant QR checkout + authenticated live two-device Handshake | **NO-GO**; not deployed |
| G3 | Protected escrow: real refund and real release on Testnet | **Not met**; Protected Pay disabled |
| G4 | Chain proof/receipt + adversarial and UX robustness | Software evidence exists; no external audit |

## Known limitations

- **Testnet only. Not audited.** Configured-RPC trust model (not a light
  client). The pilot contract keeps a FullAccess key; the verifier refuses a
  receipt if the contract's keys changed during the payment window.
- **Taply Wallet is not independently security-reviewed.** Its key lives in the
  browser (encrypted with the password; recovery = 12 words). A malicious script
  on the page while it is unlocked could misuse it. NEAR Testnet test funds only.
- **NEAR Intents has no Testnet**, so other-asset payments use Ref/Rhea Testnet
  pools; the tokens are test tokens with no real value.
- **Declined signatures block a retry.** Wallets do not prove that a declined
  or failed prompt sent nothing, so Taply treats it as "result unknown"; the same
  payer can retry that request only after the chain shows it funded, cancelled
  or expired (default 15 minutes).
- **Handshake is not live.** The sale code is not merchant authentication;
  merchants are shown by account ID only.
- **Activity history** is this device's local journal; there is no indexer.
  Contacts and templates also stay on the device.
- **Public RPC limits:** heavy use from one IP gets `429`; the app fails closed.
- **Indexing:** the site sends `noindex` on purpose (payment pages should not be indexed).
- Android is untested on a physical device.

## Architecture

```text
apps/web/              Next.js 16 PWA (TypeScript strict): POS, checkout, pay, receipt, verifier
apps/api/              Session/room service (in-process Fetch handlers; production auth closed)
contracts/payments/    Frozen G1 Instant Pay contract (deployed Testnet source)
contracts/payments-merchant/ Isolated, unapproved G2 candidate; not deployed
packages/near-client/  Typed, wallet-neutral NEAR RPC reads and call builders
packages/shared/       Frozen protocol schemas, canonical hashing, sale/comparison codes
docs/                  Protocol freeze, state machine, security, evidence, release reports
```

Protocol and design: [Protocol Freeze v1](docs/LEAD_PROTOCOL_FREEZE_v1.md),
[payment state machine](docs/PAYMENT_STATE_MACHINE.md), [security](docs/SECURITY.md),
[architecture](docs/ARCHITECTURE.md), [API](docs/API.md), [UX flows](docs/UX_FLOWS.md),
[test plan](docs/TEST_PLAN.md), [product](docs/PRODUCT.md).

## How it was built: AI and dependency disclosure

- **AI coding agents.** Most code and documentation was written by AI agents
  under human direction: **Claude Code** (Anthropic) for the frontend
  (`apps/web`), release engineering and documentation, and **Codex** (OpenAI)
  for the contract, backend and shared packages. A human owner directs the work
  and performs every wallet approval and on-chain action. Allowed and disclosed
  per HACKATHON.md Q-005.
- **No template or pre-existing app** was used. The repository starts at
  `db10264` (2026-10-29), inside the eligible window (from 2026-10-19, Q-001).
- **Runtime dependencies** (exact versions in `pnpm-lock.yaml` and
  `contracts/payments/Cargo.lock`): web `next`, `react`, `react-dom`,
  `@hot-labs/near-connect` (wallet selector), `jsqr` (QR decoding), `zod`;
  near-client `near-api-js`, `lossless-json`, `jsonc-parser`, `zod`; shared
  `zod`, `canonicalize`, `jsonc-parser`, `@noble/hashes`; contract `near-sdk`
  5.30.0, `borsh`. Tooling: TypeScript, Tailwind CSS, Vitest, Testing Library,
  ESLint. Browser QA used a separately installed Playwright (not a repository
  dependency). Hosting: Vercel. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Brand assets** in `brand/` were made for this project.

## Hackathon

- NEAR HACKATHON. Development and submission end **2026-11-14 23:59 UTC**
  (re-checked against https://nearhackathon.com/HACKATHON.md on 2026-11-09).
  Testnet-only projects are eligible (Q-010).
- Track: **Real-World Money** (`realworld`), merchant payments.
- **Hackathon diff (Q-003):** every commit in this repository was written
  inside the eligible window (first commit `db10264`, 2026-10-29), so there is
  no pre-hackathon baseline. Full history:
  [commits on main](https://github.com/KendineCrypto/taply/commits/main).
  The judged source is the default branch `main`, identical to the production
  branch `release/taplyapp` that serves taplyapp.xyz.
- Submission package (X post draft, form text, link checklist):
  [docs/HACKATHON_SUBMISSION_PACKAGE.md](docs/HACKATHON_SUBMISSION_PACKAGE.md).

## License

Source code: [MIT](LICENSE), Copyright (c) 2026 KendineCrypto_. The Taply name
and brand assets are excluded and all rights reserved; see [NOTICE](NOTICE).

## Sources

- NEAR HACKATHON rules: https://nearhackathon.com/HACKATHON.md
- NEAR docs: https://docs.near.org/ · RPC providers: https://docs.near.org/api/rpc/providers
