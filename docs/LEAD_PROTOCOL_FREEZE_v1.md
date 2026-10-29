# Taply — Lead Protocol Freeze v1 (2026-10-29)

**Status:** LEAD PRODUCT / INTERFACE DECISIONS APPROVED FOR IMPLEMENTATION PLANNING; **NOT A SECURITY AUDIT OR DEPLOYMENT APPROVAL**.

This document reconciles the 2026-10-29 Codex backend protocol proposal and Claude frontend interface proposal. Where older `docs/*.md` disagree, this document is the *interim* authoritative decision for v0.4 implementation. Codex must align `docs/API.md`, `docs/ARCHITECTURE.md`, and protocol schemas; Claude must align presentation with the same models. Both agents must explicitly surface unresolved matters, not improvise a conflicting protocol. Human review is required before real fund-handling deployment (even on Testnet).

## 1. Non-negotiable scope

- **NEAR Testnet exclusively**; native testnet NEAR for the first on-chain demo, integer yoctoNEAR amounts only; label all balances as test funds, not fiat value.
- Wallet UX + signed requests/link/QR + merchant checkout + Handshake + Instant Pay + on-chain verified receipt are the main delivery path.
- Protected Pay is a **high-priority but security-gated** demonstration: only enable after verified lock, refund, release, boundary and failure tests on Testnet.
- First-party embedded wallet, social login, sponsored gas, NEP-141 assets, Split Pay, Contacts, Recurring Requests and Milestone Pay remain documented but optional/deferred; don't invent working integrations. Contacts can be local-first behind a P1 flag.
- **Never** claim escrow-funded is paid, rely on server/SSE payment claims, retry unknown transfers blindly, or put keys on the server.
- Prefer working reproducible core over more features.

## 2. Division of responsibility and initialization

- `feature/core` / **Codex**: `contracts/**`, `apps/api/**`, `packages/near-client/**`, **initial creation of `packages/shared/**` and root monorepo manifests/lockfile**. This *explicit temporary lead authorization* overrides prior no-root/shared edits solely for the initial shared scaffold and integration freeze. Once shared scaffold is committed and merged, coordinate subsequent shared changes with lead. Codex must not touch `apps/web/**`.
- `feature/frontend` / **Claude**: `apps/web/**` and frontend tests/assets. Browser wallet connection/signing adapter belongs to Claude, consuming Codex wallet-neutral near-client (no private key APIs). Claude must not touch root manifests, shared schemas or backend files unless lead explicitly authorizes a narrowly scoped change.
- `main` is human-reviewed integration. Never have agents directly work in the same folder or push to main.
- To avoid a deadlock, Codex first scaffolds root `pnpm` workspace and `packages/shared` with type+fixture tests, produces a commit and hands it back. Lead merges that commit into `main`, then Claude merges `main` into `feature/frontend`. Until then, Claude may scaffold `apps/web` as a *self-contained app* without editing root files; shared types must remain in one clearly isolated temporary adapter for later replacement.

## 3. Canonical wire protocol and naming

These identifiers are frozen as the baseline for v0.4, matching Codex's proposed protocol:

- API version: `taply.api.v1` with endpoints under `/api/v1`.
- Immutable intent version: `taply.intent.v1`.
- Contract event version: `0.4.0`.
- Payment modes: `instant | protected` (Milestone disabled).
- Asset: `near:native` only.
- Amounts, nanosecond timestamps, heights, counters and operation nonces are **canonical decimal strings**, validated against u64/u128 as appropriate. No JS `Number` for amounts, and no numeric JSON values for money.
- Unknown fields and duplicate keys must be rejected before canonical hashing.

**Use Codex's `ChainObservation<T>` and `PaymentIntentResponse` model as the single public payment read envelope**, not a second, competing `ReadEnvelope<T>`. The observation includes `data`, `source`, `assurance`, `observedBlock { hash, height, timestampNs }`, `checkedAt`, `stale`, and `rpcAvailable`. `assurance` is `unverified | pending_finality | verified_final | unknown | mismatch`. `fundingEligibility` and `incident` remain separate derived/API fields; do **not** create `EXPIRED`, `FUNDING`, or `DISCONNECTED` on-chain statuses. A final receipt can remain historically verified when live RPC becomes unavailable; report freshness separately.

Add to the *derived/UI projection*, not the authoritative on-chain request: `cancelWindowOpen`, `releaseEligible`, authenticated `retry` eligibility and current caller role. Access to actions must be checked **again in the contract**; UI flags do not grant authority. A `termsHash` identifies immutable terms, not current payment status.

