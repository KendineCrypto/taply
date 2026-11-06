# Taply API / protocol v1 — Phase 0 shared package

> This document freezes protocol shapes and historical Phase 0 scope, not a current deployed-API inventory. An Instant Testnet contract and gated in-process API implementation now exist; production authentication/live G2 remain closed. See [current release readiness](RELEASE_READINESS.md). Planned Protected methods are not enabled capabilities.

Authority: [Lead Protocol Freeze v1](LEAD_PROTOCOL_FREEZE_v1.md). This replaces
the earlier unversioned `/api/...` and `Verification`/`PaymentIntent` draft.
Only shared schemas, canonical hashing and local tests are implemented. No HTTP
service, signing integration, contract or Testnet deployment exists yet.

## Single source for both branches

Import public schemas and inferred types from `@taply/shared`; run `pnpm build`
first. Do not duplicate definitions in the frontend.

| Source in packages/shared/src | Responsibility |
| --- | --- |
| primitives.ts | canonical u64/u128 strings, accounts, Testnet/native asset, versions, duration/lifetime bounds |
| json.ts | duplicate-aware strict JSON, UTF-8 JCS, domain-separated SHA-256 |
| terms.ts | exact IntentTerms, session binding, deterministic ID, terms hash, comparison code |
| payments.ts | chain/wallet enums, operation/request schemas, ChainObservation<T>, PaymentIntentResponse, derived actions, diagnostics |
| receipts.ts | distinct transaction/receipt references, VerifiedReceipt evidence shape |
| transport.ts | sessions, SSE, merchant profile, errors, transaction hints, cursor pages, disabled Phase 0 capabilities |
| methods.ts | contract argument shapes only; no dispatcher or signing |

Objects reject unknown fields. Use `parseStrictJson(rawTextOrUtf8Bytes)` before
ordinary JSON middleware loses duplicate keys, then apply the relevant schema.
`parseIntentTermsJson` does both. Parsing rejects invalid UTF-8/Unicode, duplicate
keys including escaped aliases, comments, trailing commas, nesting >32, and
bodies >65,536 bytes. Future HTTP endpoints may set smaller body limits.

Amounts, timestamps, heights, revisions and operation nonces are decimal strings:
no coercion, fractions, exponent, sign, whitespace or leading zeros. u64/u128
bounds are checked with BigInt. The bounded UI delay `retryAfterMs` is numeric.
Account syntax does not prove existence, ownership or network. Asset is
`near:native` with 24 decimals. Mode is instant or protected; Milestone is disabled.

## Immutable terms and hashes

IntentTerms has exactly: schemaVersion, id, network, contractId, creationNonce,
creatorAccountId, assetId, amountBaseUnits, mode, cancelDurationNs,
fundingExpiresAtNs, permittedPayerAccountId, merchantAccountId, memo,
sessionBinding. Nullable fields must be present. Recipient equals creator and
is explicitly exposed on ContractRequest. Memo maximum is 256 UTF-8 bytes.

Use RFC 8785 JCS with UTF-8 and literal LF domain separators:

```text
id = SHA256("taply.id.v1\n" + JCS({contractId, creationNonce, creatorAccountId, network}))
termsHash = SHA256("taply.terms.v1\n" + JCS(IntentTerms))
sessionCommitment = SHA256("taply.session.v1\n" + termsHash_ascii_lowercase_hex)
```

Digests are lowercase hex. Null session means null commitment. The six-character
code uses the first 30 digest bits, most significant first, and alphabet
`0123456789ABCDEFGHJKMNPQRSTVWXYZ`. Unicode is not normalized. This code is a
visual aid, not identity proof or a credential.

The complete frozen A/B objects, canonical bytes and expected values are in
`packages/shared/test-vectors/`. A gives XMBVTN; B gives 684MZB. B changes only
amount by one yoctoNEAR; deterministic ID stays unchanged. The future contract
must reject reused creation nonces. Fixtures are not chain evidence.

## Public payment read

Stored ChainState is exactly OPEN, CANCELLED_UNFUNDED, PAYOUT_IN_FLIGHT,
PAYOUT_FAILED_RECOVERABLE, LOCKED, REFUND_IN_FLIGHT, REFUND_FAILED_RECOVERABLE,
RELEASE_IN_FLIGHT, RELEASE_FAILED_RECOVERABLE, FINAL_PAID, CANCELLED_REFUNDED.

