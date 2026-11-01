# Phase 7 shared payment room — backend handoff

2026-11-02, `feature/phase7-core`, starting at `96c1d53`. Offline/in-process
integration GO. **Production authentication and real Testnet G2 remain NO-GO.**
Tested implementation commit: `53edea5af4f974115f59ec923640f84c7ffe96e3`.
This change adds no listener, frontend wiring, dependency, contract change,
deployment, wallet signature, chain transaction, push or merge. Existing gates,
pilot identity/code hash and shared v1 schemas are unchanged.

## Authority and status model

`apps/api/src/room.mts` exports API-owned `RoomSnapshot`, `RoomEvent`, `RoomSync`
and payer-progress types. They wrap the existing shared `HandshakeSession`, rather
than changing the frozen `@taply/shared` session/event formats. The legacy
snapshot and `/events` endpoints remain compatible. A future move into shared
schemas needs separate coordination; do not import Node backend implementation
modules into a frontend runtime.

Every room has `authority: "coordination_only"`. A joined participant reports
presence; only the authenticated joined payer can report wallet progress, and
only after both participants explicitly review the exact bound terms hash.
These reports are untrusted presentation hints: the backend cannot see whether
the wallet opened or whether a claimed transaction hash was broadcast.

| Frontend moment | Backend support / source |
| --- | --- |
| Merchant room created | `session.created`; DRAFT / WAITING_FOR_BIND |
| Customer observed a QR | Local navigation only; never infer authenticated presence from a scan |
| Comparison code available | `session.bound`; shared canonical bind checks; OPEN / WAITING_FOR_CUSTOMER |
| Customer joined | Single-use authenticated join; `session.joined`; PAIRED / WAITING_FOR_REVIEW |
| Waiting for payer review | Room exposes separate merchant/payer review booleans |
| Waiting for wallet approval | Both reviewed -> WAITING_FOR_WALLET; explicit payer AWAITING_WALLET is advisory |
| Submitted / pending chain | Payer SUBMITTED with syntactically valid hash -> PENDING_CHAIN, not success |
| Unknown wallet result | OUTCOME_UNKNOWN -> BLOCKED; retain operation metadata and reconcile, never re-sign on elapsed time |
| Wallet rejected | USER_REJECTED hint -> WAITING_FOR_WALLET; payer may explicitly begin a new local review, with the existing wallet journal still authoritative for duplicate prevention |
| Paid per contract | Separate read-only pilot projection PAID_PER_CONTRACT from finalized canonical contract state, never a payer event |
| Independently verified | Each client must run the receipt verifier against actual funding/transfer/callback evidence; no room event can assert this |
| Expired | EXPIRED derives from server session time; chain request expiry separately derives from the observed chain block |
| Cancelled | Merchant close means CLOSED coordination only; pilot CANCELLED means on-chain CANCELLED_UNFUNDED |
| Mismatch / duplicate prevented | Stable API errors such as TERMS_MISMATCH, IDEMPOTENCY_CONFLICT, JOIN_TOKEN_USED; failed mutations create no success event |

Do not promote REVIEWED, a matching code, online presence, a submitted hash or
session expiry into payment authority. Neither closing the room nor losing the
server changes funds. An expired room can still contain an unresolved payment;
keep independent chain/receipt reconciliation visible.

## Atomic synchronization and ordering

In an accepted **synthetic test composition**, `GET /api/v1/sessions/:id/room`
returns one transactional envelope:

```ts
type RoomSync = {
  schemaVersion: 'taply.room-sync.v1';
  sessionId: string;
  cursor: string; // decimal high-water room event ID
  reset: boolean;
  serverTimeMs: number; // advisory off-chain time
  room: RoomSnapshot;
  events: RoomEvent[]; // at most 64, oldest first
};
// RoomSnapshot:
// {schemaVersion:'taply.room.v1', authority:'coordination_only',
//  session: HandshakeSession, phase, reviews:{merchant,payer},
//  presence:{merchant,payer}, payerProgress:null|{phase,transactionHash}}
// RoomEvent:
// {schemaVersion:'taply.room-event.v1', eventId, sessionId, emittedAt, type, room}
```

