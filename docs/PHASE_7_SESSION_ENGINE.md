# Phase 7 Handshake engine integration contract

> Phase 7C supersedes the storage/auth/HTTP limitations in the historical snapshot
> below. Cryptographic NEP-413 verification, encrypted SQLite persistence and gated
> HTTP handlers now pass local tests. Production authentication remains disabled;
> live bound Handshake remains impossible on the approved pilot. Current endpoint
> schemas, guarantees and evidence: [PHASE_7C_SERVICE.md](PHASE_7C_SERVICE.md).

Implemented and locally tested, 2026-11-01. Offline integration GO for an explicitly
labelled test harness using synthetic auth/chain fixtures. Public HTTP integration
NO-GO; actual G2 Testnet pilot NO-GO. No new chain evidence was collected.

## Implemented boundaries

`apps/api/src/sessions.mts` exports SessionEngine, SessionPersistence and
MemorySessionPersistence. Dependencies inject authentication and canonical request
reads. These are security boundaries, not client-supplied account/status claims.
The constructor requires both dependencies; there is no default bypass. Never
wire fixture dependencies into a public service.

Memory persistence uses synchronous serializable copy/commit transactions with
rollback on exceptions. All post-RPC bind checks repeat inside the commit.
Durable implementations must provide equivalent atomicity across workers and
reject uncertain recovery/commits. `invalidate()` makes the memory store refuse
every operation. A fresh store after restart knows no previous sessions and does
not reconstruct them from client snapshots or tokens. Multi-process serving and
durable storage are not implemented.

Session IDs use UUIDv4 (122 random bits), public nonce 32 random bytes, independent
join token 32 random bytes. Guessing resistance assumes uncompromised Node CSPRNG;
it is not established by statistical tests. Only token hash is retained in the
session entry. Merchant creation idempotency caches the original token response:
that persistence is secret-bearing and needs encryption/access controls. No token
appears in snapshots/events. No API logging is implemented.

## Exact engine operations and future HTTP mapping

All credential arguments are opaque to the engine and resolved by injected auth.
All snapshots conform to existing HandshakeSessionSchema. No HTTP success mapping
is enabled yet; current handler still returns refusal responses.

| Method / future route | Input beyond credential | Result |
| --- | --- | --- |
| create / POST /api/v1/sessions | idempotency key | {session,joinToken} |
| bind / POST /api/v1/sessions/:id/bind | id,key,{intentId,termsHash} | snapshot |
| join / POST /api/v1/sessions/:id/join | id,key,{joinToken} | snapshot |
| review / POST /api/v1/sessions/:id/review | id,key,{termsHash} | snapshot |
| presence / future heartbeat transport | id,connected:boolean | snapshot |
| read / GET /api/v1/sessions/:id | id | snapshot |
| events / GET /api/v1/sessions/:id/events | id,after decimal string | {reset,events} |
| close / POST /api/v1/sessions/:id/close | id | snapshot |

Bind/join/review reject extra fields, including client `paid`, `verified` or
`status`. Inputs are strings; keys are 16–128 ASCII alphanumeric/underscore/hyphen.
Keys are scoped to account, operation and session with payload digest conflict
detection. Retried successful commands return their original snapshot; refetch
for current state. Create keys are account-scoped. Create retry returns original
response, which may now be stale; refetch before presentation. Idempotency ends
at retention cleanup; clients must not retry an old operation as a new sale.

Future HTTP adapters must use strict duplicate-aware bounded JSON, map known
errors to shared ApiErrorSchema, sanitize internal validation exceptions and
return no-store. Engine throws stable codes for business checks; raw Zod errors
must never be sent to browsers. Missing HTTP authentication, cookie/CSRF/origin,
per-account/IP rate limits, request limits and durable storage prohibit exposure.

## Lifecycle and roles

