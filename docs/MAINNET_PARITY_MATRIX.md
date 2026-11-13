# Taply Mainnet ↔ Testnet parity matrix (integrated)

Updated 2026-11-13, **phase 5**. Integration branch `claude/mainnet-phase5`
(pushed to `claude/festive-brahmagupta-qkqex1`): merge of Codex protocol
`codex/mainnet-phase4-protocol` @ `3a186a7` with Claude application `3a9d842`
(merge `fdea61d`), plus phase 5 integration on Codex's unified wallet protocol.
Protocol decision record: [MAINNET_PHASE4_PROTOCOL.md](MAINNET_PHASE4_PROTOCOL.md).

**NO-GO for Mainnet funds. Full functional parity NOT reached.** No transaction
can execute: `MAINNET_SIGNING_RELEASE_APPROVED`, `MAINNET_PROTOCOL_SIGNING_RELEASED`,
`ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED`, `MAINNET_INDEPENDENT_VERIFIER_AVAILABLE`
and `intentsRouter:false` are all closed, and **no authenticated account-global
wallet authority exists in the app** (every real build resolves it as
UNAVAILABLE). Nothing was deployed, signed, funded, or changed in hosting, DNS or keys.

## Evidence classes (never mixed)

- **FIXTURE** — app-side test records in a Preview build (labelled on screen).
- **SANDBOX** — Rust contracts in a local NEAR sandbox (Codex CI workflows).
- **SYNTHETIC RPC** — in-browser responder with Codex's wire shapes; the app's
  real code runs against it. Not Mainnet.
- **SIMULATED AUTHORITY** — single-browser localStorage CAS handed to Codex's own
  coordinator in test builds only (refused on Production). Not account-global.
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
| 8 | Send NEAR — exact review | ✅ `nativeSend` (planner/backend), stable business id | ✅ browser: over-balance (planner), exact review, authority UNAVAILABLE label (phase 4); SIMULATED authority review (phase 5) | ❌ | authenticated authority adapter (Codex/owner); signing release (owner) | — |
| 9 | Send USDC — exact review | ✅ `usdcSend`; planner reads balance + both registrations + pinned token code at the snapshot block (app-side reader removed) | ✅ browser: precision, cap, balance, unregistered (planner errors), exact review | ❌ | USDC code pin approval (observed live: `DVJx7F3d…NX8q`); authority; signing | ✅ USDC contract code hash observed |
| 10 | Pending / unknown outcome, FINAL reconciliation, tombstones, device ownership | ✅ `LedgerPanel` on Codex's coordinator: pending state + hash, hash hint, `reconcile`, permanent record, other-device read-only; legacy v1 entries block (not migrated) | ✅ browser (SIMULATED authority + synthetic RPC): blocks while UNCERTAIN, FINAL_EXECUTION retires (settlement not established), same operation refused forever, explicit new payment only, other device read-only, no-hash/unknown-hint stay unresolved | ⚠️ works only with the simulated test authority | authenticated account-global authority + durable Redis/no-eviction + rollback detection (Codex/owner) | — |
| 11 | External wallet (NEAR Connect) | ✅ connect; reported public key exposed; wallets without it unsupported | ✅ unit | ❌ for payments | physical-wallet acceptance; authority; signing | — |
| 12 | Receive (QR, implicit address) | ✅ | ✅ | ✅ | — | — |
| 13 | Payment request create | ✅ `instantCreate` (planner) + quote-validated preview | ✅ unit (Codex hardening tests kept); browser (fixture preview) | ❌ | pilot contract not deployed (`taply-pay.kendinecrypto.near` UNKNOWN_ACCOUNT on Mainnet); authority; signing | ✅ contract account confirmed absent |
| 14 | Pay request (NEAR wallet) | ✅ `instantPay`; recipient `instantCancel` / `instantRetry` | ✅ browser (fixture); planner path not browser-tested (needs a configured contract build) | ❌ | same | — |
| 15 | 1Click Base USDC | ✅ quote pipeline, durable attempts | ✅ server + browser (1Click suite) | ❌ funding | funded-quote gate, router gas, R-2 (owner/Codex) | Codex signed dry quote (earlier phase) |
| 16 | 1Click Solana USDC / Tron USDT | ✅ | ✅ | ❌ | live route evidence; funded gate | — |
| 17 | Payment status incl. R-2 unknown | ✅ | ✅ | ✅ (read) | — | — |
| 18 | Live Handshake (two devices) | ✅ isolated namespace; join link carries the public sale commitment, customer device verifies it | ✅ 2-device browser on real Redis (phase 2 + phase 5), 0 foreign keys | ✅ coordination | session service does not freeze commerce metadata server-side (Codex requirement 1) | — |
| 19 | Merchant register, store identity | ✅ every sale bound with `bindMainnetCommerceTerms` (fresh session, deterministic id, commitment in memo) | ✅ unit + browser: distinct ids per sale, commitment in `create_request` memo | ⚠️ partial | request creation needs signing; no merchant registry (`merchantProfiles:false`) | — |
| 20 | Checkout → per-sale request, wrong merchant / wrong sale refused | ✅ `verifyMainnetCommerceBinding` on the FINAL request before any payment method | ✅ browser: bound sale verified; tampered hash, other session, malformed refused; wrong store refused | ❌ | signing + deployed contract | — |
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
not functional ❌ 13. **Unchanged from phase 4, by design:** phase 5 replaced
the app's transaction path with Codex's planner, coordinator, commerce binding
and settlement verifiers, but no transaction can execute until the authority
adapter exists and the release gates open. LIVE: read-only only. SETTLEMENT: none.

## Exact remaining blockers

**Security / protocol (Codex):**
1. Authenticated HTTP adapter for `createMainnetWalletAuthority` (principal from
   authentication, never from the request body) and its browser client; until
   then the app cannot reserve, hand off or reconcile across devices.
2. Production durability of the authority store (no eviction, AOF/fsync),
   rollback detection, account enrollment/recovery.
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
contract build; history index integration when a backend exists; swap the
UNAVAILABLE authority for the reviewed adapter when delivered.

## Verification

VERIFICATION_PLACEHOLDER

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
