# `src/lib/protocol` — the frontend's only protocol import surface

**Phase 0.5: the temporary mirror is gone.** Every payment state, transport
model, schema and hashing function now comes from `@taply/shared` (Codex-owned,
`packages/shared`). There is one definition of `ChainState`, `CallerRole`,
`ErrorCode` and the hash domains in this repository, and it is not in this
directory.

## Files

| File | Contents |
|---|---|
| `index.ts` | Re-exports from `@taply/shared`, plus the frontend-only helpers below. **Import from `@/lib/protocol`, never from `@taply/shared` directly** — one seam makes a future protocol change a single-file edit. |
| `presentation.ts` | The only frontend-local additions. Each is justified in-file under one of three categories (a) iterable list for a union the shared package exposes no array for, (b) presentation metadata the protocol has no opinion on, (c) a defence-in-depth predicate restating a shared schema rule. |
| `__tests__/shared-compat.test.ts` | The compatibility contract: frozen fixture digests, session-binding mutations, enum mirroring, and the unsafe states the shared schemas must reject. |

Deleted in this phase: `chain-state.ts`, `types.ts`, `errors.ts` — all were
duplicates of the real package.

## What `presentation.ts` adds, and why

- `ASSURANCES`, `OBSERVATION_SOURCES` — `assurance` and `source` are declared
  inline inside `createChainObservationSchema`, so there is no `.options` array
  to borrow. Both lists are built from a `Record<Union, true>` keyed by the
  shared type, so omitting or inventing a member fails to compile.
- `CALLER_ROLES`, `PAY_MODES` — taken straight from the shared Zod enums'
  `.options`, so they cannot drift at all.
- `LOCAL_PHASES` / `LocalPhase` — the shared `LocalWalletState` has the three
  phases the protocol cares about; the UI needs `IDLE`, `REVIEWING` and
  `SUBMITTED` too. It is a strict superset and, by construction, has no member
  that can express a settlement outcome.
- `NEAR_NATIVE` / `DisplayAsset` — decimal precision is a formatting concern; the
  wire model only carries `assetId: 'near:native'`.
- `isVerifiedPaid`, `retryRoleMatchesKind`, `isUnknownOutcome`,
  `isAutoRetryableRead`, `toErrorCode` — fail-closed predicates. Each restates a
  rule the shared schema already enforces so that an object which reached the UI
  **without** validation still cannot light up a control. `shared-compat.test.ts`
  checks each one against the schema it mirrors.

## Corrections the real package forced

These were wrong in the pre-integration mirror and are now fixed:

| Mirror (wrong) | `@taply/shared` (authoritative) |
|---|---|
| `source: 'chain' \| 'index' \| 'mock'` | `'rpc' \| 'index' \| 'mock'` |
| `Role: payer \| recipient \| creator \| observer` | `CallerRole: anonymous \| payer \| recipient \| payer_and_recipient \| observer` (no `creator` — the creator **is** the recipient) |
| `derived.expired: boolean` | `fundingEligibility: ELIGIBLE \| EXPIRED \| NOT_OPEN \| UNSUPPORTED \| UNKNOWN`, a sibling of `derived` |
| `retry: { allowed, authorizedRoles }` | `retry: { eligible, operationNonce, kind }` |
| `protectedDurationNs` | `cancelDurationNs`, inside `IntentTerms` |
| 32 invented error codes | 56 real `ERROR_CODES` |
| `ChainObservation.data` non-null | `data: T \| null` |
| *(absent)* | `incident: CALLBACK_FAILED \| OUTCOME_UNKNOWN \| RECONCILIATION_REQUIRED \| null` |

## Resolved: the session-commitment question

Against Protocol Freeze v1 §7 I flagged that
`sessionCommitment = SHA256("taply.session.v1\n" + termsHash)` looked terms-only,
which would make the 6-character comparison code identical across sessions
carrying identical terms.

**The real schema answers it.** `sessionBinding { id, nonce, expiresAtNs }` is a
field of `IntentTerms`, so it is inside `termsHash`, so it is inside the
commitment. `shared-compat.test.ts` proves a change to the session nonce, the
session id or the session expiry each produces a different commitment and a
different comparison code, while leaving the deterministic `requestId`
unchanged. No protocol change is needed.

## Rules that still hold

- Hashing is **never** reimplemented here. Freeze §7 forbids deriving a second
  algorithm; the frontend calls `calculateTermsHash`, `calculateRequestId`,
  `calculateSessionCommitment` and `comparisonCode` from the shared package and
  is tested against the committed vectors.
- Strict JSON goes through `parseStrictJson` **before** any `JSON.parse`, because
  ordinary parsing has already discarded duplicate keys.
- UI flags never grant authority. The contract re-checks every action.

## Still deferred, with reasons

- **Service worker / offline caching.** Freeze §8 permits caching the static
  shell and assets only, with `no-store` on every payment read. A SW shipped
  before real payment reads exist is the exact mechanism that could serve a stale
  "Paid" screen. Deferred until there is a read layer to test it against.
- **Content-Security-Policy.** Needs a nonce-based setup against Next's inline
  bootstrap; done wrong it silently disables the app. Deferred to the phase that
  adds the wallet adapter, where it is load-bearing.
- **Transport layer.** No `fetch` client exists yet, so no endpoint under
  `/api/v1` is called. `PaymentIntentResponseSchema` is imported and tested but
  not yet wired to a request.
