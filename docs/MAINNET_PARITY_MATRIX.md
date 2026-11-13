# Taply Mainnet ↔ Testnet parity matrix

Updated 2026-11-13 by Claude Code (application integration, phase 2).
Base: Codex `codex/mainnet-full-parity` @ `8ca5059`. Plan of record:
[MAINNET_FULL_PARITY.md](MAINNET_FULL_PARITY.md).

**Status: NO-GO for Mainnet funds; full functional parity NOT reached.** All
three release gates, `protectedPay:false` and `intentsRouter:false` are
unchanged. Nothing was deployed, signed, funded, or changed in hosting/DNS.

## Status vocabulary (read literally)

| Status | Meaning |
| --- | --- |
| **Functional** | Works end to end on a Mainnet build for its stated scope, tested in a real browser. Moves no funds. |
| **Functional (read)** | Reads real Mainnet state (or labelled fixtures in a Preview); no transaction involved. |
| **Review-only** | Builds and shows the exact unsigned transaction from Codex's builders; signing is gated off. **Not a completed feature.** |
| **Blocked** | Needs an interface or contract that does not exist yet. **Not a completed feature**, whatever the screen shows. |

"Real Mainnet evidence" lists only observations against live Mainnet. Fixtures
and synthetic signatures are never evidence of a payment.

## Matrix

| # | Feature | Testnet | Mainnet route | Status | Test evidence | Real Mainnet evidence | Blocker / owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Build-time network isolation, route allowlist, Testnet untouched | — | all | Functional | route tests; Testnet runtime parity vs `8ca5059` (§Verification) | — | — |
| 2 | Navigation (Wallet · Activity · Tap/tools · Contacts · Settings) | `/` | `/m`, `/m/tools` | Functional | Codex product suite 98/98 (rerun on this commit) | — | — |
| 3 | EN/TR copy, mobile 360–430 px | yes | all | Functional | key-parity tests (mainnet, product, live, activity, origin copy); browser at 360/390/430/1280 | — | — |
| 4 | PWA install identity | `manifest.webmanifest` | `/m/manifest.webmanifest` | Functional (this phase) | build + manifest test | — | — |
| 5 | External wallet connect (NEAR Connect, mainnet only) | `/wallet` | `/m/wallet` | Functional (code) | unit tests (options, Testnet accounts refused) | none: no real mainnet wallet session tested | real-device wallet test (owner) |
| 6 | Balances (NEAR + USDC, final block) | `/wallet` | `/m/wallet` | Functional (read) | Codex reader tests | Codex live read of staging account (`docs/evidence/mainnet-full-parity-2026-11-13/live-balance-read.json`) | spendable/storage-staked calculation (client) |
| 7 | Taply Wallet create (internal, mnemonic) | `/wallet/create` | `/m/wallet/create` | **Blocked** | — | — | Mainnet vault + custody review + account funding (Codex signing, owner) |
| 8 | Taply Wallet restore | `/wallet/restore` | `/m/wallet/restore` | **Blocked** | Testnet vault provably absent from mainnet bundle | — | same as 7 |
| 9 | Send NEAR / USDC | `/send` | `/m/send` | **Blocked** (draft only) | — | — | reviewed direct-transfer builders + signing (Codex) |
| 10 | Receive (QR + account) | `/receive` | `/m/receive` | Functional | product suite | — | share sheet polish (frontend) |
| 11 | Transaction review (exact unsigned call) | yes | create / pay / storage_deposit | Review-only | unit + browser: exact `create_request`, `ft_transfer_call` with shared message, `storage_deposit` | — | signing gate (owner) |
| 12 | Create payment request (NEAR/USDC, caps, storage bond, USDC registration) | `/request/new` | `/m/request/new` | Review-only | 1Click/QA suites | — | deployed contract pin + signing (Codex, owner) |
| 13 | Request prefill from Split / Recurring | — | `/m/request/new?…` | Functional (this phase) | prefill tests; browser: split share → composer with exact `3.333334` | — | — |
| 14 | Pay request with NEAR wallet | `/pay/[id]` | `/m/pay/[id]` | Review-only | unit + browser | — | signing (Codex, owner) |
| 15 | Pay from Base USDC (1Click) | — | `/m/pay/[id]` | Functional quote pipeline (fixture/dry); funding gated | 1Click server + browser suites; checkout 88/88 | Codex: live signed **dry** quote verified (`docs/evidence/mainnet-audit-2026-11-13/live-dry-probe.json`; `minAmountOut == amountOut`) | funded quotes gate, `intentsRouter:false`, router gas envelope (Codex, owner) |
| 16 | Pay from Solana USDC (1Click) | — | same | Functional quote pipeline (this phase), route offered only if 1Click's live token list matches mint `EPjFWdd5…` exactly | 5 service tests, validators, browser: Solana quote review | **none** (sandbox cannot reach 1Click) | live dry quote recording; funded gate (owner) |
| 17 | Pay from Tron USDT (1Click) | — | same | Functional quote pipeline (this phase), resolved from live token list (contract `TR7NHqje…`) | validators (base58check), service test, browser: contract refused as refund | **none**; Tron asset ID not yet observed live | live token-list + dry quote recording (owner/Claude) |
| 18 | Payment status (Awaiting … Unknown), R-2 unknown, do-not-repay | yes | `/m/pay/[id]` | Functional (read) | state-model tests; browser | — | — |
| 19 | QR scan (camera + paste, same-origin only) | `/scan` | `/m/scan` | Functional | product suite (paste); cross-origin rejection tests | — | real-device camera test |
| 20 | Merchant dashboard / store QR | `/merchant` | `/m/merchant` | Partial: identity QR, tracked requests with live status | product suite | — | indexed sales, registration interface (Codex) |
| 21 | Merchant checkout `/checkout/[account]` (fresh request per sale) | yes | `/m/checkout/[account]` | **Blocked** for per-sale creation | identity validation tests | — | merchant profile reader + signing (Codex) |
| 22 | Live Handshake (two screens, same request, comparison code, presence, rejoin, end, expiry) | `/s/[id]` | `/m/s/[roomId]` + merchant panel on `/m/pay/[id]` | **Functional (this phase)** | 7 unit tests; browser two-device run 15 checks against **real Redis**; all keys under `taply:mainnet:hs:` | — (no Mainnet host/DB yet) | mainnet Upstash DB + deployed contract (owner) |
| 23 | Activity / payment history | `/activity` | `/m/activity` | Functional for this device's tracked requests, each read live (this phase) | unit + product suite | — | complete Mainnet history index (backend) |
| 24 | Receipt (contract state: amount, merchant, payer/router, times, operation, hashes) | `/receipt/[id]` | `/m/receipt/[id]` | Functional (read) (this phase) — "Payment recorded", never "Verified" | 3 UI tests; browser | — | — |
| 25 | Verified receipt (independent receipt graph) | `/receipt/[id]` | — | **Blocked** | gate test (`MAINNET_INDEPENDENT_VERIFIER_AVAILABLE=false`) | — | mainnet verifier (Codex) |
| 26 | Protected Pay lock / refund / release | `/protected/*` | `/m/protected/*` | **Blocked** | — | — | Mainnet escrow contract (`protectedPay:false`), interface (Codex) |
| 27 | Personal Gift / Open Gift — compose + animated envelope | `/gift/new` | `/m/gift/new` | Functional draft (Codex) | product suite | — | — |
| 28 | Gift funding, claim, Open Gift page, gift receipt | `/gift/*` | `/m/gift/*` | **Blocked** | — | — | Mainnet Gift contract/config, claim interface (Codex) |
| 29 | Contacts (per-account, local) | `/contacts` | `/m/contacts` | Functional | Codex tests + product suite | — | edit/import/export (frontend) |
| 30 | Split (exact integer shares) | `/split` | `/m/split` | Functional calc + per-share request prefill | Codex tests; prefill browser check | — | on-chain per-share requests need signing |
| 31 | Recurring (drafts, never auto-debit) | `/recurring` | `/m/recurring` | Functional drafts + "Prepare request" prefill | Codex tests; prefill tests | — | occurrence IDs/timezone (frontend/shared) |
| 32 | Settings | `/settings` | `/m/settings` | Functional | product suite | — | internal-wallet security settings (blocked with 7) |

