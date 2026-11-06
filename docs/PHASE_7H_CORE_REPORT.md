# Phase 7H core hardening — Windows

Date: 2026-11-06. Local development only. Core fixes and runnable regressions
pass; contract/runtime acceptance remains blocked. Production authentication,
live Handshake and Protected Pay remain closed. The web verifier transport
follow-up below is **not implemented**, because this task prohibits web edits.

## Isolation and environment

- Host verified: `DESKTOP-SDAI72B`, Windows PowerShell environment.
- Repository remote: `https://github.com/KendineCrypto/taply.git`.
- Required base exists locally as a commit:
  `f3d15acd73faf35b7ff255ffbac6e7d48307b162`. No fetch was necessary.
- New worktree: `C:\taply-phase7h-core`; new branch: `feature/phase7h-core`.
  Created directly at the required SHA, before implementation.
- Selected project `C:\taply-phase7-integration` remains clean on
  `feature/phase7-integration` at `5999d0c`. Existing worktrees/branches were
  preserved. `feature/phase7h-release` was not edited or checked out.
- Node `v24.22.2`, pnpm `11.5.0`. Existing installed dependencies were reused
  through local directory junctions from `C:\taply-phase7g-integration`;
  workspace package junctions resolve to the **new** Phase 7H shared/near-client
  builds. No installation/download command or manifest/lockfile change.
- No `cargo`, `rustc` or `rustup` on PATH; no user cargo executable. Docker CLI
  exists, but its Linux engine pipe is unavailable. No daemon started, image
  pulled or software installed.
- This report is included in the local implementation commit. Obtain its full
  SHA with `git log -1 --format=%H feature/phase7h-core`; the final handoff gives
  the observed SHA rather than embedding a self-referential commit hash here.

## Changes

1. Contract preflight test uses `fileURLToPath(new URL(...))`, replacing URL
   `.pathname`. Windows drive letters, spaces and Unicode are decoded correctly.
   A separate artifact-independent regression runs on Windows. The actual WASM
   preflight remains mandatory and fails honestly when its artifact is absent.
2. Core RPC transport reads bounded error bodies on HTTP 400/404/408/422/500.
   It validates JSON-RPC version, matching request ID, exactly one result/error,
   and an integer error code before using structured error names. Results on
   non-2xx responses are never returned. No transaction submission, retry loop,
   provider fallback or signing path was added.
3. Explicit `UNKNOWN_BLOCK`, `GARBAGE_COLLECTED_BLOCK`, or `UNKNOWN_CHUNK`
   becomes the additive near-client error `BLOCK_UNAVAILABLE` (retry `NONE`).
   This means the provider lacks that history, not proof the payment failed.
   `UNKNOWN_TRANSACTION` remains `TRANSACTION_UNKNOWN`; `TIMEOUT_ERROR` and
   HTTP 408 remain `RPC_TIMEOUT`, both `WAIT_AND_RECONCILE`. A timeout alone
   never establishes pruning. Unrecognized/invalid non-2xx envelopes remain
   transport errors. HTTP 429 retains rate-limit treatment. Error prose is not
   exposed, and HTTP errors cannot trigger legacy method fallback.
4. Forty new near-client tests cover structured HTTP errors, response-ID replay,
   malformed/error-result envelopes, prohibited fallback, error-body size bounds
   and stalled-body cancellation. Thirteen core-owned tests exercise the
   unchanged independent web verifier: wrong payer/recipient, one-yocto under/
   overpayment, wrong request ID, callback nonce replay, missing payload/outcome,
   pruned history, timeout, and independent intact proofs on two synthetic clients.
5. API security regressions add expiry while NEP-413 key lookup is pending
   (challenge stays consumed) and malformed/stale/replaced external freshness
   heads (no application decision and no automatic recovery).

No changes to `apps/web`, `README.md`, shared schemas, manifests/lockfile,
contract Rust logic, ABI, deployment pins or production service configuration.
The only shared document added is this explicitly requested report.