Wallet states AWAITING_SIGNATURE, USER_REJECTED, OUTCOME_UNKNOWN and session
states DRAFT, OPEN, PAIRED, REVIEWED, EXPIRED, CLOSED remain separate. Disconnection
is presence; funding expiry is derived. A terms hash does not encode mutable state.

PaymentIntentResponse contains:

- observation: data (ContractRequest or null), source (rpc/index/mock), assurance
  (unverified/pending_finality/verified_final/unknown/mismatch), observedBlock
  ({hash,height,timestampNs} or null), checkedAt (UTC), stale, rpcAvailable.
  Optional diagnostic is {differences:[{field,expected,observed}]} and belongs
  only to mismatch observations. Do not automatically display sensitive values.
- fundingEligibility: ELIGIBLE, EXPIRED, NOT_OPEN, UNSUPPORTED or UNKNOWN.
- incident: null, CALLBACK_FAILED, OUTCOME_UNKNOWN or RECONCILIATION_REQUIRED.
- derived: callerRole (anonymous/payer/recipient/payer_and_recipient/observer),
  nullable cancelWindowOpen and releaseEligible, and
  retry:{eligible,operationNonce,kind}. These projections grant no authority.

Mock data can only be unverified and has no block provenance. Uncertain/stale/mock
observations cannot enable financial actions. Historical verification survives
RPC outage with stale:true. A finalized observation of OPEN is not a paid receipt.
The frontend can show Verified Paid only for FINAL_PAID with verified settlement
proof. Contract authorization/time checks are still mandatory on every action.

## Contract ABI (planned; argument schemas only)

| Method | Args | Later contract authorization/deposit |
| --- | --- | --- |
| get_config | {} | View; only approved/measured configuration |
| quote_create_request | {terms} | View; no invented storage constant |
| create_request | {terms,quoteVersion} | Recipient direct signature; exact storage bond |
| cancel_unfunded | {id,expectedTermsHash} | Creator, exactly 1 yoctoNEAR |
| pay_instant_native | {id,expectedTermsHash} | Permitted payer; exact principal |
| fund_protected_native | {id,expectedTermsHash,acceptedCancelDurationNs,consentVersion} | Explicit payer consent; exact principal |
| cancel_protected | {id,expectedTermsHash} | Payer before cutoff; exactly 1 yoctoNEAR |
| release_protected | {id} | Anyone at/after cutoff; zero deposit |
| retry_native_transfer | {id,expectedOperationNonce} | Failed operation beneficiary; same branch/destination; exactly 1 yoctoNEAR |
| get_request / get_receipt | {id} | Views; on-chain settlement facts are not external finality proof |
| on_native_transfer_complete | {id,operationNonce,kind} | Private; outcome only from runtime promise result |

Consent version is taply.protected-consent.v1. The signed accepted duration must
match immutable terms. Protected duration is 60–3600 seconds, default 60. Before
funding cutoff is null; after funding it is checked fundedAtNs + cancelDurationNs.
Cancel executes strictly before cutoff; release executes at/after. Funding expiry
(default 15 minutes, maximum 24 hours) affects only unfunded requests.

Reserve principal/state before scheduling one transfer. Successfully recorded
transfer failure allows a fresh-nonce retry: Instant payout recipient only,
Protected release recipient only, refund payer only. Refund retries can occur
after cutoff. A successful transfer followed by failed callback remains reserved
and cannot retry. No branch reset, recipient change or arbitrary admin settlement.
Shared validation does not implement or prove these contract guarantees.

## HTTP endpoints (planned, not running)

