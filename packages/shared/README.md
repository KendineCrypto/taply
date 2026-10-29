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
