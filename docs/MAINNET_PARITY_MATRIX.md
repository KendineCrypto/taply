# Taply Mainnet ↔ Testnet parity matrix (integrated)

Updated 2026-11-13, **phase 6**. Branch `claude/mainnet-phase6` (pushed to
`claude/festive-brahmagupta-qkqex1`): merge `492d4e1` of Codex signing authority
`codex/mainnet-signing-authority` @ `850080d` into the phase 5 application `c14c5cf`,
plus the application side of the authenticated authority
([MAINNET_AUTHORITY_INTEGRATION.md](MAINNET_AUTHORITY_INTEGRATION.md)). Protocol records:
[MAINNET_SIGNING_AUTHORITY.md](MAINNET_SIGNING_AUTHORITY.md),
[MAINNET_PHASE4_PROTOCOL.md](MAINNET_PHASE4_PROTOCOL.md).

**NO-GO for Mainnet funds. Full functional parity NOT reached.** No transaction
can execute: `MAINNET_SIGNING_RELEASE_APPROVED`, `MAINNET_PROTOCOL_SIGNING_RELEASED`,
`ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED`, `MAINNET_INDEPENDENT_VERIFIER_AVAILABLE`
and `intentsRouter:false` are all closed. The app now speaks to Codex's
**authenticated** authority, but only in isolated test configurations: every real
build resolves it as UNAVAILABLE, the app server has no authority endpoint, no
production witness exists, and wallet authorization of authority commands is itself
refused while signing is gated. Nothing was deployed, signed, funded, or changed in hosting, DNS or keys.

## Evidence classes (never mixed)

- **FIXTURE** — app-side test records in a Preview build (labelled on screen).
- **SANDBOX** — Rust contracts in a local NEAR sandbox (Codex CI workflows).
- **SYNTHETIC RPC** — in-browser responder with Codex's wire shapes; the app's
  real code runs against it. Not Mainnet.
- **SIMULATED AUTHORITY** — single-browser localStorage CAS handed to Codex's own
  coordinator in test builds only (refused on Production). Not account-global.
- **TEST AUTHORITY** — Codex's real authenticated authority + HTTP adapter + fenced
  Redis persistence on real Redis with an in-memory TEST witness (not production).
- **LIVE READ** — read-only calls to Mainnet RPC
  ([evidence](evidence/mainnet-phase5-2026-11-13/live-mainnet-read-only.json)).
- **SETTLEMENT** — a real Mainnet transfer verified on chain. **None exists.**

## Status columns (cumulative; read literally)

- **IMPL** — implemented in the Mainnet app on the reviewed Codex interface.
- **TESTED** — passing tests; the evidence class is named.
- **FUNCTIONAL** — a user can complete the feature end to end on a Mainnet build.
  A feature that moves funds is **not** FUNCTIONAL while it cannot execute: an
  exact unsigned review is not completion.
- **BLOCKED** — what prevents FUNCTIONAL, and who owns it.
- **LIVE** — observed on live Mainnet (read-only). Fixtures/synthetic never count.

Every financial row below now prepares its transaction through
`createMainnetOperationPlanner` / `createMainnetWalletBackend` (all 17
`MainnetOperation` kinds are wired); the app has no other builder path for
real builds, no own coordinator and no own token reader.