| Endpoint | Boundary / output |
| --- | --- |
| GET /api/v1/health, /api/v1/config, /api/v1/assets | Read-only health, approved deployment/capabilities, native asset |
| POST /api/v1/auth/challenges, /api/v1/auth/verify | Single-use NEP-413 challenge and account-key association verification |
| GET /api/v1/auth/me; POST /api/v1/auth/logout | Secure HttpOnly SameSite cookie session; logout revokes streams |
| PUT /api/v1/merchants/:accountId/profile | Owner and separate profile-binding signature |
| GET /api/v1/merchants/:accountId | Account-derived slug and binding evidence |
| GET /api/v1/merchants/:accountId/payments?cursor= | Authenticated owner/read grant, typed cursor page |
| POST /api/v1/intent-drafts | Authenticated recipient; advisory unsigned creation arguments |
| GET /api/v1/payment-intents/:id | PaymentIntentResponse |
| POST /api/v1/payment-intents/:id/transaction-hints | {txHash,signerAccountId,purpose}; untrusted indexing hint |
| GET /api/v1/receipts/:id | VerifiedReceipt or RECEIPT_NOT_FINAL / verification outage |
| GET /api/v1/accounts/:accountId/activity?cursor= | Owner-scoped activity, per-item provenance |
| POST /api/v1/sessions | Merchant draft, public nonce, separate secret join token |
| POST /api/v1/sessions/:id/bind | Merchant binds verified request exactly once |
| POST /api/v1/sessions/:id/join | Authenticated payer consumes join secret |
| POST /api/v1/sessions/:id/review | Participant supplies exactly {termsHash} |
| GET /api/v1/sessions/:id, /api/v1/sessions/:id/events | Authenticated snapshot / SSE hints |
| POST /api/v1/sessions/:id/close | Close coordination, never mutate payment |

Dynamic payment/account/merchant/session responses use Cache-Control: no-store.
Service workers cache static assets only. Cursor pages are {items,nextCursor},
maximum 100 items. Optional routes cannot block P0.

Creation POSTs need identity-scoped idempotency keys and body digests. Journal
creation nonce, ID, network, intended method and terms hash before redirect;
record tx hash when available. Never allocate another intent on unknown submission.
Schemas do not verify signatures, auth nonces, ownership, CSRF/origin, expiry,
rate limits, receipt authenticity or token confidentiality: those require service
and wallet-neutral RPC implementations in later phases.

Permanent /checkout/{accountId} is merchant discovery. POS must sign a unique
sale request and provide its sale/session QR. Generic scans cannot mint signed
invoices. MerchantProfile parsing checks shape/account consistency, not a valid
NEP-413 signature. Its opaque signed message must separately be verified to bind
origin, network, contract, display name, account and expiry. Staff reads do not
permit signing. Account control is not KYC.

## SSE / errors / receipts

SessionEvent uses taply.events.v1, decimal eventId, sessionId, UTC emittedAt,
nullable intentId and intentRevisionHint. Events: session.bound, session.joined,
session.presence, session.reviewed, payment.changed, session.expired,
session.closed, stream.reset. No paid/verified flags or secret tokens. Re-fetch
chain proof on hints. Use authenticated cookies/fetch stream, never secret query
params. Join fragments are consumed, stripped and excluded from analytics.

ApiError is {schemaVersion:'taply.api.v1',error:{code,messageKey,requestId,
retryAction,retryAfterMs,details}}. ERROR_CODES exports the union. Translation keys
are errors.<CODE>; English default, Turkish secondary. Never render raw server
prose. Retry actions: NONE, REAUTHENTICATE, REFETCH, WAIT_AND_RECONCILE,
RETRY_SAME_OPERATION. Unknown submission, callback failure, reconciliation-needed
and operation-in-flight errors require WAIT_AND_RECONCILE. A retry delay is not
authorization to send money.

VerifiedReceipt binds request/terms/session, payer, original recipient, actual
settlement beneficiary, asset/amount/mode, nonce, approved contract code hash,
funding and settlement transactions, distinct successful funding/transfer/callback
receipts with block references, finalized contract state block, and verification
{state:'verified_final',executionFinality:'FINAL',trustModel:'configured-rpc',
rpcProviderId,checkedAt}. An Instant payment may share a top-level funding and
settlement transaction hash. Refund beneficiary is the payer; refund status is
CANCELLED_REFUNDED, never Paid. An RPC verifier must inspect receipt relationships
and actual actions/destination/amount. Schema acceptance is not chain verification.

PHASE_0_CONFIG has null deployment, gas and storage, and all financial capabilities
disabled. General callback reconciliation, measured costs/reserves, upgrade
policy, wallet capability tests, Rust/sandbox execution, live Testnet proof and
human security review remain open gates. The draft 4096-byte bond is not approved.
