# Phase 7G: Handshake room adapter (frontend boundary, handoff to Codex)

2026-11-05, branch `feature/phase7g-ux`. Frontend only (`apps/web`). **Real
Handshake stays disabled.** No flag changed, no backend contacted, no route
wired. This document is the frontend half of the `GET /api/v1/sessions/:id/room`
contract in `docs/PHASE_7_SHARED_ROOM.md`.

## What exists

| File | Role |
| --- | --- |
| `src/lib/handshake/room.ts` | Versioned schemas, `parseRoomSync`, `applyRoomSync`, `presentRoom`, `RoomAdapter`, `resolveRoomAdapter`, `createRoomReader` (not installed) |
| `src/components/handshake/RoomStatusPanel.tsx` | One phone's room view, rendered only from `presentRoom` |
| `src/components/handshake/RoomDemo.tsx` + `src/lib/mock/room-demo.ts` | DEMO preview on `/demo/handshake`, synthetic rooms through the real presenter |
| `src/lib/handshake/__tests__/room.test.ts`, `src/components/handshake/__tests__/room-ui.test.tsx` | Contract, gating and isolation tests |

## Contract the frontend expects (`taply.room-sync.v1`)

Mirrored from `apps/api/src/room.mts` (copied, not imported: Node backend modules
must not enter the browser bundle). Strict objects: an extra field is `invalid`.

```ts
RoomSync  { schemaVersion: 'taply.room-sync.v1', sessionId: uuid, cursor: decimal,
            reset: boolean, serverTimeMs: int, room: RoomSnapshot, events: RoomEvent[≤64] }
RoomSnapshot { schemaVersion: 'taply.room.v1', authority: 'coordination_only',
            session: HandshakeSession (shared v1), phase, reviews, presence, payerProgress }
RoomEvent { schemaVersion: 'taply.room-event.v1', eventId, sessionId, emittedAt, type, room }
```

Extra checks beyond the backend types: the room and every event belong to
`sessionId`; event IDs strictly increase and do not exceed `cursor`; a `reset`
carries no partial events; `SUBMITTED` needs a hash and `AWAITING_WALLET` /
`USER_REJECTED` carry none. A different `taply.room-sync.*` version is
`unsupported_version` and shows nothing from the payload.

**Please keep the frontend informed** if any of these change. A new version
string is the safe way to evolve it: the current build refuses it explicitly.

## Consumer behaviour (implemented)

`applyRoomSync({ previous, sync, requested, current })` follows the handoff's
recommended algorithm:

1. Discard a response fetched under a different session, account or auth
   generation than the current one (`stale_scope`, `other_session`).
2. Ignore an older or equal cursor unless `reset` (BigInt compare; duplicates
   replay nothing).
3. Otherwise replace local state with the atomic `room` and return
   `recheckChain: true`. The caller must re-read the chain. The room never sets
   payment state.

`createRoomReader(origin, fetch)`: exact same-origin HTTPS only, `credentials:
same-origin`, `cache: no-store`, `redirect: error`, 5 s timeout, cursor only in
`Last-Event-ID` (never in a URL). 401/403/404/410 map to
`unauthenticated`/`forbidden`/`not_found`/`expired`. Polling cadence, jitter,
backoff, presence heartbeats, CSRF and progress writes are **not** implemented;
they need the reviewed auth/session layer first.

## Presentation rules (`presentRoom`)

- **Customer joined** only when the session is `PAIRED`/`REVIEWED` with a
  non-null `payerAccountId` and a payer presence slot, i.e. the service recorded
  an authenticated single-use join. A scan, a QR or a presence slot on an
  `OPEN` session never shows a customer.
- **Connection**: the other side's lease. `disconnected` reads as interrupted,
  `resumed` as reconnected. Advisory.
- **Code**: derived on this device from chain terms (`present.ts`) and compared
  with the server's. A match is a human aid, not merchant authentication.
- **Merchant identity**: the type is the literal `'unverified'`. There is no
  code path to "verified". Changing that needs a reviewed NEP-413 signed
  profile proof and a new field, not a flag.
- **Wallet progress**: labelled "Reported by the payer's phone. Not proof of
  payment." `SUBMITTED` gives `pending_chain`; `OUTCOME_UNKNOWN` gives a block
  ("Do not pay again").
- **Chain**: an input (`ChainSide`) from this device's own finalized read and the
  independent verifier, passed through untouched. The view has no "paid" field.
- **Expiry**: judged on the chain-time `nowNs` passed in, plus server `EXPIRED`.
  The device clock is not used.

## Gating

`resolveRoomAdapter(flags, backend)` returns an unavailable adapter unless
`NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE=on` **and** a reviewed backend adapter with
version `taply.room-adapter.v1` is supplied. This build supplies none. A source
scan test fails if a non-`lib/handshake` file constructs a room reader, if the
room demo is mounted outside `/demo/handshake`, or if a live file imports
`lib/mock`.

## Still needed before real Handshake (not frontend)

1. Session-capable contract and reviewed near-client adapter: request terms with
   `sessionBinding`, so the local code can be computed from chain terms
   (`readCanonicalRequest` currently refuses with `PILOT_SESSION_BINDING_UNSUPPORTED`,
   which the UI shows as `verification_unavailable`).
2. Production authentication accepted (it stays `authenticationAccepted:false`),
   NEP-413 wallet compatibility proven on real wallets, signed merchant profiles.
3. HTTPS/proxy/ACL/key/recovery and rollback-freshness gates from
   `docs/PHASE_7E_INTEGRATION_REPORT.md`.
4. Then, frontend: wire `createRoomReader` behind `resolveRoomAdapter`, add the
   polling loop (≈6 s with jitter, backoff, stop on 401/403/expiry), presence
   heartbeats and the payer progress writes. Map `ChainSide` from `/pay/<id>`
   (`progressStageFor`) and `verified_paid` only from the receipt verifier.
5. Real two-device evidence on Testnet.