## Observed read-only FastNEAR evidence

Endpoint: `https://test.rpc.fastnear.com`. POST JSON-RPC ID `phase7h-history`.
These are current error observations, **not a new verified payment proof**.

| UTC observation | Request | Observed result |
| --- | --- | --- |
| 08:31:49.673 | `block`, `block_id:275767733` | HTTP **422**, code `-32000`, `HANDLER_ERROR`, cause `UNKNOWN_BLOCK`; data references `AKxg24GCGyreEARGfASH34D2xqDo6oAYQxKS28Cg8d6w` |
| 08:31:59.613 | `EXPERIMENTAL_tx_status`, `wait_until:FINAL`, hash `CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su`, sender `taply-pilot-funder-1101.testnet` | HTTP **408**, code `-32000`, cause `TIMEOUT_ERROR`, info cause `NOT_OBSERVED` |

The historical hash/sender/block come from the existing pilot evidence. The
second response does not prove why the transaction is unavailable. No existing
payment, deployment or contract hash was newly verified in this task.

Current API references checked before implementation:
[NEAR transaction RPC](https://docs.near.org/api/rpc/transactions) documents
FINAL and the receipt-bearing status methods;
[Node fileURLToPath](https://nodejs.org/api/url.html#urlfileurltopathurl-options)
documents native file URL conversion. No SDK/toolchain version was changed.

## Validation performed

Commands below run from the new repository root unless noted. Direct installed
Node entrypoints avoid installing dependencies or borrowing another worktree's
package-manager command shims. Each listed passing check completed successfully.

| Command / check | Observed outcome |
| --- | --- |
| `node packages/shared/node_modules/typescript/bin/tsc -p packages/shared/tsconfig.json` | PASS; local shared build |
| `node packages/near-client/node_modules/typescript/bin/tsc -p packages/near-client/tsconfig.json` | PASS; local near-client build |
| `node --test packages/shared/test/*.test.mjs` | **92 passed** |
| `node --test packages/near-client/test/*.test.mjs` | **207 passed** |
| `node --test --test-isolation=none apps/api/test/*.test.mts` | **67 passed, 1 skipped** (POSIX permissions; Windows ACL gate remains) |
| `node apps/web/node_modules/vitest/vitest.mjs run --config packages/near-client/verification-tests/vitest.config.mts` | **13 passed** |
| `node node_modules/vitest/vitest.mjs run` in `apps/web` | **757 passed, 1 skipped** (opt-in live locator) |
| `node --test contracts/payments/test/file-url.test.mjs` | **1 passed** |
| `node --test packages/near-client/integration/*.test.mjs` | **1 passed**, real read-only Testnet root account/balance |
| `node packages/shared/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json` | PASS |
| `node packages/near-client/node_modules/typescript/bin/tsc -p packages/near-client/tsconfig.test-types.json --noEmit` | PASS |
| `node packages/shared/node_modules/typescript/bin/tsc -p packages/shared/tsconfig.json --noEmit` | PASS |
| `node apps/web/node_modules/typescript/bin/tsc -p packages/near-client/verification-tests/tsconfig.json` | PASS |
| `node apps/web/node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --incremental false` | PASS |
| `node apps/web/node_modules/eslint/bin/eslint.js --config apps/api/eslint.config.mjs apps/api/src apps/api/test` | PASS |
| `node node_modules/eslint/bin/eslint.js .` in `apps/web` | PASS |
| `node node_modules/next/dist/bin/next build --webpack` in `apps/web` | PASS; compiled, types passed, 21 static pages generated |
| `node apps/web/scripts/verify-brand-assets.mjs` | PASS; 7 assets byte-identical |
| `git diff --check` | PASS |

Totals across the final runnable suites: **1,138 passed, 2 intentional skips**.
Existing jsdom media/navigation warnings and Node module-format warning do not
represent chain or browser-device proof. Test crypto uses synthetic fixture keys;
no wallet/live signature or network transaction was requested.

The live root-account read was finalized at height `276463696`, block
`86qbbPgj3iv2svAd3nxpKEJXr9bS24xGNuysv6Af75z8`, checked at
`2026-11-06T08:31:35.390Z`. It proves public reads only.

Initial sandboxed build/test attempts hit filesystem/process permissions and
were rerun with approved execution. Initial new-test failures were fixed before
the passing runs above; they are not hidden as successful checks.

### Blocked contract checks

- `node --test contracts/payments/test/*.test.mjs`: path regression passes;
  full preflight file fails `ENOENT` for
  `contracts/payments/artifacts/merchant-v1/payments.wasm`. The resolved path is
  now correct on Windows. No dummy WASM was substituted and no skip introduced.
- `node contracts/payments/scripts/check-wire.mjs`: `ENOENT`, sandbox
  `artifacts/requests` absent.
- `node contracts/payments/scripts/check-exports.mjs`: `ENOENT`, default
  `artifacts/payments.wasm` absent.
- `cargo test --locked --lib` in `contracts/payments`: command not found.
  Default/candidate Rust tests, fmt, Clippy, WASM builds/hash equality and both
  near-workspaces sandbox configurations are therefore **BLOCKED, not passed**.
  No claim that existing candidate bytes match the pilot or execute safely.

## Security gate review

- **Independent Verified Paid preserved:** only finalized, bound funding,
  transfer and callback evidence plus code/access-key checks can return a
  receipt. Contract status, API/SSE hints and transport errors cannot do so.
- **Rollback remains a production blocker:** authenticated encrypted SQLite
  alone accepts old valid backups. Existing vulnerability tests still demonstrate
  consumed-auth/join replay and logout resurrection. External CAS fencing tests
  pass, but no independent production authority or async auth/room integration
  exists. Neither this review nor these tests close that gate.
- **NEP-413 remains gated:** exact signed scope/nonce/account/state/callback,
  expiry, finalized FullAccess association and rotation checks are retained.
  Added lookup-expiry test passes. Real wallet/mobile callback compatibility,
  host ACLs, HTTPS/cookie provisioning and recovery acceptance remain unproven.
  Existing sessions do not continuously recheck revoked keys.
- `createCommerceService` still hardcodes `authenticationAccepted:false`.
  No listener, live Handshake, auth flag or escrow capability was enabled.
- Configured-RPC trust is not light-client verification. Missing history needs
  a separately selected suitable archival provider; this patch does not switch
  providers or silently retry payments.

## Integration handoff

1. Review this isolated local commit; no push, merge or release-branch change
   was performed. Integrate only after separate authorization.
2. Frontend owner must address `apps/web/src/lib/verify/rpc.ts` separately.
   Its verifier currently discards all HTTP error bodies, so the observed 422
   still becomes `RPC_UNAVAILABLE` in the app. The locator already reads some
   error bodies but should also validate version, matching ID, result/error
   exclusivity and integer error code before classification. Use the core
   transport tests as the behavior contract: explicit missing history may map
   to `UNKNOWN_BLOCK`/`HISTORY_UNAVAILABLE`; 408 `TIMEOUT_ERROR` stays transient.
   Preserve bounds and never treat an HTTP error result as proof. The new
   core-owned web tests explicitly document the remaining behavior; update those
   expectations alongside the frontend fix. **Core changes alone do not repair
   the app's separate transport.**
3. Consumers of near-client should handle additive `BLOCK_UNAVAILABLE` as
   unavailable provider history, with no financial retry authority. No frozen
   shared protocol enum changed.
4. On an approved environment with Rust 1.95.0 and wasm target, run default and
   `merchant-bound-v1` unit/Clippy/build/sandbox checks, reproduce both WASM
   builds, then rerun artifact preflight, exports and wire checks. Installation
   and deployment remain separately approval-gated.
5. Keep production auth/G2 closed until external freshness integration, real
   wallet/device evidence, host/recovery acceptance and candidate security/runtime
   approval exist. No funds movement is proposed by this handoff.