| # | Feature | IMPL | TESTED | FUNCTIONAL | BLOCKED by (owner) | LIVE |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Build isolation, routes, Testnet untouched | ✅ | ✅ unit + Testnet runtime parity vs `3a9d842` | ✅ | — | — |
| 2 | Navigation, EN/TR, 360–1280 px, PWA identity | ✅ | ✅ copy parity; product + phase 2–5 browser; no horizontal overflow | ✅ | — | — |
| 3 | Wallet create (12 words, backup check, encrypted Mainnet vault) | ✅ `EncryptedMainnetVault` | ✅ browser | ✅ (local wallet) | — | — |
| 4 | Wallet restore (Testnet backups rejected) | ✅ | ✅ browser | ✅ | — | — |
| 5 | Unlock / lock | ✅ | ✅ browser | ✅ | — | — |
| 6 | Implicit-account activation | ✅ `createMainnetWalletChain` | ✅ browser (synthetic RPC) | ✅ (read) | — | ✅ staging account snapshot, block 224405330 |
| 7 | Balances (native, available, USDC) | ✅ | ✅ browser (synthetic RPC) | ✅ (read) | — | ✅ staging account read (0 NEAR) |
| 8 | Send NEAR — exact review | ✅ `nativeSend` via Codex backend; authenticated-authority mode wired (challenge → wallet authorization → execute) | ✅ browser: planner errors, review, authority UNAVAILABLE (phase 4), SIMULATED (phase 5), TEST AUTHORITY reached + gated (phase 6); Node integration: reserve/handoff/uncertain/reconcile over HTTP | ❌ | production witness + mounted adapter (owner/Codex); wallet authorization + signing release (owner) | — |
| 9 | Send USDC — exact review | ✅ `usdcSend`; planner reads balance + both registrations + pinned token code at the snapshot block (app-side reader removed) | ✅ browser: precision, cap, balance, unregistered (planner errors), exact review | ❌ | USDC code pin approval (observed live: `DVJx7F3d…NX8q`); authority; signing | ✅ USDC contract code hash observed |
| 10 | Pending / unknown outcome, FINAL reconciliation, tombstones, device ownership | ✅ simulated (phase 5) and authenticated (phase 6) paths; legacy v1 entries still block | ✅ phase 5 browser (simulated); **Node integration on Codex's real authority + real Redis**: lost response → UNCERTAIN → blocks → FINAL_EXECUTION (settlement not established) → replay refused; second device read-only; external hash lost before persistence stays blocked; rollback fails closed | ⚠️ proven against the TEST authority only | production witness, durability/rollback controls, device recovery (owner/Codex) | — |
| 11 | External wallet (NEAR Connect) | ✅ reported key; `signMessage` routed only through `authorizeMainnetNearConnectCommand` | ✅ unit: gated, `signMessage` never called | ❌ for payments | physical wallet acceptance; lost-hash recovery protocol; signing | — |
| 12 | Receive (QR, implicit address) | ✅ | ✅ | ✅ | — | — |
| 13 | Payment request create | ✅ `instantCreate` (planner) + quote-validated preview | ✅ unit (Codex hardening tests kept); browser (fixture preview) | ❌ | pilot contract not deployed (`taply-pay.kendinecrypto.near` UNKNOWN_ACCOUNT on Mainnet); authority; signing | ✅ contract account confirmed absent |
| 14 | Pay request (NEAR wallet) | ✅ `instantPay`; recipient `instantCancel` / `instantRetry` | ✅ browser (fixture); planner path not browser-tested (needs a configured contract build) | ❌ | same | — |
| 15 | 1Click Base USDC | ✅ quote pipeline, durable attempts | ✅ server + browser (1Click suite) | ❌ funding | funded-quote gate, router gas, R-2 (owner/Codex) | Codex signed dry quote (earlier phase) |
| 16 | 1Click Solana USDC / Tron USDT | ✅ | ✅ | ❌ | live route evidence; funded gate | — |
| 17 | Payment status incl. R-2 unknown | ✅ | ✅ | ✅ (read) | — | — |
| 18 | Live Handshake (two devices) | ✅ join link carries the public sale commitment; customer device verifies it; presence never settles | ✅ 2-device browser on real Redis (phases 2, 5) | ✅ coordination | server-side freeze of session metadata is now `bindCommerce` (authority, gated); Handshake server still freezes only the request id | — |
| 19 | Merchant register, store identity | ✅ every sale bound locally; authority `bindCommerce` freeze attempted and its status shown | ✅ browser (phases 5, 6); Node integration: same session+terms → same; changed amount / merchant → refused; repeated creation → same id | ⚠️ partial | request creation needs signing; freeze needs wallet authorization (gated) | — |
| 20 | Checkout → per-sale request, wrong merchant / wrong sale refused | ✅ FINAL request compared with the reviewed sale before any payment method | ✅ browser (phase 5) + Node integration (invalid commitment, different request) | ❌ | signing + deployed contract | — |
| 21 | Split / Recurring (prefills) | ✅ | ✅ | ✅ local tools | on-chain request creation needs signing | — |
| 22 | Contacts | ✅ (owner: external wallet or Taply Wallet) | ✅ | ✅ | — | — |
| 23 | Activity / history | ✅ account filters + the account's permanent execution record | ✅ unit + browser | ⚠️ device-local + own ledger | Mainnet history index (backend) | — |
| 24 | Receipt — contract state ("Payment recorded") | ✅ | ✅ | ✅ (read) | — | — |
| 25 | Receipt — independent settlement check | ✅ `verifyMainnetSettlement` (instant, escrow), `verifyMainnetGiftSettlement`, `verifyMainnetDirectTransfer` / `verifyMainnetUsdcTransfer` for own sends; NEAR-side, pre-release wording | ✅ Codex synthetic + sandbox receipt tests; browser: direct transfer VERIFIED on synthetic graph, fixture receipts say "nothing to check" | ❌ public label never shown | verifier release gate (owner/Codex); no real settlement exists to verify | — |
| 26 | Protected Pay — states, cutoff, payer rights | ✅ | ✅ unit + browser (8 states, chain-time countdown) | ✅ (display) | — | — |
| 27 | Protected Pay — cancel / release / retry | ✅ `escrowCancel/Release/Retry` (planner), offered only to the right account | ✅ browser: before/after cutoff, in-flight, failed, final | ❌ | escrow not configured/deployed/reviewed; authority; signing | — |
| 28 | Protected Pay — create + fund | ✅ `escrowCreate` after recipient consent; `escrowFund` after payer consent | ✅ browser: builder ceiling, consent, fresh id, exact funding call | ❌ | same | — |
| 29 | Open Gift — create | ✅ `giftCreate` with fresh link key; fixture demo kept | ✅ browser (fixture create + total) | ❌ | no approved Gift account/fee/limits; authority; signing | — |
| 30 | Open Gift — claim (separate unwrap) | ✅ link-key signature → `giftClaim` (planner re-verifies it) | ✅ browser: planner-verified claim_gift, no key → no claim | ❌ | same | — |
| 31 | Gift refund / retry / PENDING (R-2) | ✅ `giftRefund` / `giftRetry` (planner) | ✅ browser: refund_gift / retry_payout prepared; PENDING → no action | ❌ | same | — |
| 32 | Personal Gift | ✅ `nativeSend` + envelope; `#p=` link; direct-transfer check | ✅ unit + browser | ❌ (checking an existing transfer works on synthetic RPC; sending cannot execute) | authority; signing | — |
| 33 | Gift receipt page | ✅ contract-state receipt + settlement check | ✅ browser | ❌ | no deployed Gift contract; verifier gate | — |