The contract's stored `ChainState` enum is:

```ts
export type ChainState =
  | 'OPEN' | 'CANCELLED_UNFUNDED'
  | 'PAYOUT_IN_FLIGHT' | 'PAYOUT_FAILED_RECOVERABLE'
  | 'LOCKED'
  | 'REFUND_IN_FLIGHT' | 'REFUND_FAILED_RECOVERABLE'
  | 'RELEASE_IN_FLIGHT' | 'RELEASE_FAILED_RECOVERABLE'
  | 'FINAL_PAID' | 'CANCELLED_REFUNDED';
```

**Local wallet state** (`AWAITING_SIGNATURE`, `USER_REJECTED`, `OUTCOME_UNKNOWN`) and **Handshake session state** (`DRAFT`, `OPEN`, `PAIRED`, `REVIEWED`, `EXPIRED`, `CLOSED`) are different enums. Handshake `DISCONNECTED` is derived from presence, not payment state.

## 4. Money and state transitions

**Recipient-created requests:** `creatorAccountId === recipientAccountId`. Request owner signs creation. Direct wallet signing only in the initial contract; forwarding/delegation requires a later explicit review. Request ID is deterministic from creator, creation nonce, network, and contract; creation nonce is generated and durably journaled before wallet interaction. Never create a second request merely because a wallet returned an unknown outcome.

**Instant Pay**:

`OPEN` → (exact deposit, valid payer, unexpired, terms hash match) → `PAYOUT_IN_FLIGHT` → successful private callback after actual transfer → `FINAL_PAID`. If the actual transfer fails and callback successfully records failure: `PAYOUT_FAILED_RECOVERABLE`, then **recipient-only**, same-destination, nonce-checked retry. Do not offer an ad hoc payer refund or change recipient in v0.4.

**Protected Pay**:

- Recipient signs immutable `cancelDurationNs`, allowed initially **60–3600 seconds**, default **60 seconds** (proposed bounds, implementation must validate). Request funding expires separately; default 15 minutes, max 24 hours (proposed).
- At *successful on-chain funding execution*, the contract records `fundedAtNs = env::block_timestamp()` and `cancelUntilNs = checked_add(fundedAtNs, cancelDurationNs)`. Before funding, these fields are `null`. Consent screen **before funding** displays duration, never a made-up exact cutoff; **after funding**, the UI may display exact on-chain cutoff and estimated countdown.
- `OPEN → LOCKED` on exact funded deposit; **LOCKED IS NOT PAID**.
- Payer cancellation executes only when `block_timestamp < cancelUntilNs`: `LOCKED → REFUND_IN_FLIGHT → CANCELLED_REFUNDED` after successful callback.
- Anyone may initiate release only when `block_timestamp >= cancelUntilNs`: `LOCKED → RELEASE_IN_FLIGHT → FINAL_PAID` after successful callback.
- At the exact cutoff, cancellation loses and release becomes eligible. Clicking a button before the cutoff is not proof the call will execute before it. Deadline passage itself executes no payment.
- Cancel-vs-release is an atomic, irreversible branch decision. Failed transfer can retry only the *same* branch/destination following a matching recorded failure, using a fresh operation nonce.
- Funding expiry applies only to unfunded OPEN requests, not existing obligations. Handshake session expiry cannot change contract payment eligibility.
- Recipient's signed creation is its agreement to Protected terms; payer's wallet-signed funding, with explicit accepted duration and terms hash, is payer's consent. The UI must show both terms before approving.

**Callback safety (REMAINING SECURITY GATE):** a failed native transfer with successfully recorded callback is different from a *successful transfer followed by a failed callback*. In the latter, the operation remains in flight/reserved and MUST NOT automatically pay/refund again. The API can observe and report but cannot arbitrarily rewrite contract state. A safe, generally usable on-chain reconciliation path has **not** been agreed. Fail-closed avoids duplicate money movement but may leave permanently unresolved states. Document honestly; security review is required before enabling Protected Pay and any deployment policy involving escrow. Even Instant Testnet demo needs negative tests and explicit known limitation.

Storage bonds, callback gas and operational liquidity reserves must be **measured** with compatible near-sdk tooling; Codex's draft 4096-byte reservation is a hypothesis, **not an approved constant**. Test protocol refunds and multi-request conservation. Terminal records and consumed nonces remain for the hackathon; no arbitrary admin settlement or treasury-drain method.