The snapshot and cursor are captured under the same persistence transaction.
An event holds the full room snapshot **after** its change; the second review
event already shows REVIEWED. Event IDs start at 1 with creation, increase only
on committed meaningful changes and survive durable reopen. Failed transactions
consume no IDs. Timestamps may tie or move with the host clock: order by numeric
event ID using BigInt, never by emittedAt or HTTP arrival time.

These are **room cursors**, distinct from the legacy shared `/events` cursor.
Never reuse a cursor across endpoint families, rooms or authenticated UI flows.
No cookie, CSRF value, join secret, raw credential or connection scope hash is
included in a room response/event.

Set `Last-Event-ID` to the last applied room cursor. With a retained cursor,
events are strictly newer. If it is too old, ahead of the server, or belongs to
another history, `reset:true` supplies no partial event list and includes the
current replacement room and cursor atomically. A bare decimal from a different
room cannot be detected if its numeric value happens to fit: clients must scope
it to the route/session ID. Invalid decimal syntax is rejected.

Idempotency keys are actor/action/session scoped. Canonical JSON hashing makes
body key order irrelevant. Same-key retries return the original response without
new events; conflicting bodies refuse. A replayed mutation response can be older
than the room now: always follow with sync and never let an older cursor replace
newer state. Repeating an unchanged wallet-opening/rejection hint with a fresh
key also emits no redundant event. Create responses may likewise be historical.

Recommended consumer algorithm:

1. Capture an auth-generation counter and requested session ID before fetch.
2. Use exact same-origin HTTPS, credentials `same-origin`, cache `no-store`, no
   redirects, and a timeout. Keep secrets out of URLs and browser persistence.
3. On completion, discard the response if account, session or auth generation
   changed. Validate envelope/schema/identity; stop on auth errors.
4. For the active room, ignore older cursors. Deduplicate by (sessionId,eventId).
   Use the atomic current room as replacement state, including on reset; do not
   replay visual payment actions for historical events.
5. Re-read canonical chain terms/state and independently verify receipts as
   appropriate. Backend events cannot set Paid or Verified Paid.
6. Store only a non-secret cursor scoped to that flow, or start at 0. Abort old
   fetches/timers and discard CSRF/join state on logout/account/room change.

## Presence, connections and inactivity

`POST /api/v1/sessions/:id/room/presence` accepts exactly:

```json
{"connectionId":"11111111-1111-4111-8111-111111111111","sequence":"1","state":"active"}
```

`state` is active or disconnected; sequence is a positive canonical decimal with
at most 15 digits. Generate a fresh random UUID per tab/connection generation,
retain it in that tab while reconnecting, and increment sequence before each
new heartbeat/disconnect. A duplicate sequence does not renew the lease; an
older message is ignored; equal sequence with a different state conflicts.
After a tab loses its counter, use a fresh connection ID instead of guessing.

Leases are scoped internally to the authenticated credential and connection ID.
One connection's disconnect cannot clear another tab/login's lease. Up to eight
connection slots per participant (sixteen total) are retained, including expired
tombstones, until room cleanup. This prevents old messages resurrecting activity
and prevents one role exhausting the other role's budget. Excess slots refuse.

Presence transitions are joined -> active -> disconnected -> resumed. The room's
boolean shared presence is true if any connection for that participant has an
unexpired lease. Resumed stays visible until the next disconnect; repeated active
heartbeats extend the lease without filling the event log. Joined records
participation, not liveness. Presence is advisory, never proof that a person is
looking at a screen, owns a business, accepted payment terms, or paid.

Lease: 30 seconds. Heartbeat: roughly every 15 seconds while active. There is no
background presence worker: reads, mutations and cleanup materialize expiry and
emit transitions. Legacy `{connected:boolean}` presence remains available, but
uses its own credential-scoped channel and does not provide client sequence
fencing; new clients should use the room endpoint and avoid running both APIs.

HTTP logout revokes auth first, then expires only that credential's presence.
Other logins remain active. Lost connections/crashes may appear active until
the 30-second lease ends. Reopen retains deadlines and sequence tombstones; it
does not extend the lease. No restart invents a fresh heartbeat. Session lifetime
remains 120 seconds; cleanup removes the room five minutes after expiry, including
replay keys and tombstones. No presence message extends session expiry.

