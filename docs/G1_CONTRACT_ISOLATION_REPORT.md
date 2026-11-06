# G1 contract source isolation report

## Scope and disposition

Prepared locally on DESKTOP-SDAI72B, 2026-11-06. Worktree:
`C:\taply-g1-contract-isolation`; branch: `feature/g1-contract-isolation`.
Base: `352a7cfd9efeda314634a81905f459b290f947ec` (`feature/phase7i-ux`).
Implementation is ready for lead review and normal CI; no new local Rust/WASM
or sandbox success is claimed. The final local commit SHA is reported in the
handoff; `git rev-parse HEAD` identifies the report-bearing commit.

No push, merge, workflow dispatch, contract deployment, signing, funds movement,
or G2 activation occurred. Existing worktrees were not edited. No frontend,
shared schema, root manifest/lockfile, approved ABI or deployment pin was changed.
The diagnostic workflow and harness were not copied into this branch.

## Evidence used (observed, not inferred)

Read-only GitHub CLI inspection confirmed run
[42219636963](https://github.com/KendineCrypto/taply/actions/runs/42219636963)
succeeded at diagnostic commit `69e02ca52d7da95542fb16549b7732bd740cdf05`.
Downloaded its `UNAPPROVED-g1-repro-42219636963` artifact and inspected source,
environment, measurements and actual WASM bytes. The diagnostic remains evidence,
not deployment authorization or a substitute for full normal CI.

Runner: Ubuntu 24.04 image `20261101.360.1`; Rust 1.95.0 compiler commit
`59807616e1fa2540724bfbac14d7976d7e4a3860`; Cargo 1.95.0;
`wasm32-unknown-unknown`, `-C target-cpu=mvp --cfg near`.
Original build path: `/home/runner/work/taply/taply/contracts/payments`.
Each variant had two clean repetitions on that runner:

| Variant | Bytes | SHA-256 | Existing G1 preflight |
| --- | ---: | --- | --- |
| Historical, pre-merchant parent, proposed isolation | 345541 | `a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2` | pass |
| Merchant introduction and current default | 345659 | `6ec143af225de49011955b4343f115f161442e71e64f912d9cb39724bfabdd2a` | reject |
| G2 merchant at its old source path | 347419 | `aad2ae6d5110f27afc23fdc1c75a50563a9a0bf70356ca9adb0a668bfef27f21` | reject |

The approved NEAR code hash stays
`BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`.
All diagnostic variants matched their respective 12 function-export names;
that alone does not establish runtime correctness. Both downloaded isolation
WASM files were independently rehashed locally; the unchanged G1 preflight
passed all five checks on repeat 1 and rejected the downloaded G2 WASM (exit 1).
No downloaded diagnostic binary is committed or placed in G1 production outputs.

## Source separation and preservation

Restored exactly the four files used by the successful diagnostic from
`258f138110760f726c7e090e807015332f513b19`, at their original paths:

| File under contracts/payments | Diagnostic Git blob |
| --- | --- |
| Cargo.toml | `32498f28ea6be88b0f2948c4f42b0f2434cb93d9` |
| src/lib.rs | `5070ac2fefddfcffa3f70b3f25cbea65aa9814f6` |
| src/model.rs | `f43e3d43e971f1c98c861f9d3220355e00b26656` |
| src/tests.rs | `fbaa62ca92852a20e07834871f411d6b64720f5a` |

Those four blobs plus Cargo.lock, .cargo/config.toml and rust-toolchain.toml
were checked against downloaded source.json: all seven match. No contract
logic was rewritten. G1 no longer declares or compiles merchant-bound-v1.
The unused merchant.rs moved to the candidate context.

`contracts/payments-merchant/` is a sibling, independent Cargo workspace with
its own sandbox workspace. All four candidate Rust files, Cargo manifest/lock,
compiler config/toolchain, both ABI JSON files, sandbox manifest/lock and both
Node test files were compared byte-for-byte with the requested base: all 14
match. The complete candidate Rust tests and all ten sandbox test bodies remain.
Sandbox selection now asserts its context: G1 rejects an environment selector;
G2 requires `TAPLY_SANDBOX_MERCHANT_V1=1`. No test case was dropped.
Both contexts still use the pinned SDK/workspaces APIs and lockfiles; no new
NEAR API or dependency version was introduced.

The candidate retains build, sandbox, check, export/wire and offline preflight
commands. Its README documents the new cwd and outputs. Original merchant
build/sandbox/preflight entry points forward explicitly to the sibling context;
old Node test paths forward to the preserved candidate tests. Direct merchant
Cargo commands must now run from contracts/payments-merchant. G1's abi.json and
abi.merchant-v1.json remain unchanged; candidate copies are unchanged too.

## Build and target audit

| Context | Cargo targets | WASM outputs | Sandbox records |
| --- | --- | --- | --- |
| Frozen G1 | contracts/payments/target and sandbox/target | contracts/payments/artifacts/payments.wasm and payments.callback-fault.wasm | contracts/payments/artifacts/requests |
| Unapproved G2 | contracts/payments-merchant/target and sandbox/target | contracts/payments-merchant/artifacts/merchant-v1/payments.wasm and payments.callback-fault.wasm | contracts/payments-merchant/artifacts/requests |

No shared source module, manifest dependency, target path or artifact-copy path
connects the G1 contract build to G2. Relative shared fixture/import paths retain
the same directory depth. Candidate build.sh deliberately forwards to its
merchant build; it cannot produce a misleading G1-named production artifact.
Both builders restore their normal feature set after producing the fault build.
Build/check/sandbox scripts reject CARGO_TARGET_DIR overrides rather than copying
a possibly stale binary from an assumed directory. Direct Cargo users must keep
these workspace-local defaults; arbitrary manual Cargo configuration is outside
script guarantees.

The unchanged Docker check remains G1-only with its existing pinned image and
G1 target mounts. Shell scripts remain Rust-only (no new Node dependency inside
the Rust Docker image). Node source-freeze validation is a separate local/CI gate.
Docker was not started or reconfigured. Candidate validation runs in its own CI
job without the G1 Cargo target cache. Candidate CI uploads logs/records/hashes
only, never WASM or deployment material.

`g1-source-freeze.json` and check-isolation.mjs freeze G1 source, manifest, lock,
compiler config/toolchain and ABI, normalize only CRLF for Windows checkouts,
reject extra src entries/build.rs and compiler/target environment overrides.
This runs in normal CI before contract validation. A deliberate future change
to the freeze manifest still requires review; it never updates artifact approval.
The existing independent full byte-hash/size/code-hash/ABI gate remains mandatory.

Instant exact deposit, original recipient, private callback, nonce/replay rules,
reserve-before-transfer accounting and retry behavior are inherited unchanged.
A successful transfer with a failed callback still remains PAYOUT_IN_FLIGHT and
cannot be retried; there is no timeout/admin reset. Protected Pay stays disabled.
Candidate preflight still refuses pilot reuse and returns deploymentApproved:false.

## Local validation actually executed

Node v24.22.2, pnpm 11.5.0:

| Check | Observed result |
| --- | --- |
| pnpm install --frozen-lockfile --offline | pass; cached packages, unchanged lockfile |
| pnpm check | pass: brand/build/types/lint; shared 92, near-client 207, web 856 passed / 1 skipped |
| API tsc and ESLint commands below | pass |
| node --test apps/api/test/*.test.mts | 67 passed, 1 skipped, 0 failed |
| pnpm --filter @taply/web exec next build --webpack | pass |
| node contracts/payments/scripts/check-isolation.mjs | pass |
| node --test contracts/payments/test/isolation.test.mjs | 4 passed |
| node --test contracts/payments/test/*.test.mjs | 6 passed, using downloaded diagnostic candidate WASM for preflight tests |
| node --test contracts/payments-merchant/test/*.test.mjs | 2 passed, same downloaded bytes, not a relocated build |
| Candidate check-exports.mjs | 12 exports, downloaded diagnostic candidate only |
| bash -n on all shell scripts in both contexts | pass, Git Bash |
| Git blob and candidate preservation comparisons | pass as detailed above |
| git diff --check | pass |

The routing regression uses stub Cargo in disposable directories. It verifies
output separation, legacy forwarding, fault-artifact restoration and target
redirect rejection. It does not compile Rust or execute a blockchain.

Rust/cargo/rustfmt/clippy are absent from PowerShell and Git Bash PATH. Docker
CLI exists but its Linux engine pipe is unavailable. WSL lists only
docker-desktop, not a general Linux toolchain. Consequently cargo fmt, cargo test,
cargo clippy, fresh WASM builds, sandbox execution and fresh sandbox wire checks
were NOT run locally. Two attempted YAML-parser lookups were unavailable in the
workspace dependencies; no parsed-workflow validation is claimed. Workflow
structure was reviewed locally; GitHub acceptance remains required.

## Exact normal CI acceptance (remaining gate, not executed here)

After separate human authorization to publish this branch, run the existing
`instant-pay-sandbox` workflow against its exact reviewed commit. The PR path
filter now includes both contract contexts. Manual dispatch is also retained;
no new push branch or diagnostic trigger was introduced. Record the actual run
URL, head SHA and logs. Require BOTH validate and merchant-candidate jobs green.
Do not use the old diagnostic success to mark this branch CI-approved.

Normal runner is ubuntu-24.04, Rust 1.95.0, Node 24.22.2, pnpm 11.5.0. It is a
rolling hosted image, not the diagnostic's exact image assertion; record the
assigned image and fail on any G1 byte mismatch. Never update pins to pass.

The normal workflow executes these relevant commands in the indicated cwd:

```sh
# repository root
pnpm install --frozen-lockfile
pnpm --filter @taply/shared build
pnpm --filter @taply/near-client build
node contracts/payments/scripts/check-isolation.mjs
node --test contracts/payments/test/isolation.test.mjs

# contracts/payments
cargo fmt --all --check
cargo fmt --manifest-path sandbox/Cargo.toml --all --check
cargo test --locked --lib -- --test-threads=1 --color never # exactly 15 pass
cargo clippy --locked --all-targets -- -D warnings
bash scripts/build.sh
node scripts/check-exports.mjs
node ../../apps/web/scripts/deploy-preflight.mjs wasm artifacts/payments.wasm
cargo clippy --manifest-path sandbox/Cargo.toml --locked --all-targets -- -D warnings
bash scripts/sandbox.sh # exactly 10 pass, sequential; corrected old CI count of 9
node scripts/check-wire.mjs

# contracts/payments-merchant (separate CI job, own targets and outputs)
bash scripts/check.sh
# check.sh: both fmt checks; default unit tests; merchant-feature unit tests;
# merchant clippy; candidate/fault builds; sandbox clippy; ten sandbox tests.
# Required merchant unit count: 19 passed / 0 failed.
node scripts/check-exports.mjs
node --test test/*.test.mjs
node scripts/check-wire.mjs
```

Require fresh G1 345541 bytes, SHA-256
`a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2`,
code hash `BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`, exactly the existing
12 ABI exports, all unit/sandbox cases, and wire-schema state coverage.
Require candidate tests to use its newly built candidate and fault artifacts.
Its relocated build hash may differ from the old-path diagnostic; measure it,
label it UNAPPROVED, and never insert it into a G1/deployment pin.
Only the G1 job can upload instant-pay-approved-wasm after its entire suite passes.

Also run the existing workspace-check workflow on the same reviewed tree:

```sh
pnpm check
node packages/shared/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json
node apps/web/node_modules/eslint/bin/eslint.js --config apps/api/eslint.config.mjs apps/api/src apps/api/test
node --test apps/api/test/*.test.mts
pnpm --filter @taply/web exec next build --webpack
```

Remaining gates: lead review of source/layout/CI changes; fresh normal CI for
this exact branch (including Rust formatting and all sandbox behavior); any
future G2 candidate review, hash/config approval and separate deployment
permission. No deployment or signing is necessary to accept this isolation PR.
This work grants none of those future permissions.