Counts: Functional/Functional(read) 21, Review-only 3, Partial 1, Blocked 7.
Rows 7–9, 21, 25, 26, 28 cannot be completed without Codex's interfaces and owner
approvals; their screens explain this and offer no controls that look active.

## This phase's changes (Claude Code)

- Live Handshake on Mainnet: the reviewed Testnet room engine gains a
  `namespace` option (default `taply:hs` = Testnet unchanged); Mainnet uses
  `taply:mainnet:hs`, its own API (`/api/mainnet/handshake/*`), its own browser
  storage keys, and opens rooms only for OPEN instant requests on the pinned
  Mainnet contract (or labelled fixtures in a Preview).
- Activity with live per-request status; contract-state receipt page.
- Solana USDC and Tron USDT origins: asset IDs resolved from 1Click's token list
  by exact (chain, symbol, decimals, contract) match; Solana base58 and Tron
  base58check refund validation; `/api/mainnet/oneclick/origins`; chain picker.
- Split/Recurring → request composer prefills (re-validated, never coerced).
- Mainnet PWA manifest.

No signing, escrow, Gift, Handshake engine or verifier was duplicated.

## Verification (2026-11-13, this sandbox: Node 24.22.3, pnpm 11.5.0, real redis-server 7)

| Check | Result |
| --- | --- |
| `pnpm check` | exit 0 — shared 93/93, near-client 278/278, web **1493 passed / 1 skipped** (Codex `8ca5059`: 1,457 + skips) |
| API (strict types, lint, offline tests incl. real Redis) | 72/72 |
| Phase 2 unit/UI tests | server 17 (Solana/Tron validators and resolution, Solana/Tron quotes, origins, Handshake namespace isolation and deadlines, prefills, manifest); UI 8 (copy parity, receipt never "Verified", Live client storage/API isolation) |
| Testnet runtime parity vs `8ca5059` (both production builds served, normalized HTML) | **29/29** paths identical before the manifest change, **24/24** after it (Testnet pages, `/s/…`, `/api/handshake/health`, 404s, all `/m*` and `/api/mainnet/*`) |
| Testnet Webpack build (CI step) | exit 0 |
| Mainnet preview build (fixtures, Handshake on) | guard PASS; no Testnet vault key or contract in any static file |
| Phase 2 browser suite (`scripts/mainnet-parity-phase2-qa.mjs`) | **26/26** — evidence `docs/evidence/mainnet-parity-phase2-2026-11-13/` |
| Codex checkout suite / product suite, on this build | **88/88** / **98/98** |
| Redis after the two-device run | 10 keys, **0** outside `taply:mainnet:` |
| Mainnet server errors during all suites | 0 |

Not verified: anything live on Mainnet from this sandbox (1Click and Mainnet
RPC are blocked by the egress proxy), a real Mainnet wallet session, camera
hardware, Handshake on a deployed host with the Mainnet Upstash database.
