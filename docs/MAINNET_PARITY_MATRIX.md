# Taply Mainnet ↔ Testnet parity matrix (integrated)

Updated 2026-11-13, phase 3. Integration branch: Codex protocol
`codex/mainnet-parity-protocol` @ `39cb44d` + Claude application `0fc2468`
(cherry-picked) + phase 3 wiring. Plans of record:
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
| 9 | Send USDC | ⚠️ builder exists (`prepareMainnetUsdcTransfer`), no UI | ❌ | ❌ | token signing policy (Codex), UI (Claude) | — |
| 10 | Pending / uncertain transactions block new payments | ✅ durable IndexedDB journal read on wallet + send | ✅ Codex IndexedDB browser test (CAS, crash, restart); UI blocks when unresolved | ⚠️ blocks correctly, **cannot resolve** | terminal reconciliation not implemented (Codex) | — |
| 11 | External wallet (NEAR Connect, Mainnet only) | ✅ connect/disconnect | ✅ unit | ❌ for payments | physical-wallet acceptance + signing gate | — |
| 12 | Receive (QR, implicit address) | ✅ | ✅ | ✅ | — | — |
| 13 | Payment request create (NEAR/USDC) | ✅ unsigned `create_request` | ✅ checkout 88 | ❌ | deployed contract + signing (owner) | — |
| 14 | Pay request (NEAR wallet) | ✅ unsigned | ✅ | ❌ | same | — |
| 15 | 1Click Base USDC | ✅ quote pipeline, durable attempts | ✅ server + browser | ❌ funding | funded-quote gate, router gas, R-2, deployment acceptance (owner/Codex) | Codex live signed **dry** quote verified |
| 16 | 1Click Solana USDC / Tron USDT | ✅ discovery from live token list only | ✅ server + browser | ❌ | live token-list match + dry quote not recorded; funded gate | — |
| 17 | Payment status incl. R-2 unknown, do-not-repay | ✅ | ✅ | ✅ (read) | — | — |
| 18 | Live Handshake (two devices, same terms, presence, rejoin, end) | ✅ isolated `taply:mainnet:hs` | ✅ 2-device browser on real Redis, 0 foreign keys | ✅ coordination | immutable merchant/session binding into on-chain terms (Codex); Mainnet Redis DB (owner) | — |
| 19 | Merchant QR, store identity, tracked sales | ✅ | ✅ product suite | ⚠️ partial | indexed sales; per-sale request needs signing | — |
| 20 | Checkout `/m/checkout/[account]` fresh request per sale | ⚠️ identity only | ✅ | ❌ | merchant profile reader + signing | — |
| 21 | Split (exact shares → request prefill) / Recurring (drafts → prefill) | ✅ | ✅ unit + browser | ✅ local tools; on-chain requests need signing | signing for request creation | — |
| 22 | Contacts | ✅ | ✅ | ✅ | — | — |
| 23 | Activity / history (tracked, live status) | ✅ | ✅ | ⚠️ device-local list | Mainnet history index (backend) | — |
| 24 | Receipt — contract state ("Payment recorded") | ✅ | ✅ | ✅ (read) | — | — |
| 25 | Receipt — independently Verified Paid | ⚠️ Codex verifiers exist (native first-attempt, gift, direct transfer) | ✅ Codex synthetic RPC tests | ❌ public label never shown | verifier gate; USDC/router/retry/escrow receipts not implemented (Codex) | — |
| 26 | Protected Pay — state display (OPEN…CANCELLED_REFUNDED), cutoff, payer rights | ✅ on Rust-emitted states | ✅ unit + browser (8 states, before/after cutoff) | ✅ (display) | — | — |
| 27 | Protected Pay — lock / cancel+refund / release / retry | ✅ actions from reviewed builders only | ✅ browser: LOCKED→cancel (before) / release (after); FAILED→retry; IN_FLIGHT→none + R-2 | ❌ | escrow account not configured/deployed; escrow release acceptance; signing (owner/Codex) | — |
| 28 | Protected Pay — create protected request | ⚠️ builder exists, no create UI | ❌ | ❌ | needs quote from deployed escrow; UI (Claude) | — |
| 29 | Open Gift — create (fee, limits, link key, envelope) | ✅ `prepareMainnetCreateGift`, fresh Ed25519 link key | ✅ browser: total = amount + fee, link key only in fragment | ❌ | no approved Gift account/fee/limits; signing (owner) | — |
| 30 | Open Gift — claim (link-key signature, Mainnet domain) | ✅ `signMainnetGiftClaim` → `claim_gift` | ✅ browser: 64-byte signature, claim call | ❌ | same | — |
| 31 | Gift expiry refund / failed-payout retry / PENDING (R-2) | ✅ from `prepareMainnetGiftSettlement` | ✅ browser: refund only expired+creator; retry only FAILED; PENDING → no action | ❌ | same | — |
| 32 | Personal Gift (direct transfer + verifier) | ⚠️ verifier exists (`verifyMainnetDirectTransfer`); send path = row 8 | ❌ UI | ❌ | signing gate; UI wiring (Claude) | — |
| 33 | Gift receipt page | ⚠️ `verifyMainnetGiftReceipt` exists | ❌ UI | ❌ | live gift + verifier gate | — |

Counts: FUNCTIONAL ✅ 17 (all non-financial or read-only) · partial ⚠️ 3 ·
not functional ❌ 13 (every feature that moves funds). LIVE VERIFIED: only
Codex's read-only snapshots and one signed dry quote.

## Exact remaining blockers

**Protocol / contract (Codex):** terminal attempt reconciliation (unresolved
attempts currently block forever); cross-device/rollback policy;
physical-wallet acceptance and contract/token signing policies; USDC/router/
retry/escrow independent receipts; immutable merchant and Handshake binding
into on-chain terms; upstream router gas envelope; R-2 contained, not eliminated.

**UI (Claude):** USDC send UI; Protected Pay create flow; Personal Gift send +
verifier wiring; Gift claim page at `/m/gift/<id>#k=` and gift receipt page;
merchant per-sale checkout; history index integration when a backend exists.

**Owner configuration:** see the delivery report (accounts, code hashes,
Gift fee/limits, escrow account, Upstash DB, release reviews).

## Verification

Filled from the final run of the integrated commit; see the delivery report for
the exact SHA and CI links.
