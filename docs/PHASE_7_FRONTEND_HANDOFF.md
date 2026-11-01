# Phase 7 bounded implementation handoff

> Current Phase 7C handoff: use [PHASE_7C_SERVICE.md](PHASE_7C_SERVICE.md) for exact
> HTTP schemas and security prerequisites. New handlers and durable authentication
> are locally tested with real off-chain cryptography and synthetic RPC evidence.
> Production factory refuses authentication and protected service access pending
> wallet capability acceptance. Signed merchant profiles and live bindings remain
> disabled. All older status descriptions below are historical.

> Continuation update: the original snapshot below is historical. The isolated
> Handshake engine and read-only pilot adapter are now implemented and tested.
> See PHASE_7_SESSION_ENGINE.md for the current integration contract. Public
> mutations remain disabled and G2 remains NO-GO. The prior three near-client
> failures were diagnosed and fixed in test fixtures only; full pnpm check now
> passes. No new deployment or transaction occurred.

G2 NO-GO. Stage 1 audited and committed. Stage 2 completed only in its explicitly
permitted disabled-verifier form. Stage 3 engine is not implemented. Stage 4
contract code is not implemented; proposal below. No public server is deployed.

## Actual HTTP boundary

`apps/api/src/http.mts::handle(Request): Response` is an isolated Fetch handler.
GET /api/v1/auth/me returns 401 AUTH_REQUIRED. All other requests, including
POST /api/v1/auth/challenges, auth/verify, auth/logout, GET merchants/:accountId
and every session route, return 503 VERIFICATION_UNAVAILABLE. It intentionally
does not parse bodies or issue cookies. No functional mutation schema is exposed.
The refusal is unconditional; supplied account IDs cannot grant access.

Exact response:

```json
{"schemaVersion":"taply.api.v1","error":{"code":"VERIFICATION_UNAVAILABLE","messageKey":"errors.VERIFICATION_UNAVAILABLE","requestId":"<random UUID>","retryAction":"NONE","retryAfterMs":null,"details":{}}}
```

auth/me substitutes AUTH_REQUIRED and errors.AUTH_REQUIRED. Responses carry
Cache-Control: no-store, Referrer-Policy: no-referrer and nosniff; no CORS headers.
This is refusal scaffolding, not a production API. No bearer or cookie auth exists.

## Future interface, not currently functional

Challenge/verify request schemas require lead/frontend agreement before exposing
them. Suggested challenge input: exactly {accountId}; server fixes purpose,
network, origin, recipient and contract. Verification submits challenge ID,
wallet-returned accountId/publicKey/signature/state in a bounded strict JSON body,
never query strings. Callback URL must match exact signed bytes if used.
Challenge issuance must bind browser state and rate-limit before allocation.
Only finalized Testnet FullAccess association plus verified NEP-413 signature
can produce an authenticated cookie. Never infer auth from WalletSession.

Reuse HandshakeSessionSchema and SessionEventSchema for future snapshot/events;
SessionReviewSchema is exactly {termsHash}. Lifecycle and role boundaries are
in PHASE_7_COMMERCE_PLAN.md. No session implementation or SSE exists yet.
Proposed bind input {intentId,termsHash} triggers independent chain verification,
not acceptance of client terms. Proposed join input {joinToken} is body-only.
All mutations need authenticated account-scoped idempotency plus CSRF/origin.

Discovery QR: exact HTTPS origin + /checkout/{accountId}, never a payable invoice.
Proposed sale QR: /s/{sessionId}#join=<secret>; consume/strip fragment immediately,
disable analytics and referrers, never put secret in SSE URLs. This format is
proposed, not enabled or shared-schema-approved. Each sale needs fresh signed
chain terms. Both clients independently fetch terms and use shared commitment/code.
SSE replay/reset and polling are still design requirements, not working features.

Keep merchantCheckout, handshake and protectedPay flags OFF. Existing unbound
Instant Pay remains separate. Do not downgrade merchant/session bindings to null.
Safe demonstrations now: local challenge/refusal tests and existing Instant flow
under its existing gates. No new wallet, chain or two-device proof was collected.

## Isolated next-contract implementation proposal

Do not upgrade/rebuild the pilot. Create a separate reviewed version/account only
under later authorization. Preserve IntentTerms v1 and request ID/hash algorithms;
no shared schema change required. Replace only the next version's null-only guard
with merchant == creator validation and strict session ID/nonce/u64 expiry checks.
Require a session-bound intent to have merchant == creator. Session binding expiry
must be future, bounded, and not exceed funding expiry; session expiry affects
coordination only and does not cancel a funded obligation.

ABI: retain create_request(terms,quoteVersion), quote_create_request(terms),
get_request(id), pay_instant_native(id,expectedTermsHash) and existing private
callback. Return calculated non-null sessionCommitment in request view. Advertise
new contractVersion/capabilities and storage quote version only on that separate
deployment. Recipient remains creator; enforce signer == predecessor == creator,
no delegated creation. Keep Protected/FT/admin settlement absent.

Security acceptance fixtures to add before implementation acceptance (not executed):
shared fixture A hashes/code exactly match Rust; B amount mutation changes hash;
wrong merchant/nonce/session ID/expiry rejected; reused creator nonce rejected;
forwarded signer rejected; exact larger storage bond required; gas measured;
pay wrong hash/payer/deposit rejected; private callback/nonce/replay tests pass;
actual transfer failure recoverable; transfer-success/callback-failure remains
in-flight without retry; aggregate conservation holds across mixed bound/unbound
requests. Near-workspaces sandbox must measure storage and exercise real promise
graphs. No failing acceptance fixture code is supplied yet; Stage 4 is incomplete.

## Reproduction and remaining work

Node 24.22.2 / pnpm 11.5.0. Run shared build then
`node --test apps/api/test/*.test.mts`. Six isolated tests passed on 2026-11-01.
These are local tests, not cryptographic or Testnet proof. No new dependencies,
manifest or lockfile edits. API is not yet a workspace package; pnpm check does
not include these six tests. Standalone strict typecheck command:

```
node packages/shared/node_modules/typescript/bin/tsc --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --skipLibCheck --types node --typeRoots apps/web/node_modules/@types apps/api/src/auth.mts apps/api/src/http.mts apps/api/test/auth.test.mts
```

This passed; it temporarily reuses installed workspace compiler/Node declarations.
`pnpm check` ran: brand verification, all builds, workspace typechecks and lint
passed. Test phase failed in unchanged near-client wallet-payment-signer tests:
pay_instant_native, cancel_unfunded and retry_native_transfer preparation each
raised INVALID_ARGUMENT; near-client total 158, passed 155, failed 3. Recursive
check exited 1 before web tests. These failures were not fixed in this bounded
unit. No Rust tests ran because no contract files changed.
Package/CI integration remains necessary. First test run failed due to an import
path, corrected before commit. Initial typecheck invocations failed locating the
compiler/Node declarations; command above is the executed successful form.

Next safe unit: independently tested NEP-413 verifier and finalized Testnet key
reader, then durable authenticated session engine and adversarial tests. Human
authorization is needed for a new deployment and live transactions, not local
implementation. Completion is bounded here by session capacity; no untested
security path is exposed. Auth, session, contract extension and live G2 evidence
remain blockers; this is not a working merchant checkout integration.
