# @taply/shared — Protocol Freeze v1

Phase 0 implements strict wire validation and deterministic hashing only. It does
not sign transactions, access RPC, authenticate wallet signatures, settle funds,
or establish that a supplied receipt is true. Synthetic fixtures are not Testnet
evidence. The authoritative specification is `docs/LEAD_PROTOCOL_FREEZE_v1.md`.

From the repository root, with Node 24.13.0 and pnpm 11.5.0:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
```

`pnpm check` typechecks, builds, and runs Node's unit tests. The exported ESM
package is browser-compatible: no Node filesystem, network, signing, or key APIs
are imported by `src/`. Consumers import types and schemas from `@taply/shared`.
Build the package before consuming it. The package and workspace are private.

Use `parseStrictJson(rawTextOrUtf8Bytes)` **before** a framework's JSON body parser.
Ordinary `JSON.parse` has already lost duplicate properties, including escaped
aliases such as `amountBaseUnits` / `\u0061mountBaseUnits`. Then validate using the
appropriate strict Zod schema. `parseIntentTermsJson` performs both steps.

Canonical hashing validates the entire immutable intent, including its
deterministic ID. No normalization or coercion is performed. `calculateRequestId`
accepts only the four identity fields; unknown fields reject. A valid ID does not
make a changed payload eligible for reuse: duplicate creation must be rejected by
the future contract. Shared schema acceptance never grants transaction authority.

## Dependencies and reproducibility

Exact versions and integrity hashes are recorded in `pnpm-lock.yaml`. Runtime
libraries: Zod (strict schemas), Microsoft's jsonc-parser (duplicate-aware visit,
configured to reject comments/trailing commas), canonicalize (RFC 8785 JCS), and
@noble/hashes (SHA-256). TypeScript is the compiler; tests use Node's built-in test
runner and independently compare digests with Node crypto. No dependency install
scripts are required. No wallet/NEAR signing SDK is installed in Phase 0.

All published artifacts and dependencies remain subject to their own licenses.
The lead still needs to choose the project's license before public submission.

## Phase 0 validation observed on Windows

Node 24.13.0, npm 11.6.2, pnpm 11.5.0, TypeScript 7.0.2.

- `pnpm install --frozen-lockfile --ignore-scripts --offline`: exit 0 using the
  previously downloaded store; lockfile remained unchanged.
- `pnpm check`: exit 0; public-type assertions and source typechecking passed;
  build passed; **92 unit tests passed, 0 failed**.
- Both lead-frozen hash/code fixtures match; tests also cover duplicate JSON,
  integer/Unicode boundaries, funding-derived cutoff, mock/stale observations,
  retry projections, receipt consistency, SSE fields and merchant substitution.

Node's test subprocesses required sandbox execution approval in this managed
Windows environment. These are local protocol checks, not Rust, sandbox, browser
E2E, NEP-413 signature verification or live Testnet settlement tests. No endpoint
or contract has been implemented by this phase; all Phase 0 capabilities remain
disabled and deployment/gas/storage configuration remains null.
