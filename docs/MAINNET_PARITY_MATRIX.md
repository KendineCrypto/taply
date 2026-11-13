# Taply Mainnet ↔ Testnet parity matrix (integrated)

Updated 2026-11-13, phase 4 (from combined commit `4d2e486`, on which all seven
workflows passed). Phase 3 base: Codex protocol `codex/mainnet-parity-protocol` @
`39cb44d` + Claude application `0fc2468` (cherry-picked) + phase 3 wiring. Phase 4
adds the remaining user-facing workflows on Codex's interfaces, all stopping at the
closed signing/funding gates. Plans of record:
[MAINNET_PROTOCOL_PHASE2.md](MAINNET_PROTOCOL_PHASE2.md),
[MAINNET_FULL_PARITY.md](MAINNET_FULL_PARITY.md).

**NO-GO for Mainnet funds. Full functional parity NOT reached.** Every
real-money gate is closed (`MAINNET_SIGNING_RELEASE_APPROVED`,
`MAINNET_PROTOCOL_SIGNING_RELEASED`, `ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED`,
`MAINNET_INDEPENDENT_VERIFIER_AVAILABLE`, `intentsRouter:false`). Nothing was
deployed, signed, funded, or changed in hosting/DNS/keys.

## Status columns (cumulative; read literally)

- **IMPLEMENTED** — code exists in the Mainnet app, wired to the reviewed interface.
- **TESTED** — unit and/or real-browser tests pass (fixtures/sandbox/synthetic RPC).
- **FUNCTIONAL** — a user can complete the feature end to end on a Mainnet build
  for its full purpose. Any feature that moves funds is **not** FUNCTIONAL while
  signing is gated: a rendered screen or an exact unsigned transaction is not completion.
- **BLOCKED** — what prevents FUNCTIONAL, and who owns it.
- **LIVE VERIFIED** — observed against live Mainnet. Fixtures never count.