## 5. Checkout / identity / static merchant QR

- For v0.4 use account-derived merchant URL: `/checkout/{accountId}`; `slug === accountId`; profile signature binds display name, accountId, network, contract, origin, and expiry. This demonstrates **account control, not legal business identity or KYC**. Vanity URLs are deferred.
- Every sale creates its **own merchant-signed on-chain request**, unique creation nonce and invoice number. No auto-trusting customer-chosen payee. Merchant must be present with a connected authorized wallet to sign sale creation; employee read-only access is not signing authority.
- **A permanent merchant QR is discovery**, not a standalone payable invoice. In the first demo the merchant opens POS, chooses amount and signs a new sale; customer scans sale-specific QR / joins session. A generic permanent QR may open merchant profile and list an active sale, but must not silently mint a merchant-signed request. Make this distinction explicit in UI.
- Merchant registration/auth uses an **NEP-413 wallet-signature challenge**, single-use random nonce, origin/network/purpose/expiry binding, server verification of account-key association, then Secure HttpOnly SameSite cookie + CSRF/origin checks; NEP-413 wallet capability must be validated on actual Testnet target wallets. Distinct signatures for login, merchant profile, intent creation and payment.

## 6. Handshake protocol and anti-substitution

- Handshake is **live coordination**, not settlement or actual merchant identity verification.
- Server prepares a short-lived draft with random session id, public session nonce and *separate secret join token*. Merchant creates and signs the request binding the immutable session info; after verified request creation server binds session exactly once. Customer joins using short-lived authenticated session. Participant terms review is not payment authorization.
- Both phones independently fetch canonical terms from the approved NEAR contract/RPC and derive a **6-character comparison code** from the session commitment. Mismatch blocks the pay control. Code is only a human comparison aid and may collide.
- SSE/WebSocket/presence events are **hints** to refetch canonical chain state. Do not set `Paid` from an event. SSE can use authenticated HttpOnly cookies or a reviewed fetch stream; never put secret tokens into SSE URL query params.
- Join token in URL fragment only if required, immediately consumed and stripped with history replacement; never in logs/analytics. Use referrer restrictions and short lifetimes. Offline Handshake must degrade to `/pay/{id}` verified request, not pretend the payment has failed.
- **Untrusted session server cannot mutate contract terms** and cannot claim final settlement.

## 7. Hashes / canonical test vectors

Use RFC 8785 JCS with UTF-8 and domain separation (literal LF = `0x0A`):

```
requestId        = hex(SHA256("taply.id.v1\n"      + JCS({contractId, creationNonce, creatorAccountId, network})))
termsHash        = hex(SHA256("taply.terms.v1\n"   + JCS(IntentTerms)))
sessionCommitment= hex(SHA256("taply.session.v1\n" + termsHash_ascii_lowercase_hex))
```

`IntentTerms` and exact fixture object schema is defined in Codex's second protocol proposal. Copy the fixture in full into `packages/shared/test-vectors` in both Rust and TypeScript and ensure their hashes match; never reverse engineer a different algorithm.

Fixture A expected: `requestId=766c48128e0c09fa5e6f74c315a5ea78618d921bd56aff2b3f2c63347ec436e1`, `termsHash=8764cab7aa187e82f0422bd29f21644af950c99cbb0b034f3bc7eed48c439d57`, `sessionCommitment=ed17bd558b616672e9ce22b52f4635ca29b0dc989d6b16ea04b8727d9bcbde4d`, code `XMBVTN`.

Fixture B modifies only amount by +1 base unit; request ID **unchanged**, termsHash `ca3d4f507314b3e61595894cce31f1a1eb15d97a9c7ca238ac3e238ec1afa067`, commitment `32094fae39982a7cf3296e5a99d8b8539e158b328e2026e783db972c4ea2aba3`, code `684MZB`.

These are **calculated fixtures, not Testnet transaction evidence**. Different terms with a reused creation nonce must be rejected despite identical deterministic ID.

## 8. Unified HTTP/API and errors

