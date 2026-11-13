# Mainnet integration hardening — 2026-11-13

Base: `codex/mainnet-integration-audit`, reviewed commit
`7c2a5a613a14f655cf45185d38a777621c017e97`.
Delivery branch: `codex/mainnet-integration-hardening`.

**GO for review and non-funding previews; NO-GO for Mainnet funds.** P1-3,
P2-4 and P2-5 now have implementation fixes and regression coverage. P1-4,
upstream receiver gas guarantees and R-2 remain open. No deployment, funding,
signing, account/key, hosting/DNS or production merge is part of this change.
`intentsRouter:false` and all three Mainnet release gates remain unchanged.

## Durable attempts (P1-3)

`apps/web/src/server/mainnet/oneclick/store.ts` replaces the expiring lease with
a no-TTL ledger per request under `taply:mainnet:1click:ledger:v1:<requestId>`.
Each ledger retains every attempt, an active pointer and a monotonic fence.
Attempt IDs are unique UUIDs. A reservation stores the exact outbound request,
mode, timestamp and ID before any external quote request.

Each mutation is a Lua compare-and-swap followed by **one SET** of the complete
ledger. Reservation, active pointer and lifetime count cannot partially commit.
Transitions compare the active ID, fence and prior state. There is no lease
takeover, automatic delete, expired funded-record removal or reset API.

| State | Meaning and permitted transition |
| --- | --- |
| RESERVED | Durable reservation acknowledged; only the original worker may CAS to DISPATCHING. A restarted worker blocks rather than guessing whether dispatch happened. |
| DISPATCHING | Persisted and acknowledged BEFORE calling 1Click; response may be lost. Only that attempt can CAS to READY or UNCERTAIN. |
| READY | Verified response persisted. An unexpired dry response may be reused. Only a completed, expired dry/fixture attempt with no deposit address can be replaced. |
| UNCERTAIN | Upstream error/timeout, invalid response or ambiguous completion. Never automatically replaced, including in dry mode. |

`service.ts` returns `ATTEMPT_UNCERTAIN` for reservation/dispatch acknowledgement
loss, quote timeout/lost response and completion ambiguity. If the database is
unavailable while marking uncertainty, the durable RESERVED/DISPATCHING state
already blocks another worker. If READY committed but its acknowledgement was
lost, later reads can reuse that stored verified dry response without another
upstream call; uncertainty cannot overwrite READY via a stale CAS.

**Any funded attempt blocks replacement forever**, including READY and expired
attempts. PENDING_DEPOSIT, FAILED, REFUNDED or SUCCESS hints do not release it.
No potentially fundable quote is reissued automatically. There are at most three
reservations per request for its lifetime; unsuccessful attempts consume that
budget. Prior dry attempts remain archived when a later dry attempt is reserved.
Existing legacy quote keys are quarantined (`LEGACY_BLOCKED`) instead of silently
ignored. There have been no approved live funded quotes in this candidate.

This deliberately favors safety over availability: an orphaned reservation can
leave even a dry request unavailable. Manual investigation may inspect the ledger,
but this change provides no destructive reconciliation or forced success tool.
Future reconciliation needs a separately reviewed protocol, not a TTL extension.

**Infrastructure assumption:** an acknowledged Redis write must not be lost or
evicted. Production requires durable storage, no eviction of attempt ledgers,
appropriate persistence/replication and backup/restore procedures that never
roll back a potentially dispatched attempt. Application CAS cannot make a
database that loses acknowledged writes safe. The AOF test validates the stated
local Redis configuration; it does not attest to a production Upstash service.
Redis Cluster multi-key scripting is not certified here; incompatible topology
fails closed. Nothing changes an existing database or its persistence settings.

## Admission and bounded input (P2-4)

`http.ts` streams at most **2,048 UTF-8 bytes**, with a **2-second body deadline**,
before JSON parsing. Oversized declared bodies are refused before reading;
oversized chunks and stalled streams are cancelled. Rejections never construct
the expensive service. Status and quote handlers both apply admission controls.

`rate-limit.ts` atomically checks and consumes global and IP quotas in Redis:
240 global / 60 IP requests per 60-second window. The service separately consumes
30 requests per request ID per 60 seconds before any chain config/request/storage
RPC or upstream status call. Failed/unknown request IDs still consume their
admission quota. Limits apply to status polling as well as quote preparation;
they do not rely on successful quote creation. Rejected requests do not extend
the window. Missing/unavailable Redis fails closed for live mode; only labelled
fixtures use an in-memory limiter.