| # | Feature | IMPL | TESTED | FUNCTIONAL | BLOCKED by (owner) | LIVE VERIFIED |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Build isolation, routes, Testnet untouched | ✅ | ✅ unit + Testnet runtime parity vs `39cb44d` | ✅ | — | — |
| 2 | Navigation, EN/TR, 360–1280 px, PWA identity | ✅ | ✅ copy parity; product 98 + phase 2/3 browser | ✅ | — | — |
| 3 | Wallet create (12 words, backup check, encrypted Mainnet vault) | ✅ `EncryptedMainnetVault` | ✅ browser: weak password, words shown once, 3-word check, no plaintext phrase, Mainnet-only storage key | ✅ (local wallet only) | — | — |
| 4 | Wallet restore (12 words; Testnet backups rejected) | ✅ | ✅ browser: invalid phrase refused; restore on 2nd device = same account | ✅ | — | — |
| 5 | Unlock / lock (password, session expiry) | ✅ | ✅ browser: wrong password refused, correct unlocks | ✅ | — | — |
| 6 | Implicit-account activation state | ✅ `createMainnetWalletChain` final account + FullAccess key | ✅ browser: not activated → activated only with account+key evidence (synthetic RPC) | ✅ (read) | — | Codex read-only live snapshot of staging account (`docs/evidence/mainnet-protocol-live-read-2026-11-13.json`) |
| 7 | Balances (native, available after storage/gas reserve, USDC) | ✅ | ✅ browser (synthetic RPC); Codex reader tests | ✅ (read) | — | Codex live balance read (staging, zero) |
| 8 | Send NEAR — exact review (recipient, amount, signer key, nonce, block, reserves, 60 s expiry) | ✅ `createMainnetNativeWalletBackend.prepare` | ✅ browser: bad recipient, over-balance, exact review | ❌ | signing gate + release review (owner); physical/external signer acceptance (Codex) | — |
| 9 | Send USDC — exact `ft_transfer` review | ✅ `prepareMainnetUsdcTransfer`; balance + both storage registrations read at the snapshot's own block (app-side reader, see API request) | ✅ unit (same-block, other-block refused, malformed, RPC error) + browser: 6-decimal precision, 25 USDC cap, over-balance, unregistered recipient, exact review (token contract, 1 yocto, 30 Tgas, next nonce, block) | ❌ | signing gate + token signing policy (owner/Codex) | — |
| 10 | Pending / uncertain transactions block new payments | ✅ durable IndexedDB journal read on wallet + send; recorded state (RESERVED/HANDOFF/UNCERTAIN) and tx hash shown, "do not pay again" | ✅ Codex IndexedDB browser test (CAS, crash, restart); phase 4 browser: UNCERTAIN + hash shown, review blocked | ⚠️ blocks and explains, **cannot resolve** | terminal reconciliation not implemented (Codex) | — |
| 11 | External wallet (NEAR Connect, Mainnet only) | ✅ connect/disconnect | ✅ unit | ❌ for payments | physical-wallet acceptance + signing gate | — |
| 12 | Receive (QR, implicit address) | ✅ | ✅ | ✅ | — | — |
| 13 | Payment request create (NEAR/USDC) | ✅ unsigned `create_request` | ✅ checkout 88 | ❌ | deployed contract + signing (owner) | — |
| 14 | Pay request (NEAR wallet) | ✅ unsigned | ✅ | ❌ | same | — |
| 15 | 1Click Base USDC | ✅ quote pipeline, durable attempts | ✅ server + browser | ❌ funding | funded-quote gate, router gas, R-2, deployment acceptance (owner/Codex) | Codex live signed **dry** quote verified |
| 16 | 1Click Solana USDC / Tron USDT | ✅ discovery from live token list only | ✅ server + browser | ❌ | live token-list match + dry quote not recorded; funded gate | — |
| 17 | Payment status incl. R-2 unknown, do-not-repay | ✅ | ✅ | ✅ (read) | — | — |
| 18 | Live Handshake (two devices, same terms, presence, rejoin, end) | ✅ isolated `taply:mainnet:hs` | ✅ 2-device browser on real Redis, 0 foreign keys | ✅ coordination | immutable merchant/session binding into on-chain terms (Codex); Mainnet Redis DB (owner) | — |
| 19 | Merchant register, store identity, tracked sales | ✅ `/m/merchant/register`: store account binding, permanent checkout link, "Next sale" = new request instance | ✅ product suite + phase 4 browser | ⚠️ partial | per-sale request creation needs signing; no on-chain merchant profile (`merchantProfiles:false`) | — |
| 20 | Checkout `/m/checkout/[account]` → fresh request per sale | ✅ each sale = fresh creation nonce → distinct request id; customer opens the sale with `?m=<store>`; pay page refuses a request for another recipient (incorrect merchant account) | ✅ phase 4 browser: same amount → different ids; foreign-origin link refused; wrong store refused with no payment method; matching store confirmed | ❌ | `create_request` signing + deployed pilot contract (owner) | — |
| 21 | Split (exact shares → request prefill) / Recurring (drafts → prefill) | ✅ | ✅ unit + browser | ✅ local tools; on-chain requests need signing | signing for request creation | — |
| 22 | Contacts | ✅ | ✅ | ✅ | — | — |
| 23 | Activity / history (tracked, live status, account filter) | ✅ All / Received / Paid by me / Open, matched against the external wallet **and** the Taply Wallet account | ✅ unit + phase 4 browser | ⚠️ device-local list | Mainnet history index (backend) | — |
| 24 | Receipt — contract state ("Payment recorded") | ✅ | ✅ | ✅ (read) | — | — |
| 25 | Receipt — independently Verified Paid | ⚠️ Codex verifiers exist; Personal Gift now calls `verifyMainnetDirectTransfer` and shows its result as pre-release, never "Verified Paid" | ✅ Codex synthetic RPC tests; phase 4 browser: VERIFIED / tampered → MISMATCH / unknown → NOT_FOUND | ❌ public label never shown | verifier gate; USDC/router/retry/escrow receipts not implemented (Codex) | — |
| 26 | Protected Pay — state display (OPEN…CANCELLED_REFUNDED), cutoff, payer rights | ✅ on Rust-emitted states | ✅ unit + browser (8 states, before/after cutoff) | ✅ (display) | — | — |
| 27 | Protected Pay — lock / cancel+refund / release / retry | ✅ actions from reviewed builders only, on fixtures **and** on the live request page (`/m/protected/<id>` via `createMainnetEscrowReader`); cancel only for the payer, retry only for the recorded destination; countdown from chain time | ✅ browser: LOCKED before cutoff (NOT PAID, countdown, no release) / after cutoff (still NOT PAID, release offered); IN_FLIGHT → R-2, no action; FINAL_PAID = recorded | ❌ | escrow account not configured/deployed; escrow release acceptance; signing (owner/Codex) | — |
| 28 | Protected Pay — create protected request + payer funding | ✅ `/m/protected/new`: terms → contract `quote_create_request` → `prepareMainnetCreateProtectedRequest`; recipient consent; payer page: consent to the shown window → `fund_protected_native` / `ft_transfer_call` | ✅ unit + phase 4 browser: window 1–60 min, payer ≠ recipient, over-ceiling quote refused by the builder, consent before call, fresh id per quote, funding call with exact principal + terms hash | ❌ | unreviewed escrow candidate, no deployed/approved escrow, signing (owner/Codex) | — |
| 29 | Open Gift — create (fee, limits, link key, envelope) | ✅ `prepareMainnetCreateGift`, fresh Ed25519 link key | ✅ browser: total = amount + fee, link key only in fragment | ❌ | no approved Gift account/fee/limits; signing (owner) | — |
| 30 | Open Gift — claim page `/m/gift/<id>#k=` | ✅ real reader `createMainnetGiftReader` (code hash + config pinned), link key moved from URL to session storage, **unwrap separate from claim**, `signMainnetGiftClaim` → `claim_gift` | ✅ phase 4 browser: fragment stripped, unwrap ≠ claim, 64-byte signature, no key → no claim, unknown id → not found | ❌ | same | — |
| 31 | Gift expiry refund / failed-payout retry / PENDING (R-2) | ✅ from `prepareMainnetGiftSettlement` on the live reader | ✅ phase 4 browser: refund only expired+creator; retry only FAILED+beneficiary; PENDING → no action | ❌ | same | — |
| 32 | Personal Gift (direct transfer + verifier) | ✅ compose: exact native transfer review + envelope; `/m/gift/p#p=` fragment payload (no secrets, strict decode); separate unwrap; `verifyMainnetDirectTransfer` | ✅ unit (codec) + phase 4 browser | ❌ (verification of an existing transfer works on synthetic RPC; sending is gated) | signing gate (owner) | — |
| 33 | Gift receipt page `/m/gift/<id>/receipt` | ✅ contract-state receipt (status · payout), never "Verified" | ✅ phase 4 browser | ❌ | no approved/deployed Gift contract; verifier gate | — |