## Payer wallet-progress hints

`POST /api/v1/sessions/:id/room/progress` requires the existing cookie, Origin,
CSRF and Idempotency-Key protections and exactly this body:

```json
{"expectedCursor":"5","phase":"AWAITING_WALLET","termsHash":"<64 lowercase hex>","transactionHash":null}
```

Subsequent phases are SUBMITTED, OUTCOME_UNKNOWN or USER_REJECTED. SUBMITTED
requires a syntactically valid chain hash; AWAITING_WALLET/USER_REJECTED require
null. UNKNOWN may retain a hash. Expected cursor is a compare-and-set fence:
another committed update, including a presence transition, causes
IDEMPOTENCY_CONFLICT. Refetch and inspect; do not blindly repeat a wallet action.

Only the joined payer, on the exact hash after both reviews, can write this hint.
Only AWAITING_WALLET can move to submitted/unknown/rejected. Submitted/unknown
cannot move back to wallet approval, even after a timeout, with a new key, after
restart or through another login. They require independent chain reconciliation;
there is no administrative reset or automatic retry path here. The hint never
calls the wallet, broadcasts, settles or certifies a supplied hash.

## Polling and SSE-compatible catch-up

Default room responses are JSON. Poll around every six seconds, with jitter and
backoff; each response includes current state so a second snapshot fetch is not
needed. Heartbeat and room polls share the existing 60/minute peer/account
budgets. Coordinate tabs and two clients behind one NAT. Do not run duplicate
polling and EventSource loops. Preserve the cursor on transient outage, distinguish
coordination loss from payment failure, and stop on 401/403/expiry; 429 requires
backoff. No retry delay authorizes signing.

The same GET with **exact** `Accept: text/event-stream` returns a finite UTF-8
catch-up response, not a retained push subscription. Each request authenticates
again. Frames use `id`, `event`, `data`, blank-line termination and `retry: 6000`:
`room.changed` for retained full-state events, then `room.snapshot` for the
atomic envelope; a replay gap instead yields `room.reset` with the replacement
envelope. The last frame's ID is the high-water cursor and can equal the final
change ID. Applying it twice must be harmless. The body closes after this bounded
batch; no subscriber queues, lease timers or post-logout emissions are retained.

Use authenticated fetch-based SSE consumption when error/status/backoff control
is needed. Native EventSource reconnects on end of body, but cannot set an initial
Last-Event-ID itself; it must start at 0 and clients must handle named reset and
snapshot frames. Close it on account/logout/navigation and do not put a token or
cursor into a URL query (the handler rejects queries). Error responses remain
sanitized JSON, not success-shaped SSE. Same-origin Secure HttpOnly Strict cookies
and all existing auth/CSRF/origin/rate gates are unchanged. The framing follows
the [WHATWG server-sent event format](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream);
mobile/proxy/EventSource behavior has not been physically tested.

## Read-only pilot projection and live refusal

`createPilotReader()` still has no signer. New `capabilities` explicitly reports
sessionBinding false and reason PILOT_SESSION_BINDING_UNSUPPORTED.
`readCanonicalRequest` validates the ID and throws `PilotBindingUnavailable`
(`code: VERIFICATION_UNAVAILABLE`, the same structural reason), without contacting
RPC. Refusal is a capability decision, not a misleading RPC outage.

`readRoomPayment(id)` is a library read seam, not an activated HTTP route. It
returns the canonical request and existing finalized provenance, contractStatus,
an OPEN/PENDING_CHAIN/PAID_PER_CONTRACT/CANCELLED/EXPIRED/BLOCKED projection and
`receiptVerification: "CLIENT_REQUIRED"`. Expiry uses the observed block time.
It refuses stale/mock/outage/mismatched evidence. PAID_PER_CONTRACT is explicitly
not independently verified. No production event or caller input supplies proof.
No live Testnet read was performed during this work.

