# Phase 7G CORE frontend handoff

No `apps/web/**`, feature flags, operator env files, shared schemas or root lockfile
changed. This handoff is for future coordinated integration; it does not activate
production authentication, a listener or live G2. The UX branch was not checked out
or modified. Existing Instant Pay signing/journal guards are unchanged.

## Contract and canonical terms

Candidate version: **0.5.0-merchant.1**, opt-in `merchant-bound-v1` Rust feature,
separate artifact/account/hash. The current pilot remains incompatible and must
never receive a bound sale or an unreviewed upgrade. Do not downgrade bindings to
null to make a sale work. See [candidate ABI](../contracts/payments/abi.merchant-v1.json)
and [validation rules](../contracts/payments/MERCHANT_V1.md).

Frozen `taply.intent.v1` fields, deterministic request identity, JCS hash domains,
commitment and six-character code are unchanged. Native amount/expiry/recipient/
merchant/session terms are immutable. One creator-signed request per session ID;
reusing its ID with another creation nonce also refuses. A normal POS sale display
code remains distinct from this canonical Handshake code.

`get_config` has the same config envelope/method arguments but returns candidate
contractVersion and handshake=true. Existing `ContractConfigSchema` remains
0.4.0-only; `MerchantContractConfigSchema` is an additive isolated candidate
schema. A candidate config response is not deployment approval. Independent
same-final-block code-hash/config verification remains an integration requirement.

## New browser-safe near-client exports

All additions are from `@taply/near-client`; no Node API module imports are needed.
No helper invokes a wallet, signs or broadcasts anything.

- `createMerchantRequestReader(config)` has no default deployment. Supply a
  separately reviewed Testnet account/hash. It rejects the approved old pilot.
  `readCanonicalRequest(id)` fits the backend SessionEngine trusted-reader seam;
  `read(id)` additionally returns code/provenance;
  `readForSession(expected)` checks independently retained expectations below.
- `MerchantSessionExpectation` is exactly `{merchantAccountId, requestId,
  termsHash, sessionBinding:{id,nonce,expiresAtNs}, permittedPayerAccountId}`.
  Include permittedPayerAccountId explicitly, including null: a room server cannot
  add a payer restriction. Do not derive expectations solely from an untrusted
  latest room event. Merchant retains its created session/terms; customer must
  independently inspect/review the canonical chain terms and intended merchant.
- `matchMerchantSession` matches verified reader output against that expectation.
  `verifyMerchantObservation` is the trusted-adapter validation seam, not a way to
  turn arbitrary browser/server objects into chain evidence. Use the real reader.
- `prepareMerchantCreateRequest({deployment,config,terms,quote,signerAccountId,
  observedAtNs})` validates the candidate-only config, creator/merchant identity,
  canonical hash, session expiry and exact bytes*storage-cost quote. Returns one
  existing ABI `PreparedContractCall`; it never requests a signature. Config and
  quote must first be independently read from the approved pinned deployment.
- `prepareMerchantPayInstantNative({deployment,config,canonical,expected,
  signerAccountId,nowMs?})` rechecks the reader result, expected terms, freshness
  and payer restriction, then returns the exact principal/hash funding proposal.
  Human review and wallet approval are mandatory. `nowMs` is an injectable clock
  for tests, not a chain authority override. Preserve the existing payment journal
  and unknown-outcome guards around any future wallet invocation.

Reader results include `evidenceKind: CANONICAL_REQUEST_NOT_PAYOUT_RECEIPT` and
configured-RPC trust provenance. It checks exact Testnet genesis, expected code
hash and same finalized block for account/code/view; strict canonical terms,
creator/recipient/merchant, session, expiry and timestamp consistency. It does not
return Verified Paid or verify receipts. RPC is a trust boundary, not a light
client. Each device needs an independent configured read; a backend copy is not
independent evidence. Six-character equality alone is not authentication/consent.

## Wallet authentication compatibility contract