Vercel's overwritten `x-forwarded-for` is trusted only when the platform sets
`VERCEL=1`; invalid or multi-value headers collapse into a shared bucket. Other
hosting environments ignore forwarded IP headers entirely and share one client
bucket, preventing clients from inventing identities. IPv6 is canonicalized;
only a SHA-256 bucket identifier is stored. This is rate limiting, not user
authentication or a distributed DDoS guarantee. NAT clients share capacity.
See [Vercel request-header semantics](https://vercel.com/docs/headers/request-headers).

## Exact storage quotes (P2-5)

`CreateRequest.tsx` reads `storage_balance_bounds` through the pinned Mainnet
reader. Live registration previews use the returned minimum, and stay absent
when bounds are unavailable. The fixture registration cost has been removed.

Merchant request quotes are associated with the complete canonical terms hash,
not the nonce-derived request ID. The original response's requestId, termsHash,
quoteVersion, deposit and gas go through the existing checked builder. The UI
never supplies an invented current hash around an old storage amount. Editing
memo/amount/expiry invalidates the prior quote even when the request ID is stable.
Parsed amount memoization also prevents state updates from retriggering endless
quote reads. Signing remains disabled; enabling signing will still require a
fresh review/read at the actual signing boundary.

## Verification and reproduction

Local Windows verification:

- `pnpm check`: passed; shared 93, near-client 262, web 1,397 passed / 14 skipped.
  Typecheck/build passed; lint 0 errors / 15 warnings. Skips include Redis suites.
- `pnpm build:mainnet`: passed with the documented fixture preview environment.
- Existing Chromium suite: **88/88 passed**, including mobile, desktop, Turkish,
  closed signing, withheld deposits, unknown outcomes and loaded-script isolation.
  [Result JSON](evidence/mainnet-hardening-2026-11-13/browser-qa-results.json).
  This is real browser execution with synthetic chain/backend fixtures, not live
  Mainnet payment evidence. The previously documented inert genesis residue remains.
- The old `audit-mainnet-lock.mjs` entry point now demonstrates that reservation
  takeover after 30,001 ms is BUSY; it is not a real Redis test.

New regression coverage:

- `hardening.test.ts`: 20 concurrent reservations, stale fence/ID/state writes,
  dispatch replay, indefinite funded-state blocking, worker restart, upstream
  response loss, writes lost before/after acknowledgement, no RPC on rate denial,
  byte limits, stalled-body cancellation and forwarded-IP spoofing.
- The same store scenarios run against a **real redis-server** through the existing
  REST bridge. Atomic rate consumption across 30 callers admits exactly five
  against a quota of five.
- `redis-restart.test.ts`: a real Redis instance uses test-owned AOF with
  `appendfsync always`; after persisting DISPATCHING, SIGKILL and restart restore
  the attempt, TTL is -1 and a new attempt is refused. Legacy keys are quarantined.
  Only this test's temporary local server/directory are created and cleaned up.
- `storage-hardening.test.tsx`: live bounds differ from the old fixture amount;
  RPC failure suppresses registration; same-ID edited terms invalidate the quote;
  a mismatched response hash is rejected.

Run `pnpm install --frozen-lockfile && pnpm check`. Linux needs `redis-server`
on PATH for the real-store suites. CI explicitly fails if Redis is absent.
Windows has no redis-server; the installed Docker backend did not respond and
was not modified. Real Redis execution must therefore be verified in CI, not
inferred from the passing in-memory tests.

The existing `workspace-check` workflow installs Redis and now also runs the
88-browser suite, uploading screenshots/results as `mainnet-browser-<SHA>`.
`mainnet-core-candidate` remains the unchanged contract/sandbox gate. Both
workflows are dispatched against the final delivery commit; consult the exact
run links in the delivery message before treating it as CI-verified. No workflow
contains deployment or signing steps. Existing Testnet builds/tests remain in
the workspace gate.

## Remaining release blockers and Claude handoff

1. No live router minimum-gas/message envelope is proven. Semantic unclaimed
   accounting cannot catch a receiver that fails before execution/accounting.
2. R-2 unknown payout/recovery callbacks remain in flight with no blind retry or
   admin success override. Manual unclaimed attribution is not a guaranteed Base
   customer refund.
3. No deployed candidate, actual Base-funded Taply flow, exact live merchant
   USDC payout or independent Mainnet receipt verifier has been proven.
4. Production ledger durability/eviction/restore settings and operational
   reconciliation must be assessed before any funding proposal. A database reset
   is never an authorized way to clear a potentially funded attempt.

Claude can integrate the hardening branch without ABI/shared-export changes.
Keep the server's `ATTEMPT_UNCERTAIN` as a stop state; do not turn it into a retry
loop or encourage a new payment. Preserve `Payment Recorded` limitations,
`intentsRouter:false`, and the three false release constants. Review the new
admission quotas against expected polling volume before any production rollout.
The previously captured signed live dry quote remains API compatibility evidence
only. This deliverable is a reviewable, tested candidate, never release approval.
