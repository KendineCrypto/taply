# API service (production gates closed)

Current Phase 7C.1: read `docs/PHASE_7C_SECURITY_REVIEW.md` and
`docs/PHASE_7C_POS_INTEGRATION.md` before integration. API suite: 42 passed,
1 POSIX-only test skipped on Windows. Strict typecheck/lint and full pnpm check
passed. All existing reproduction commands below still apply.

Auth scope/rotation/logout-race and storage-format/corruption hardening are now
implemented. Authenticated storage format v2 rejects prior v1 snapshots; there is
no migration runner. Valid backup rollback STILL resurrects auth/join authority:
external freshness or reviewed invalidating recovery remains necessary. Windows
ACLs, physical wallet capability and local HTTPS/network hosting are unproven.
No live auth/commerce/Handshake flags or production capability gate was enabled.

## Historical implementation notes

Phase 7C: see `docs/PHASE_7C_SERVICE.md`. `src/service.mts` now composes encrypted
SQLite persistence, real NEP-413 verification and HTTP handlers. It starts no
listener and keeps production authentication/protected routes disabled. Local
two-client integration tests use synthetic finalized key/request evidence with
real cryptography. Signed merchant profiles and live Handshake are unavailable.
The earlier six-test/refusal-only descriptions below are historical; the full
API suite now contains 35 tests. Run `node --test apps/api/test/*.test.mts`.

The isolated session engine in `src/sessions.mts` now implements coordination;
`src/pilot-reader.mts` reads canonical pilot requests with finalized provenance
but always refuses Handshake binding. See `docs/PHASE_7_SESSION_ENGINE.md`.
Neither is wired into HTTP. Run all API tests with the command below (23 tests).

Additional checks from root:

```
node packages/shared/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json
node apps/web/node_modules/eslint/bin/eslint.js --config apps/api/eslint.config.mjs apps/api/src apps/api/test
```

Tooling is reused from the installed workspace; no dependencies added. This is
temporary until lead-approved API workspace/CI integration. Lint permits `any`
only in adversarial test fixtures; production sources use strict types.

No HTTP server is started. `src/http.mts` is a refusal-only Fetch handler:
auth/me returns 401; every other request returns 503 VERIFICATION_UNAVAILABLE.
No cookies, signatures, bearer sessions, merchant profiles or payment claims are
issued. Bodies are never read, logged or parsed. There is no CORS allowance.

`Challenges` is a bounded single-process isolated primitive, not a public auth
service. It implements random scope-bound challenges, expiry and atomic local
consumption. `Nep413Verifier` intentionally has no success path. Crypto signature
verification and finalized Testnet FullAccess key association are unimplemented.
No account ownership is inferred from supplied account strings.

Run from root (Node 24.22.2):

```
pnpm --filter @taply/shared build
node --test apps/api/test/*.test.mts
```

No dependencies or lockfile changes. Native Node TypeScript stripping runs these
isolated tests; these files are not yet integrated into recursive workspace check.
Before serving: implement/test crypto and finalized RPC verification, actual
wallet support, durable CAS storage, HTTPS __Host- Secure HttpOnly SameSite=Strict
cookies, browser-bound state and CSRF, exact Origin validation, per-account/IP
rate limits, bounded strict request schemas and timeout/resource limits. Do not
wire the primitive into routes until those gates pass. Process restart invalidates
all local challenges; multi-process operation is unsupported.