Counts: FUNCTIONAL ✅ 17 (all non-financial or read-only) · partial ⚠️ 3 ·
not functional ❌ 13. **Unchanged, by design:** phase 6 connects the app to
Codex's authenticated authority end to end in an isolated test configuration, but
no financial feature can complete: the authority endpoint is not mounted in any
deployment, no production witness exists, and wallet authorization and transaction
signing are both gated. LIVE: read-only only. SETTLEMENT: none.

## Exact remaining blockers

**Security / protocol (Codex/owner):** see
[MAINNET_AUTHORITY_INTEGRATION.md](MAINNET_AUTHORITY_INTEGRATION.md) for the witness,
mounting, multi-account routing, device-loss and recovery requirements.
1. Production witness (permanent, linearizable, outside Redis's restore domain) and
   its security review; the authority endpoint stays unmounted until then.
2. Production durability of the authority store (no eviction, AOF/fsync), rollback
   recovery procedure, device loss/recovery (no takeover exists).
3. Physical NEAR Connect acceptance with the unified policies (wallets must report
   the account public key; external hash is only a hint).
4. R-2: a successful transfer with a failed/unknown callback stays IN_FLIGHT /
   PENDING; no on-chain recovery mechanism.
5. Router gas envelope and upstream (origin-chain) refund attribution for 1Click.
6. Session service freezing commerce metadata server-side (the app keeps it in
   the immutable on-chain memo + payer-reviewed hash; the Handshake server only
   freezes the request id).
7. Public verifier release (`MAINNET_INDEPENDENT_VERIFIER_AVAILABLE`).

**Owner:** deploy/approve the pilot contract (not deployed on Mainnet), Gift
account/fee/limits, escrow account and review, USDC code pin, Mainnet Upstash DB,
and the signing / funded-quote / verifier release reviews.

**Claude (app):** browser test of the instant planner path on a configured
contract build; a complete authority-command confirmation UI (reachable only once
wallet authorization is released); history index integration when a backend exists.

## Verification

Local run on the final phase 5 tree (Linux, Node 24), repeated after the bundle-guard fix. Evidence class in brackets.

- `pnpm check` exit 0: shared 93/93, near-client 323/323, web 1549 passed / 1 skipped.
- API strict types, lint and tests: 75/75.
- Browser, unauthority build [FIXTURE + SYNTHETIC RPC + real Redis]: phase 2
  26/26 (0 foreign Redis keys), phase 3 39/39, phase 4 65/65.
- Browser, simulated-authority build [SIMULATED AUTHORITY + SYNTHETIC RPC + real
  Redis]: phase 5 31/31 ([results](evidence/mainnet-phase5-2026-11-13/phase5-results.json)).
- Browser, plain preview [FIXTURE]: 1Click 88/88, product 98/98; Codex IndexedDB
  harness 7/7 (4 v1 + 3 v2 coordinator checks).
- Static bundle checks: no Testnet contract/vault key; the simulated authority is
  absent from non-simulation bundles (now a CI guard).
- Testnet runtime parity vs `3a9d842` (production-equivalent Testnet output):
  38/38 paths identical, including every new Mainnet-only path (identical 404).
  Webpack Testnet build OK.
- [LIVE READ] Mainnet RPC, read-only: genesis validated; staging
  `devkendinecrypto.near` snapshot (0 NEAR, FullAccess key); pilot contract
  `taply-pay.kendinecrypto.near` **does not exist**; native USDC code hash and
  `intents.near` code hash observed.
- [SANDBOX] Rust contracts and Codex's real-sandbox receipt checks: the
  `mainnet-core-candidate`, `gift-contract`, `protected-pay-candidate` and
  `instant-pay-sandbox` workflows (links in the delivery report).
- [SETTLEMENT] none. No transaction was signed or sent.

CI on the merge commit `fdea61d` (Step 1): all seven workflows passed
(workspace-check 43489459915, mainnet-protocol-parity 43489465618,
mainnet-core-candidate 43489470351, gift-contract 43489474695,
protected-pay-candidate 43489479964, instant-pay-sandbox 43489485327,
wallet-browser-check 43489490018). Final-SHA CI: see the delivery report.

## Phase 4 protocol delta (isolated development branch)

See [exact typed interfaces and security decision](MAINNET_PHASE4_PROTOCOL.md).
This section supersedes the corresponding protocol gaps above; it does not
increase the number of live functional financial features.

| Area | Implemented now | Still required |
| --- | --- | --- |
| Wallet uncertain outcomes | Exact FINAL execution reconciliation, permanent replay tombstones, nonce/account/device CAS fencing | Authenticated semantic authority adapter, production durability/rollback controls, UI migration, release acceptance |
| Native / USDC / contract signing | Unified internal/external wallet policy, fresh pinned reads, exact actions, Gift link signature preflight | Physical wallet acceptance; all real-money signing remains disabled |
| Independent receipts | Native/USDC instant, Protected refund/release, retry histories, Gift retry histories, NEAR-side router delivery | Actual full-chain integration evidence, UI wiring, public verifier release gate; no upstream refund proof |
| Merchant / Handshake | Immutable exact terms/session commitment and deterministic per-sale request ID using existing contract ABI | Session service must freeze metadata and compare pinned FINAL terms; native registry capabilities remain disabled |
| Gift | Shared signing policy and independent claim/refund/retry verification | Approved account/caps/fee, deployment and end-to-end proof, remaining Claude page wiring |
| Protected Pay | Signing policies and full settlement-history verifier | Approved escrow configuration, release acceptance, actual integration evidence; R-2 stays contained |

No Testnet contract source or frontend route is changed by this protocol work.
Base USDC / 1Click durable-attempt hardening remains intact. Solana/Tron inventory
and all existing workflow gates remain required. **NO-GO for real funds and for
claiming complete product parity** until the named security/integration gaps close.
