# Taply native Instant Pay contract

Phase 2B implements native requests and asynchronous payouts. Local verification
is reported in [VALIDATION.md](VALIDATION.md). No Testnet deployment, real-wallet
signing or Testnet fund movement has been performed or approved.

Read [ADR-001](ADR-001.md), the [ABI](ABI.md), and the [Claude integration
handoff](HANDOFF_CLAUDE.md). Protocol authority remains
`docs/LEAD_PROTOCOL_FREEZE_v1.md`. No shared schemas, root pnpm dependencies or web
source are changed. This package has an independent Cargo workspace and lockfile;
the real sandbox runner has its own independent Cargo workspace and lockfile.

## Reproduce on Linux

Requires Rust **1.95.0**, the wasm32-unknown-unknown target, Rustfmt, Clippy, a C/C++
toolchain, pkg-config and OpenSSL development libraries. `rust-toolchain.toml`
pins the toolchain/target. `near-sdk = 5.30.0`, `near-workspaces = 0.24.0` and their
transitive dependencies are locked. The latter uses `near-sandbox 0.4.0` and local
nearcore sandbox **2.14.0**. First execution downloads public dependencies and the
sandbox binary; it does not contact Testnet or use external wallet credentials.

From this directory:

```sh
bash scripts/check.sh
```

This checks formatting, unit tests, Clippy, builds production and callback-fault
WASM, prints SHA-256 hashes and runs real sandbox promise execution tests
sequentially. `--locked` is required. Build output and logs go in ignored
`artifacts/`. No deployment command is included. `scripts/sandbox.sh` reruns only
sandbox tests after both artifacts have been built.

From repository root, after building the existing shared package:

```sh
pnpm check
node contracts/payments/scripts/check-exports.mjs
node contracts/payments/scripts/check-wire.mjs
```

The export check compares production WASM with the ABI manifest. The wire check
parses actual sandbox read records with the unchanged TypeScript schema and
recomputes terms hashes; the records are local test evidence, not Testnet proofs.

## Windows / Docker

Run `scripts/check-docker.ps1` in PowerShell with a running Linux Docker engine.
It uses an exact image digest, reads the repository, writes only this contract
directory, and uses separate named build-cache volumes. No host wallet/key
directories, Docker socket or network ports are mounted/exposed. The local sandbox
creates disposable keys inside its container for local test accounts only.

The equivalent image is:

```text
rust:1.95.0-bookworm@sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1
```

The WASM build uses `target-cpu=mvp`, optimization `z`, LTO, one codegen unit,
overflow checks and panic abort. `scripts/build.sh` restores the default production
target after building the fault artifact. **Never deploy**
`payments.callback-fault.wasm` or enable `sandbox-fail-callback` in a deployment.
The fault build always panics in the callback and reports `testFaultBuild:true`.

## Security limitations

Successful transfer followed by failed/missing/out-of-gas callback remains
PAYOUT_IN_FLIGHT. There is deliberately no timeout retry, payer refund, mutable
recipient or administrative settlement/reconciliation. This can strand an
obligation permanently. Only explicit transfer failure recorded by a successful
callback permits a recipient-signed retry with a fresh operation nonce.

Storage bonds are permanent. Code/base-state storage needs separately provisioned
balance. Runtime state and receipt facts do not prove external chain finality.
Full-access deployment keys can replace code outside these methods; upgrade/key
authority and operational reserve policy require human security review.

Protected Pay, Handshake/merchant profiles, NEP-141, sponsorship and migrations
are disabled/absent. Sandbox evidence is not a security audit or Testnet proof.
Obtain explicit approval before any Testnet deployment, real-key signing or funds
movement, and separate security approval before escrow work is enabled.

## Tool API references checked

The installed crate source was checked against the maintained upstream docs:
[near-sdk 5.30.0](https://docs.rs/crate/near-sdk/5.30.0),
[near-workspaces 0.24.0](https://docs.rs/crate/near-workspaces/0.24.0),
[bounded promise results](https://docs.rs/near-sdk/latest/near_sdk/env/fn.promise_result_checked.html),
[NEAR asynchronous callbacks](https://docs.near.org/smart-contracts/anatomy/crosscontract).
Only explicit `PromiseError::Failed` allows retry; `TooLong`, unknown results and
callback execution failures do not.
