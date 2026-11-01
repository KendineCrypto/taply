# Phase 7 commerce audit and implementation plan

Status: G2 NO-GO. Protocol Freeze v1 remains authoritative. No deployment,
upgrade, transaction or feature enablement is authorized by this document.

Continuation status: isolated transactional Handshake engine and read-only pilot
adapter now exist. See PHASE_7_SESSION_ENGINE.md for tested behavior and limits;
this audit's architecture/acceptance gates remain applicable. HTTP auth and
mutations are still disabled; live contract limitations are unchanged.

## Current capabilities and blockers

The operator reports mobile Instant Pay and shared verified receipts working.
The existing evidence ledger records Instant payout proof. This audit does not
re-query or fabricate that evidence. Pilot account: taply-pay-pilot-1.testnet;
approved hash: BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B.

`packages/shared/src/transport.ts` already supplies strict merchant profiles,
session snapshots/events/review and error envelopes. `terms.ts` supplies immutable
merchant equality, session binding and canonical hash/code derivation. Schemas
validate structure, not identity or chain provenance. No apps/api existed.

`contracts/payments/src/model.rs::IntentTerms::validate` requires both merchant
and session fields null (HANDSHAKE_DISABLED); Protected is also rejected.
`create_request` requires direct signer == predecessor == creator; recipient is
creator. Exact storage deposit is measured against serialized record size.
Payout is reserved before transfer; private nonce-checked callback alone records
success. Transfer success followed by callback failure remains stuck in flight.
Never change this approved pilot to enable commerce.

Browser `WalletAdapter` exposes transaction signing, restore/connect/disconnect,
but no signMessage. Existing connector success is not NEP-413 capability proof.
Actual target wallet/mobile NEP-413 remains untested. The standard requires a
FullAccess key, Borsh u32 tag 2147484061 followed by message, fixed 32-byte nonce,
recipient and optional callback URL, SHA256 then signature. Account ID is returned
separately and must be bound in the signed challenge. Source reviewed 2026-11-01:
[NEP-413](https://github.com/near/NEPs/blob/master/neps/nep-0413.md).

## Boundaries and authentication

API owns short-lived coordination, challenge consumption and cookie sessions;
browser owns explicit wallet signing; near-client independently reads finalized
chain state; contract alone authorizes funds. Profile verification proves account
control, never legal business identity/KYC. Authentication, profile signature,
request creation and funding are separate authorizations.

Challenges bind account, near-testnet, exact configured HTTPS origin, purpose,
contract and expiry in the signed message. Use CSPRNG nonce and separate browser
state, single consumption before asynchronous verification, finalized FullAccess
key association, no missing/ambiguous evidence acceptance. HTTPS Secure HttpOnly
SameSite=Strict __Host- cookie, CSRF token + exact Origin on every mutation,
bounded strict JSON, rate limits, no-store, no secret logs/query strings, no CORS
wildcard. Durable atomic shared storage is required before multi-worker serving.

Safe initial implementation may expose only refusal responses while crypto/RPC
verification remains incomplete; no fake authenticated flow or cookies issued.

## Endpoints and frontend interface

Under /api/v1: POST auth/challenges, auth/verify, auth/logout; GET auth/me,
merchants/:accountId. Proposed session POSTs: sessions, sessions/:id/bind, join,
review, close; GET sessions/:id and events. Review body is exactly {termsHash}.
Errors use existing ApiErrorSchema. Snapshot/event/profile shapes reuse shared.

Merchant ID is near-testnet:{accountId}; discovery /checkout/{accountId} binds
that exact receiver. Each sale requires a fresh nonce and merchant-signed chain
request. No customer payee override, silent downgrade or reusable paid invoice.
Frontend must add actual signMessage capability detection, compare independently
read chain terms/code on both devices, retain all merchant/handshake flags off.

## Handshake design

DRAFT -> OPEN only after independent finalized bound-request verification;
OPEN -> PAIRED consumes a separate secret join token once; PAIRED -> REVIEWED
requires both authenticated participants reviewing the same immutable termsHash.
EXPIRED and CLOSED terminate coordination only. Public nonce is not join secret.
Bind and join need database compare-and-set transactions and account-scoped
idempotency digests. Payer cannot act as merchant; bind cannot change terms.
Bounded event replay uses increasing decimal IDs, reset on retention gap/restart;
presence leases allow reconnect without consuming another join token. Polling
authenticated snapshot with backoff is fallback; all events are refetch hints.
No backend method accepts or emits authoritative payment-finality booleans.

## Contract extension requirements

Use a separately reviewed version/account, never pilot upgrade. Preserve v1
canonical bytes, deterministic ID, direct recipient-only creation, merchant ==
creator, exact deposits/gas and outgoing nonce/accounting rules. Validate session
ID/nonce/expiry, expose calculated sessionCommitment in view, and measure larger
storage records. Keep Protected disabled. ABI/security proposal must precede code.

## Threat model and tests

Threats: forged signatures, removed/function-call keys, origin/recipient/network
substitution, challenge replay/races, login CSRF, token leaks, account/slug swaps,
parallel bind/join, guessed IDs, resource exhaustion, malicious backend, stale RPC,
false paid events, reconnect/event duplicate/reorder and process restart.
Tests must exercise exact cutoff/expiry, immutable terms mismatch, wrong roles,
single-use concurrency, bounded storage/body/rates, unavailable RPC fail-closed,
shared A/B hashes and independent payment verification. Isolated fixtures are not
wallet or chain proof. See docs/TEST_PLAN.md for payment regression requirements.

## Exact G2 acceptance

All required before GO: tested actual mobile Testnet NEP-413 on chosen wallets;
cryptographic and finalized FullAccess association verification; durable atomic
auth/session stores with expiry/replay/rate/CSRF tests; signed profile binding;
separately approved compatible deployment (outside this task); unique merchant
signed request per sale; two independent devices derive identical canonical code
and explicitly review; tampering and all races fail; final payout receipt verified
independently on both devices; RPC/session loss never yields false Paid; archived
real transaction/receipt evidence and human security acceptance. Current pilot
Instant evidence does not satisfy these commerce gates.