Counts: FUNCTIONAL ✅ 17 (all non-financial or read-only) · partial ⚠️ 3 ·
not functional ❌ 13 (every feature that moves funds). LIVE VERIFIED: only
Codex's read-only snapshots and one signed dry quote.

Phase 4 change in plain terms: the IMPLEMENTED and TESTED gaps are closed. Every
row is now implemented on Codex's reviewed interfaces and tested (rows 9, 20, 28,
32 and 33 previously had no UI). **The FUNCTIONAL count does not change**, because
each remaining row ends in a real-money signature or funding step that stays
behind the closed release gates. A disabled Confirm button is not parity, and this
matrix does not count it as parity.

## Exact remaining blockers

**Protocol / contract (Codex):** terminal attempt reconciliation (unresolved
attempts currently block forever); cross-device/rollback policy;
physical-wallet acceptance and contract/token signing policies; USDC/router/
retry/escrow independent receipts; immutable merchant and Handshake binding
into on-chain terms; upstream router gas envelope; R-2 contained, not eliminated.

**UI (Claude):** none blocking at the gates. Remaining: history index
integration when a backend exists; connect Codex's signing/verification
interfaces as they are delivered (submit paths are already isolated behind
`MAINNET_SIGNING_RELEASE_APPROVED`).

**API change requests (Claude → Codex):**
1. Export a canonical USDC token-evidence reader (`ft_balance_of` +
   `storage_balance_of` for sender and receiver at `block_id = snapshot.blockHash`).
   The app uses `apps/web/src/lib/mainnet/usdc-evidence.ts` until then; it only
   reads and refuses answers from any other block.
2. Terminal attempt reconciliation, so a journal entry can be resolved instead of
   blocking forever (row 10).
3. Escrow/Gift receipt verifiers matching `verifyMainnetDirectTransfer` (rows 25, 33).

**Owner configuration:** see the delivery report (accounts, code hashes,
Gift fee/limits, escrow account, Upstash DB, release reviews). New in phase 4,
all **refused on Production** by `scripts/check-mainnet-env.mjs` until approved:
`NEXT_PUBLIC_TAPLY_GIFT_CONTRACT_ID`, `_CODE_HASH`, `_MIN_YOCTO`, `_MAX_YOCTO`,
`_FEE_YOCTO` (all five or Gift reads "not configured") and
`NEXT_PUBLIC_TAPLY_MAINNET_ESCROW_CONTRACT_ID`, `_CODE_HASH` (Codex's schema
already refuses the pilot, staging, recovery and router accounts).

## Verification

Phase 4 local run (synthetic RPC and sandbox fixtures; **not live Mainnet**):
`pnpm check` exit 0 (web 1541 passed / 1 skipped, near-client 290/290, shared
93/93); API 72/72; Testnet runtime parity vs `4d2e486` 36/36 paths identical
(including new Mainnet-only paths, which 404 identically on Testnet); Webpack
Testnet build OK; static bundle leak check clean; browser suites: phase 4 62/62
([evidence](evidence/mainnet-phase4-2026-11-13/phase4-results.json)), phase 3
39/39, phase 2 26/26 (0 foreign Redis keys), 1Click 88/88, product 98/98,
IndexedDB 4/4. CI links are in the delivery report.
