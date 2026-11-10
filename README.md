# taply. — merchant payments on NEAR you can check yourself

> **Your wallet. Your payment. One tap.**
> NEAR **Testnet only**. No mainnet, no real funds, no bridges.

**Live: [https://taplyapp.xyz](https://taplyapp.xyz)** — public NEAR Testnet build with payments on. No login needed to look around; create a free `username.testnet` wallet in the app to pay.

Taply is a mobile-first web app (PWA) that turns a NEAR Testnet wallet into a
point of sale. A merchant creates one unique sale; the customer scans its QR,
sees the exact amount and receiving account read from the chain, approves in
their own wallet (an external NEAR wallet or the built-in Taply Wallet), may pay
with NEAR or another Testnet asset that is converted to NEAR first, and both
phones check the receipt on chain by themselves.

## Status on 2026-11-09

| | |
| --- | --- |
| Public site | **Live** at https://taplyapp.xyz (Vercel production, branch `release/taplyapp`, HTTPS, English by default, Turkish in Settings) |
| Payment signing on the public site | **On** (NEAR Testnet; Vercel `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=on`, set by the owner). Create a request and pay it with an external wallet (NEAR Connect) or with Taply Wallet. |
| Onboarding | First launch: connect an external wallet **or** pick a username and get a real `username.testnet` Taply Wallet (faucet-created, confirmed on chain) with a 12-word recovery phrase. No sponsored gas. |
| Pay with other assets | The merchant asks for NEAR; the payer may pay with NEAR, USDC, USDT, NST, LNC or PEM (test tokens, converted to NEAR on Ref/Rhea Testnet first). The merchant always receives exactly the NEAR requested. |
| Taply Wallet signing | **On for NEAR Testnet by the owner's explicit decision (2026-11-09), WITHOUT an independent security review.** Enter the password once: the wallet stays unlocked on that device until **Lock now** (max 30 days, owner request 2026-11-10). Every transaction still shows a confirmation dialog with the exact transaction. Test funds only. |
| Real Testnet payment proof | A real 0.1 NEAR Instant Pay payment (2026-11-01) reached `FINAL_PAID` and **Verified Paid** in Taply's independent receipt verifier ([evidence](docs/EVIDENCE.md)). It can be re-read live on the site. |
| Real browser proofs (2026-11-09) | **On taplyapp.xyz itself**, Chromium, fresh Taply Wallets: (1) paid a 0.2 NEAR request in NEAR and a 0.25 NEAR request with test USDC ([evidence](docs/evidence/production-taply-wallet-2026-11-09/result.json)); (2) one wallet **created** a 0.05 NEAR request in the app and a second wallet in another browser paid it ([evidence](docs/evidence/production-taply-wallet-2026-11-09/create-request-result.json)). All `FINAL_PAID` with the exact payout. An external browser-wallet (Meteor) payment still needs a human run. |
| Live Handshake (two phones) | **Built and Testnet-proven in two real browsers** (2026-11-10): the merchant's QR opens a live session; both phones see each other online, "reviewing", disconnected / reconnected, the same sale code and the session expiry; a second phone with the same QR is refused; payment status stays chain-only ([evidence](docs/evidence/live-handshake-2026-11-10/result.json)). Turns on on taplyapp.xyz once the owner connects a free Upstash Redis and sets `NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE=on`. |
| Disabled by design | Protected Pay (escrow), contract-bound merchant sessions (G2 candidate), merchant sale signing, sponsored gas |

## For judges: 5 minutes

No funds of your own are needed: the app creates a NEAR Testnet account with free test NEAR.

| Do | See |
| --- | --- |
| Open [taplyapp.xyz](https://taplyapp.xyz) on a phone or a 390 px browser | **Welcome to Taply** with two choices: connect an existing wallet, or create a Taply Wallet |
| **Choose a username** → accept → pick a name → set a password (8+ characters) | The 12-word Secret Recovery Phrase (hidden until tapped), then "*name*.testnet is live on NEAR Testnet" with 10 test NEAR — confirmed by a final chain read |
| Tap **Request**, enter 0.05, create it, and open the payment link in a second browser with another Taply Wallet | The final review, then Taply's **Confirm transaction** dialog showing exactly what will be signed; after Confirm the request becomes **Paid per contract** and the receipt runs the independent verifier |
| On the payment page choose **USDC** (or USDT, NST, LNC, PEM) | Enable → Get test USDC → Convert → Pay, each with its own confirmation; the recipient still receives exactly the NEAR requested |
| Open [the real pilot sale](https://taplyapp.xyz/pay/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502) and [its receipt](https://taplyapp.xyz/receipt/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502?ftx=CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su) | Read live from the Testnet contract: 0.1 NEAR to `taplytest.testnet`, **Paid per contract**, then **Verified Paid** (or the clearly labelled archived verifier record if a public RPC is busy) |
| Open [taplyapp.xyz/demo](https://taplyapp.xyz/demo) | The full journey with synthetic data, every screen stamped **DEMO** |
| Optional: Settings → Türkçe | The whole app in Turkish; the choice persists |
| Read [docs/JUDGE_QUICK_START.md](docs/JUDGE_QUICK_START.md) | Local build and test commands, what each screen proves |

Everything runs on NEAR Testnet with test tokens that have no real value. DEMO screens are synthetic.

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
   `pay_instant_native` call in their own wallet: an external NEAR wallet, or
   Taply Wallet, which shows its own confirmation dialog before signing.
5. **Pay with any supported asset**: the merchant always asks for NEAR; the
   customer may instead convert test USDC, USDT, NST, LNC or PEM to NEAR on
   Ref/Rhea Testnet first (a separate, clearly labelled approval).
6. **Honest settlement states**: Ready for customer → Payment observed →
   Paid per contract. Nothing turns green until finalized chain state says so.
7. **Verified Paid**: each phone runs Taply's independent receipt verifier
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
| Asset | Native Testnet NEAR (the payer may convert test USDC / USDT / NST / LNC / PEM first on `ref-finance-101.testnet`, curated pools only) |
| Wallets | External NEAR Testnet wallets via `@hot-labs/near-connect`, or the built-in Taply Wallet (`username.testnet`, 12-word phrase, BIP-39 / NEAR path m/44'/397'/0') |

## Feature status (2026-11-09)

| Feature | On taplyapp.xyz | Evidence |
| --- | --- | --- |
| First launch: external wallet or `username.testnet` Taply Wallet | **Working** | [production run](docs/evidence/production-2026-11-09-onboarding/phrase-result.json) |
| Connect an external Testnet wallet, balance, receive address + QR | **Working** | Live site; owner iPhone check 2026-11-09 |
| Real request/payment pages and receipts read from the contract | **Working** | [pilot sale](https://taplyapp.xyz/pay/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502) |
| Independent receipt verifier (Verified Paid) with archival fallback | **Working**; archived record is labelled "Archived record · not a live check" | [EVIDENCE.md](docs/EVIDENCE.md) |
| Request creation (cost disclosed) | **Working, signing on** | Live site |
| Signed request creation and Instant payout `FINAL_PAID` | **Working on the public site**; Testnet verified (2026-11-01 pilot, 2026-11-09 production browser run) | funding tx [`CrzQ57Jx…`](https://testnet.nearblocks.io/txns/CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su), [production run](docs/evidence/production-taply-wallet-2026-11-09/result.json) |
| Pay a NEAR request with USDC / USDT / NST / LNC / PEM | **Working**: Ref/Rhea Testnet swap to NEAR, then the normal payment | [USDC](docs/evidence/testnet-e2e/2026-11-09T17-43-37-563Z-usdc-pay.json), [USDT](docs/evidence/testnet-e2e/2026-11-09T18-19-47-447Z-usdt-pay.json), [in the browser on production](docs/evidence/production-taply-wallet-2026-11-09/result.json) |
| QR scanner, pay-by-link | **Working** | Live site |
| Merchant register and store QR (`/merchant`, `/checkout/<account>`) | **UI working; sale signing off** | Live site |
| Contacts | **Working, local to the device** (no server) | `/contacts` |
| Split Pay | **Preparation tool**: equal shares, then one normal request per person (each signed on chain) | `/split` |
| Recurring templates | **Preparation tool**: saved templates pre-fill a request; nothing runs automatically | `/recurring` |
| DEMO journey | **Synthetic**, stamped DEMO | `/demo`, `/demo/handshake` |
| Live Handshake: presence, joined/reviewing, disconnect/reconnect, expiry, single-phone join | **Working** (coordination only; needs the room store, see below) | [two-browser Testnet run](docs/evidence/live-handshake-2026-11-10/result.json) |
| Contract-bound merchant sessions (G2) | **Candidate only**; the pilot contract cannot bind a session | [PHASE_7_SHARED_ROOM.md](docs/PHASE_7_SHARED_ROOM.md) |
| Protected Pay (escrow, refund, release) | **Disabled** | — |
| Taply Wallet: username.testnet, 12-word phrase, send, pay, swaps | **Working on NEAR Testnet**; owner decision, **no independent security review** | `/wallet/create` |
| Social login, sponsored gas | **Disabled** | — |

## Contract candidates: Testnet-verified, not on taplyapp.xyz

The repository also holds isolated, **unreviewed** contract candidates (the G1 pilot is untouched),
proven with real NEAR Testnet transactions from disposable automation accounts
([evidence index](docs/RELEASE_EVIDENCE_INDEX.md), [AI review — not an audit](docs/SECURITY_REVIEW_2026-11-09.md)):

| Capability | Testnet proof |
| --- | --- |
| Protected Pay (escrow) | real refund and real release on locked contract accounts; early release / late cancel / wrong canceller / double release refused |
| NEP-141 token payments (TEST-ONLY token, no value) | exact token deltas, duplicate and fake-token transfers returned, token escrow refund |
| Merchant sale bound to a Handshake session (G2) | contract session commitment = comparison code on both phones; replay refused; Verified |

These stay **off** on the public site until a human security review. (The receipt verifier's archival fallback and
the Verified Request chip from the same work are already live.)

## Run it locally

Requirements: Node **24.22.2** (`.node-version`) and pnpm **11.5.0**.

```sh
git clone https://github.com/KendineCrypto/taply.git
cd taply                      # default branch main = the released source
pnpm install --frozen-lockfile
pnpm check                    # brand, build, types, lint and all workspace tests (no funds)
cp apps/web/env/public-readonly.env.example apps/web/.env.local   # taplyapp.xyz config; set NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=on to sign
pnpm --filter @taply/web build && pnpm --filter @taply/web start  # http://localhost:3000
```

- `/demo` works with no configuration. The pilot sale and receipt need the
  contract settings above.
- Public Testnet RPCs rate-limit per IP (`HTTP 429`). Taply then says the RPC is
  busy, waits as instructed and signs nothing; the receipt page falls back to the
  labelled archived record. Never pay again to make a demo succeed.
- Signing is gated by `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=on` **and** a passing
  on-chain contract check at a fresh final block (production has it on, by owner
  decision). Taply Wallet additionally needs an unlocked vault and the
  confirmation dialog for every signature.
- Live Handshake locally: run `redis-server --port 6390` and
  `node apps/web/scripts/redis-rest-shim.mjs 6390 8079 <token>`, then start the app with
  `NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE=on KV_REST_API_URL=http://127.0.0.1:8079 KV_REST_API_TOKEN=<token>`.
  In production the same two `KV_REST_API_*` variables come from Vercel → Storage → Upstash Redis.
  Two-browser proof: `node docs/evidence/live-handshake-2026-11-10/handshake-e2e.mjs <baseUrl> <outDir> <playwright index.mjs> packages/near-client/testnet-e2e/lib.mjs`.
- Real-browser Testnet proof you can re-run (creates disposable accounts):
  `node docs/evidence/taply-wallet-signing-2026-11-09/taply-wallet-pay-e2e.mjs <baseUrl> <outDir> <playwright index.mjs> packages/near-client/testnet-e2e/lib.mjs`.
  Other-asset payment without a browser: `node packages/near-client/testnet-e2e/token-pay.mjs USDT`.

Contract checks (Rust/WASM/sandbox) run in CI (`instant-pay-sandbox`). The
standalone API checks are `node --test apps/api/test/*.test.mts` (see
`.github/workflows/workspace-check.yml`).

## Verified Testnet evidence

- Ledger with hashes, receipts, blocks and reproduction commands: [`docs/EVIDENCE.md`](docs/EVIDENCE.md).
- Verifier output for the pilot payment: [`docs/evidence/instant-pay-2026-11-01-receipt.json`](docs/evidence/instant-pay-2026-11-01-receipt.json) (also served at `/evidence/instant-pay-2026-11-01-receipt.json`).
- Public read-only contract check, re-run 2026-11-09, 10/10 PASS:
  `node apps/web/scripts/deploy-preflight.mjs post taply-pay-pilot-1.testnet --rpc https://test.rpc.fastnear.com`.
- Nightly release report with the exact production deployment, CI runs and browser results: [`docs/NIGHTLY_RELEASE_REPORT_2026-11-09.md`](docs/NIGHTLY_RELEASE_REPORT_2026-11-09.md).
- 2026-11-09 production evidence: [onboarding (`username.testnet` + 12 words)](docs/evidence/production-2026-11-09-onboarding/), [Taply Wallet pays in NEAR and with test USDC](docs/evidence/production-taply-wallet-2026-11-09/); other-asset runs: [USDC](docs/evidence/testnet-e2e/2026-11-09T17-43-37-563Z-usdc-pay.json), [USDT](docs/evidence/testnet-e2e/2026-11-09T18-19-47-447Z-usdt-pay.json). Session log: [`docs/AUTONOMOUS_PROGRESS.md`](docs/AUTONOMOUS_PROGRESS.md).

## Readiness gates

| Gate | Meaning ([MILESTONES.md](docs/MILESTONES.md)) | State |
| --- | --- | --- |
| G1 | Real native NEAR request → signed settlement → verified `FINAL_PAID` | **Met on Testnet**: public signing on; real browser payments on taplyapp.xyz (2026-11-09). An external-wallet (Meteor) human run is still to be recorded |
| G2 | Merchant QR checkout + authenticated live two-device Handshake | **Partly**: live two-phone session built and proven (coordination only, single-phone join token); contract-level session binding stays a candidate |
| G3 | Protected escrow: real refund and real release on Testnet | **Not met**; Protected Pay disabled |
| G4 | Chain proof/receipt + adversarial and UX robustness | Software evidence exists; no external audit |

## Known limitations

- **Testnet only. Not audited.** Configured-RPC trust model (not a light
  client). The pilot contract keeps a FullAccess key; the verifier refuses a
  receipt if the contract's keys changed during the payment window.
- **Taply Wallet is not independently security-reviewed.** Its key lives in the
  browser (encrypted with the password; recovery = 12 words). It stays unlocked
  on the device after one password entry until **Lock now** (at most 30 days),
  as a nonextractable browser key: anyone holding the unlocked device, or a
  malicious script on the page, could ask it to sign (each transaction still
  shows the confirmation dialog). NEAR Testnet test funds only.
- **NEAR Intents has no Testnet**, so other-asset payments use Ref/Rhea Testnet
  pools; the tokens are test tokens with no real value.
- **With an external wallet, a declined signature blocks a retry.** External
  wallets do not prove that a declined or failed prompt sent nothing, so Taply
  treats it as "result unknown"; the same payer can retry that request only after
  the chain shows it funded, cancelled or expired (default 15 minutes). Taply
  Wallet confirms before signing, so its "Reject" is reported as nothing sent.
- **Other-asset payments are two approvals** (convert, then pay) and not atomic:
  if the payer stops after converting, they simply keep the NEAR.
- **Live Handshake is coordination only.** The room (Upstash Redis) carries
  presence and a short event log; it cannot change terms or mark anything paid —
  both phones read the request and its status from the chain. The sale code is
  not merchant authentication; merchants are shown by account ID only. Rooms
  expire with the request's funding deadline (max 2 h).
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
packages/near-client/  Typed NEAR RPC reads and call builders; encrypted Taply Wallet vault (BIP-39 phrase),
                       reviewed signing backend, curated Ref/Rhea Testnet swap routes
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
  (`apps/web`), the Taply Wallet onboarding/signing and swap work, release
  engineering and documentation, and **Codex** (OpenAI) for the contract,
  backend and shared packages. A human owner directs the work and makes every
  product and release decision. Testnet evidence runs use disposable automation
  accounts created from the public faucet; the owner's own wallets were never
  used by an agent. Allowed and disclosed per HACKATHON.md Q-005.
- **No template or pre-existing app** was used. The repository starts at
  `db10264` (2026-10-29), inside the eligible window (from 2026-10-19, Q-001).
- **Runtime dependencies** (exact versions in `pnpm-lock.yaml` and
  `contracts/payments/Cargo.lock`): web `next`, `react`, `react-dom`,
  `@hot-labs/near-connect` (wallet selector), `jsqr` (QR decoding), `zod`;
  near-client `near-api-js`, `lossless-json`, `jsonc-parser`, `zod` (the
  BIP-39 English wordlist is embedded as public data, checked against its
  standard SHA-256); shared
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