- Use Codex's `GET /api/v1/...` and `POST /api/v1/...` endpoint namespace. No competing `/api/...` implementations. Canonical request models from the shared package; public payment read returns `PaymentIntentResponse` with `ChainObservation`.
- Accept Codex's `ApiError {schemaVersion, error:{code,messageKey,requestId,retryAction,retryAfterMs,details}}`. Frontend must map **localized keys**, never render untrusted raw server error prose. `RPC_TIMEOUT_UNKNOWN_STATUS` => `WAIT_AND_RECONCILE`, not new payment.
- Chain observation `mismatch` must carry **optional explicit field/value differences** as a typed *verification diagnostic* (never a replacement for chain data). Do not display potentially sensitive data automatically. `stale` and last-known verified proof are independent.
- Public `get_config` exposes exact allowed deployment and capability flags. `GET /api/v1/config` includes Testnet contract code hash, approved version, supported modes, gas/storage quotes **only after measured**.
- Frontend needs after-redirect intent ID resolution: canonical precomputed ID from nonce (preferred) + signed transaction verification; events may corroborate but are not the sole mapping. Journal ID, intended method, termsHash, tx hash and network before redirect. No extra id is generated automatically on RPC timeout.
- `POST /api/v1/sessions/:id/review` with `{termsHash}` (use singular `review`, not competing `/reviewed`). `session.presence`, `session.reviewed`, disconnect/reconnect UI derived from presence. SSE signals only re-fetch, no authoritative payment data.
- Activity and optional features need typed pagination responses before integration; do not block P0 on deferred routes.
- Payment/account/merchant/session JSON responses use `Cache-Control: no-store`; service worker caches static shell/assets **only**.
- `VerifiedReceipt` uses finalized contract state **and** successful payout/refund transfer + callback receipt evidence, correctly distinguishing top-level transaction hashes from internal receipt IDs; external RPC trust model disclosed. Unknown/PayoutFailed/LOCKED cannot show verified Paid.

## 9. Frontend routes / presentation rules

- Default **English**, secondary Turkish, all status translations consistent.
- Add `/scan`, `/s/[sessionId]`, `/merchant/setup`, `/merchant/register` to existing route list; `/pay/[id]` is role-aware, `/receipt/[id]` shows pending/not final when appropriate.
- Wallet/signing adapter belongs to Claude (`apps/web`); actual contract RPC/typed client belongs to Codex (`packages/near-client`). Never import API private keys into browser.
- Dedicated pure `mapChainState(state, verification, role, derived)` returns **all** status copy/icons/colors and authorized CTA presentation. Exhaustive mapping; no arbitrary `paid` booleans.
- NEVER turn `LOCKED`, any `_IN_FLIGHT`, or unknown status green/verified. Only `FINAL_PAID + verified_final` may get a Verified Paid ribbon. `CANCELLED_REFUNDED` must say Refunded, not Paid.
- `Protected` pre-funding copy: **“You can cancel for 60 seconds starting when this payment funds on-chain; on-chain execution time determines whether cancellation succeeds. Release requires a separate transaction after that period.”** Post-funding: chain-derived exact cutoff, approximate countdown. Clicking before zero does not guarantee inclusion before cutoff. This explicitly supersedes older pre-funding copy demanding a precise timestamp.
- Add brand-only warning token muted khaki/gold for locked/pending; danger token muted clay/red for destructive errors. Use approved `brand/` SVGs unchanged. Lime `#C7FC75` stays for CTAs but Verified success is uniquely signalled by *layout + check icon + text + final receipt evidence*, not color alone. PWA 192/512/maskable icons may be rendered from same approved vectors.
- Local payment submission journal persists safe intent ID, terms hash, network, method, wallet-return metadata and possible tx hash. It may **not** persist seeds/signing keys. Unknown status survives redirect/reload, disables new payment until settled/reconciled. Never auto-retry.
- English and Turkish affordances, disabled flags, accessible tap/keyboard equivalent to swipe, 360/390/430px mobile QA.

## 10. Open deployment / security gates (DO NOT mark these approved)

1. Actual callback-failure reconciliation, especially transfer-success + callback-failure. Fail-closed leaves possible stuck obligations. No unsafe admin override.
2. Measured storage bond, prepaid gas, callback gas, operational reserves and aggregate conservation.
3. Wallet capabilities for NEP-413, deposit-capable authorization and mobile redirect, and merchant-signed checkout on actual chosen wallets.
4. Code/version/upgrade authority and handling in-flight operations during upgrades.
5. Successful Testnet proof: first actual native Instant Pay, then separate actual Protected refund and Protected release, and adversarial test suite.
6. Human review of escrow fund custody before enabling Protected UI/deployment.

**Proof hierarchy:** Docs/mock UI < sandbox tests < live Testnet contract receipts/verified payout < reproducible end-to-end demonstration. Never promote a feature status without evidence in `docs/EVIDENCE.md`.