Official [NEP-413](https://github.com/near/NEPs/blob/master/neps/nep-0413.md) was
read during this work. Backend continues to verify u32 tag 2^31+413, exact Borsh
UTF-8 message, fixed 32 nonce bytes, recipient and optional original callback,
SHA-256/Ed25519 plus recent finalized FullAccess key/account association.

`signMessageCapability(wallet)` returns unsupported or available_unverified.
It only checks runtime capability and never calls the wallet. Do not equate a
method's existence/SDK types with actual mobile compatibility. There is no
transaction-signing or key-creation fallback.

`prepareWalletAuthentication(challenge,{origin,contractId,accountId})` validates
server challenge scope, signed-message fields, exact nonce decoding, expiry and
optional callback; returns standard NEP-413 `params` and a one-use
`accept(result,currentScope)` response correlator. Pass the exact message bytes;
never rebuild JSON or sign base64 nonce text. The returned verification envelope
still requires the backend's cryptography, association and durable consumption.
A locally accepted envelope is **not a login**. Tokens/signatures never belong in
URL queries, logs, localStorage, analytics or payment journals.

An SDK omitting response state can attach the pending challenge state because it
is already inside the exact signed message and browser-bound on the server.
Explicitly supplied mismatching state always refuses. Wrong-account, changed
origin/account while awaiting, malformed bytes, expired and duplicate responses
refuse. Abort/discard abandoned flows on navigation/account/logout.

Current HTTP challenge omits callbackUrl: preparation labels this
`direct_only_unverified`. NEP-413 browser wallets can default callbackUrl to the
current page, changing signed bytes. Such behavior must refuse until explicit
server-stored callback support and actual wallet evidence are reviewed. Never try
multiple payload variants until one verifies. The actual Taply WalletAdapter is
unchanged and does not gain signMessage from these exports.

Manual operator test, independently per wallet/OS/browser version:

1. Review the dedicated Testnet account, HTTPS origin and off-chain login purpose;
   obtain explicit approval for a real authentication signature. No transaction,
   seed export, FunctionCall key or funds operation is involved.
2. Observe runtime signMessage support; capture only public capability/version
   evidence. Review exact message/recipient/nonce/contract/account/expiry.
3. Explicitly request one approved signature through the reviewed adapter; prove
   the actual direct or callback/fragment behavior, including iOS/Safari return.
   Strip callback fragments immediately; test Secure Strict cookies after return.
4. Verify exact signature and recent finalized FullAccess association. Archive
   sanitized public account/key/block, message hash and pass/fail only, no live
   signature/state/cookie/CSRF/join secrets.
5. Test decline, wrong account, changed bytes/nonce/recipient/callback, expired
   challenge, another browser, duplicate verification and RPC outage: no login.
6. Use separately approved public revocation/rotation evidence. Removed keys must
   fail a fresh login; a newly associated key needs a fresh challenge. Current
   cookies can survive up to 15 minutes after key removal unless logged out;
   continuous revocation policy/integration remains an activation blocker.

No actual wallet test was performed. Production authentication stays disabled.

## Room synchronization

HTTP paths/bodies remain exactly those in [shared room handoff](PHASE_7_SHARED_ROOM.md).
No endpoint was added. Finite SSE catch-up is capped at 64 events and **256 KiB**;
excess fails with existing RATE_LIMITED. No retained subscriber queue exists.

`RoomCatchUpSchema`, `applyRoomCatchUp(previous,envelope,currentScope,
requestGeneration)` and corresponding types validate the API-owned room envelope
without changing shared v1. Scope is `{sessionId,accountId,authGeneration}`.
Increment authGeneration on account/logout changes, capture it before each
request, cancel old timers/fetches and discard old-generation responses. The
reducer also drops old-account/session state, ignores older cursors/deduplicates,
rejects conflicting equal cursors and unexplained replay gaps, and accepts an
atomic reset snapshot. It rejects cross-room/account events, >64 history entries
and injected Paid/chain fields. It emits replacement coordination state only.

On ROOM_REFRESH_REQUIRED request a fresh atomic sync/reset; do not replay wallet
actions. Scope cursors per room and endpoint family. Prefer one finite SSE or
poll loop, not both; honor existing rate budgets/backoff. Visibility hiding sends
sequenced disconnected presence, resuming increments sequence; missed heartbeats
expire after 30s. Presence/progress are advisory, not signature or human consent.
Expiry/close/logout never settles or refunds a payment. Keep chain polling and
independent receipt verification separate from room state.

## Gates and remaining integration

The production factory still hardcodes authenticationAccepted=false and uses the
old pilot refusal reader. No candidate reader/config/preparation helper is wired
to production or a browser. Real G2 requires reviewed candidate sandbox/deployment,
config/quote/signing and receipt integration, actual wallet capability, signed
merchant discovery, HTTPS/host security and external freshness infrastructure
**plus asynchronous auth/room integration**. The controlled fencing harness does
not fix the currently shipped synchronous store. Keep all live gates closed.