The production factory keeps `authenticationAccepted:false`, including all new
room endpoints and SSE requests even with previously stored cookies. There is
no env/body/header override, fake login, public demo-auth server, or fallback
from a bound Handshake sale to an unbound ordinary Instant request. Existing
ordinary Instant Pay and frontend work are untouched.

## Persistence/recovery boundary

The encryption envelope remains `taply.storage.v2`. The handshake namespace now
also requires the explicit domain format `taply.session-room.v1` because room
events, progress, connection tombstones and replay results are durable state.
Older Phase 7C session snapshots without this domain format refuse, including
initialize=true. Domain validation runs before any encrypted-payload rewrite;
tests verify the old handshake payload remains unchanged. No automatic migration
or reinterpretation of old replay authority exists.

Do not open real prior stores with initialization as a recovery fallback. No
existing user/service database was accessed here. For a separately reviewed
clean start, preserve/quarantine old DB/WAL/SHM/backups, provision a new dedicated
service-encryption key and empty path, set private ACLs and explicitly initialize
once. Routine reopen uses initialize=false. A future migration needs its own
offline validator and security review. Never clear consumed records or reuse an
old key/path as an implicit migration.

SQLite BEGIN IMMEDIATE serializes state, sequence increments and idempotency in
one commit. Two-engine/durable-reopen tests verify no lost room updates. Memory
storage remains synthetic and loses all state on a fresh instance. Existing
corruption/uncertain commit handling refuses; storage is bounded to 8 MiB per
namespace and full-snapshot writes are synchronous. This is a small single-host
implementation, not a load-tested service or multi-host HA design.

**Valid encrypted backup rollback remains vulnerable:** consumed challenges,
logged-out sessions and joins can be resurrected. Room cursors and sequence
tombstones in the same restored snapshot do not add external freshness. Existing
vulnerability tests remain in the passing suite. Production auth stays NO-GO
until external freshness/fencing and operational recovery are reviewed. Windows
ACLs, power-loss/disk-full/ambiguous-COMMIT handling, physical wallet capability
and local HTTPS/proxy acceptance remain open gates.

## Validation and reproducibility

Executed with Node v24.22.2 / pnpm 11.5.0 on Windows:

```powershell
Set-Location C:\taply-phase7-core
node --test apps/api/test/*.test.mts
node packages/shared/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json
node apps/web/node_modules/eslint/bin/eslint.js --config apps/api/eslint.config.mjs apps/api/src apps/api/test
pnpm check
```

Results: API **58 tests, 57 passed, 0 failed, 1 skipped** (POSIX permissions on
Windows). API strict types/lint exit 0. Root `pnpm check` exit 0: brand/build/types/
lint; shared 92, near-client 158 and web 515 passed. **822 passing tests total,
zero failures, one skip**, excluding repeated runs. API still runs separately
from the root workspace check; no workspace manifest/lockfile changes were needed.
Rust was not run because contract source/ABI/deployment are unchanged. Hosted CI
and physical devices were not run. Existing jsdom warnings are non-failing.

New tests cover all room stages, exact role/hash boundaries, progress forgery,
idempotent and reordered bodies, stale cursors, duplicate/no-op messages, unknown
signing outcomes, immutable input during auth await, multi-tab/multi-login
presence, lease expiry/resume, bounded replay/reset, credential revocation,
connection budgets, close semantics, SQLite reopen/concurrency, old domain
refusal without payload rewrite, finite SSE/HTTP auth/CSRF/error behavior and
honest pilot projections. Two-client HTTP tests use real off-chain cryptography
with synthetic finalized association/request evidence; direct room tests use
explicit synthetic auth. Neither is a real wallet or chain integration.

Initial test-authoring failures were a fixture passing extra fields to the strict
request-ID function and an old assertion expecting legacy disconnect to clear a
second active connection. Both were corrected without weakening validation or
aggregate presence semantics. The final complete API suite passes.

Remaining true-G2 blockers: separately reviewed session-capable contract and
adapter/deployment, actual Testnet wallet NEP-413/callback proof, signed merchant
profiles, frontend integration and independent receipt verification, trusted
HTTPS/ACL/key/recovery configuration, external freshness protection, resource
acceptance and real two-device chain evidence. This work closes none of those
activation gates. No deployment/signing permission is implied.