Session lifetime is 120 seconds. DRAFT opens only after canonical ContractRequest
validation: exact requested ID/hash, configured contract, Testnet, Instant mode,
merchant == creator == recipient, exact session ID/public nonce/expiry, OPEN
request and sufficient funding lifetime. All commitments/codes use shared hashing.
Only merchant binds/closes. An independent eligible authenticated payer consumes
the token once to become PAIRED. Merchant cannot join as payer. Optional canonical
permittedPayerAccountId is enforced. Only the two participants read/events/review.
Each independently reviews the same immutable hash; both reviews yield REVIEWED.
Repeated review does not create duplicate review hints.

At now >= expiresAtNs, all live states become EXPIRED; CLOSED is terminal.
Expiry/close destroy join authority. Neither cancels a payment. Cleanup removes
entries five minutes after session expiry and their create-idempotency records.
Call cleanup periodically from a future trusted scheduler. Global maximum 1000
sessions/create records, 128 successful mutation idempotency records per session;
limits fail closed. These bounds do not replace public request rate limiting.

Presence is independent of pairing/review and expires after 30 seconds without
heartbeat. Disconnect/reconnect updates leases for the same authenticated identity,
does not consume a second token or erase review. Actual socket count management
is not implemented; future transports must aggregate multiple connections before
reporting disconnected.

## Events and polling

History retains 64 shared SessionEvent objects with increasing per-session decimal
eventId. Hints contain no payment-finality proof or tokens. Event types emitted:
session.bound, joined, presence, reviewed, expired, closed. There is no engine
method to mark a payment final. Payment state remains independently chain-verified.
No SSE network server is implemented; events() is the bounded replay abstraction.

An out-of-retention or future cursor yields {reset:true,events:[]}; adapter should
send stream.reset and refetch snapshot. Otherwise return events strictly newer
than cursor. Adapter must heartbeat, disconnect slow clients and bound buffers.
Frontend deduplicates by (sessionId,eventId), ignores older hints and refetches
snapshot/chain state even after reordered or duplicate delivery. It must not apply
event arrival order as settlement state. Poll snapshot every few seconds with
backoff while authorized; disconnect does not mean payment failure. Cookies/fetch
stream only, no query secrets. QR proposal remains /s/{id}#join=<token>, stripped
immediately; it is not enabled. Discovery /checkout/{accountId} is not an invoice.

## Read-only pilot adapter

createPilotReader uses existing near-client with fixed public Testnet RPC, approved
pilot account/hash, network/genesis check and finalized block/code anchoring.
`read(id)` returns {request,provenance}; provenance explicitly says
CANONICAL_REQUEST_NOT_PAYOUT_RECEIPT and configured-rpc trust. It rejects RPC
outage, stale/mock/mismatched/unanchored data and impossible merchant/session
records. Shape/provenance validation tests use injected synthetic reader results;
no live RPC check was performed in this continuation.

`readCanonicalRequest(id)` always rejects after the safe read: the pilot cannot
provide a merchant/session binding. Do not use ordinary Instant terms to satisfy
the engine. A future separately reviewed adapter/deployment is required.

## Validation and remaining blockers

23 API tests pass: six auth/refusal, fifteen session, two read-adapter cases.
Coverage includes token forgery/replay/expiry; wrong roles/receiver/hash/contract;
two distinct payer races, concurrent bind, pending-RPC close/expiry races; duplicate
review; presence reconnect; ordered bounded replay and reset; restart invalidation;
RPC/mismatch refusal; malicious payment-status fields. These are local simulations,
not real signatures, RPC receipts or two-device end-to-end evidence.

Standalone strict API typecheck and ESLint passed. Full pnpm check exited 0:
brand/build/typechecks/lint and shared/near-client/web suites passed. API tests are
still a separate command because no API package/root manifests were changed.
No Rust tests ran: contracts are unchanged. See PHASE_7_TEST_TRIAGE.md for the
clock-dependent Phase 6B test defect and fixture-only fix.

Still blocked: real NEP-413 verifier + finalized FullAccess association; browser
wallet capability proof; durable persistence/operational limits; HTTP/SSE transport;
signed profile publication; new reviewed contract extension and deployment; actual
merchant-signed sale and two-device chain comparison/payment proof. Existing pilot
must remain untouched and all commerce/Handshake/Protected flags remain OFF.
