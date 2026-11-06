# G1 WASM reproducibility investigation — 2026-11-06

## Outcome

**Diagnosis and inactive diagnostic prepared; approved WASM reproducibility is
NOT proven and production remediation is NOT applied.** Rust is unavailable
on this PC. No hash was forced to match. The existing failing artifact gate is
unchanged. This is a local investigation commit, not a release or G1 CI fix.

Host observed: DESKTOP-SDAI72B, Windows, Node v24.22.2; no Codex Cloud.
Source C:\taply-phase7i-ux was clean at required
352a7cfd9efeda314634a81905f459b290f947ec. Isolated worktree
C:\taply-g1-wasm-repro, branch feature/g1-wasm-repro, starts at that exact SHA.

Read the mandatory repository context and
C:\taply-ci-audit\docs\WASM_CI_AUDIT.md in full.
Audit file SHA-256:
26b0ba2d4bb6b74ca2d8a48cd95cd5779c338a9bd1ca895cb9a3def16a7a3488.
CI and chain observations below are attributed to that prior audit; no new
remote CI or RPC calls were made during this investigation.

## Exact changes

Only new files:
- This report.
- contracts/payments/diagnostics/g1-wasm-repro.yml.disabled: inactive,
  manual-only GitHub Actions draft, outside .github/workflows.
- contracts/payments/diagnostics/rebuild.mjs: controlled sequential paired builds.
- contracts/payments/diagnostics/measure.mjs: SHA-256, base58 NEAR code hash,
  byte length, actual WASM exports and documented ABI digest.
- contracts/payments/diagnostics/measure.test.mjs: malformed WASM/ABI and
  ABI mismatch rejection tests.
- contracts/payments/diagnostics/historical-artifact-local-check.json:
  actual local measurement of the previously downloaded historical binary.

No contract source, Cargo manifest/lock, build script, ABI, deployment pin,
preflight, active workflow, shared schema, root package or apps/web file changed.
No G2 code was deleted or relocated. Its source, tests, feature, scripts and
history remain intact. No binaries are committed.

## Source evidence and likely root cause

Local git comparison independently confirms that ca363b0e861fb055985762c49186d2fad1f61413
is the only intervening commit modifying production lib.rs, model.rs or
Cargo.toml between historical 258f138110760f726c7e090e807015332f513b19 and the
required source SHA. Its parent 5999d0c2bee67839e1ba55546b0021b22f2d0ce4
has identical compared production sources and build inputs to historical success.

All changed default-build surfaces in these files:

| Surface | Default-build effect / uncertainty |
| --- | --- |
| lib.rs get_config contractVersion | Literal replaced by cfg!-selected expression; both branches enter compilation before optimization. Intended default value remains 0.4.0. |
| lib.rs get_config handshake | Literal false replaced by cfg! result. Intended value remains false. |
| model.rs Record::view | Literal JSON null becomes serialized Option<String>::None. Same intended wire value, different source/code-generation input. |
| lib.rs storage_bytes | Direct return expression becomes local binding plus feature-gated shadow and final return. Same intended default arithmetic. |
| lib.rs module, quote/create checks, sale storage block | Merchant code is cfg-excluded by default, but inserted lines shift subsequent source spans, including panic/unwrap sites. |
| model.rs validation and view additions | Default HANDSHAKE_DISABLED check remains; new cfg attributes and excluded branches shift source spans. |
| Cargo.toml feature declaration | Adds an opt-in feature without changing dependencies/profile/defaults; still a different manifest/check-cfg input. Do not assume byte-neutral without measurement. |

merchant.rs is absent from the default module graph. Its binding validation,
creator-scoped sale tombstone and replay checks are G2-only. The additional
tests.rs content is behind the existing cfg(test) module and cannot enter a
normal production library build. Sandbox tests, merchant ABI and merchant build
script are separate inputs, not selected by the existing default build script.
There is no build.rs or new production dependency in the compared change.

The Rust documentation distinguishes cfg! predicate evaluation from cfg
attribute exclusion; panic locations include file/line/column. These explain
plausible sources of byte drift, not the exact 118-byte difference:
https://doc.rust-lang.org/reference/conditional-compilation.html
https://doc.rust-lang.org/std/panic/struct.Location.html

## Source drift versus environment drift

The prior audit reports:

| Observation | Historical successful CI | Current failing CI |
| --- | --- | --- |
| Run | 41306770019 | 42196463756 |
| Head SHA | 258f138110760f726c7e090e807015332f513b19 | 6a485a251f38271fa9f95567e601a71c2b0ae70b |
| SHA-256 | a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2 | 6ec143af225de49011955b4343f115f161442e71e64f912d9cb39724bfabdd2a |
| Code hash | BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B | 8TLmhqi9eVN6Cwy5T8S1RBqw8gNzwgnhUUP71W9Lx3J1 |
| Bytes | 345541 | 345659 |
| ABI method exports | 12, pass | 12, pass |
| Runner image | 20261025.353.1 | 20261101.360.1 |

The failed PR's tested merge checkout was 592ebdb5fd2a59ebb545a93e960743f18d7011e6;
the audit found zero file differences from its head. Earlier failing run
42170985311 yielded the same changed digest and size.

Local git diff independently confirms unchanged contract Cargo.lock,
rust-toolchain.toml, .cargo/config.toml, build.sh, abi.json, active sandbox
workflow and deploy-preflight.mjs between historical success and required HEAD.
The audit records identical Rust 1.95.0 compiler commit
59807616e1fa2540724bfbac14d7976d7e4a3860, LLVM 22.1.2, Cargo 1.95.0,
same compilation directory and cache misses. This supports source drift as the
leading explanation and does not support stale restored targets. The runner
image changed, so source causality and its precise mechanism remain unproven.

## Smallest source-isolation proposal (NOT applied)

First test exact historical lib.rs, model.rs and Cargo.toml bytes at their
original paths, with current surrounding source. Restore historical tests.rs
in that diagnostic variant too: removing the merchant feature declaration while
retaining candidate test cfgs would otherwise introduce unexpected-cfg lint
risk. Do not rewrite literals, pad source lines, strip WASM, change optimizer
flags or update pins merely to obtain the expected hash.

The draft makes those four restorations ONLY in a disposable build directory.
It separately builds the untouched current merchant candidate. It never alters
the harness checkout or substitutes a prebuilt artifact.

If this reproduces the approved bytes twice and passes full validation, the
smallest durable isolation is a frozen G1 crate at contracts/payments with exact
historical production source paths and a separate G2 crate/build context
preserving the current candidate source, tests, manifest, lock, ABI and scripts.
Before restoring G1 in the repository, copy the complete candidate into that
separate context and document its origin at 352a7cf / introduction ca363b0.
Update candidate-only build/test commands explicitly; do not leave a feature
flag that silently builds G1 when G2 is requested. That packaging change needs
candidate runtime/preflight validation. It is deliberately deferred until the
binary experiment establishes whether source isolation is sufficient.

G2 is currently preserved unchanged in this branch and in its original Git
history; no candidate capability has been activated.

## Prepared controlled diagnostic

The inactive draft:
1. Uses checkout/setup-node/upload-artifact commit pins already in this repo,
   read-only contents permission, no persisted checkout credentials, no secrets,
   no chain calls and no automatic event.
2. Requires a reviewed exact ImageVersion input, enforces equality before
   installation, pins Rust 1.95.0 and checks its full compiler commit.
   ubuntu-24.04 alone is NOT an immutable image pin. GitHub cannot be assumed
   to schedule an old image on demand; this draft fails if the requested image
   is unavailable. Choose/approve an available image first, or separately
   provision a reviewed immutable runner. Do not remove the guard.
3. Runs all variants sequentially in one job on the SAME VM. Each uses the same
   GITHUB_WORKSPACE/contracts/payments path and /home/runner/.cargo path.
   The harness checkout lives separately at GITHUB_WORKSPACE/harness.
4. Removes only its fixed scratch crate and Cargo registry/git cache directories
   between builds; each target starts empty. No cache action, incremental build,
   rustc wrapper or global Cargo config is accepted.
5. Builds historical, parent, introduction, current-default, proposed-isolation
   and current G2 merchant feature, each twice, locked, release, wasm32 target.
6. Saves UNAPPROVED WASM, SHA-256, code hash, size, actual exports, ABI file/hash,
   source blob IDs/restoration provenance, feature, repeat, build stdout/stderr,
   preflight output, and shared environment.json with OS/image/compiler/path
   information. Every artifact belongs to the UNAPPROVED output bundle.
7. Runs the unchanged current preflight on every output and records its exit.
   Current drift and G2 mismatches are diagnostic observations, never approval.
   Historical/parent/proposed preflight failure, any ABI mismatch or nonidentical
   repeats fails the diagnostic after collecting measurements. Compile failures
   stop early and preserve already collected evidence.
8. Never deploys, signs, changes pins or uploads to the approved artifact name.
   It is NOT a substitute for normal CI, callback-fault, unit, Clippy, sandbox
   or wire-schema gates.

This paired experiment controls one present runner image. It does not by itself
reproduce both historical images. A historical-source mismatch requires checking
full environment/path/toolchain provenance before blaming source. Default WASM
export equality checks names only, not argument or settlement semantics.

GitHub runner-label reference:
https://docs.github.com/en/actions/reference/runners/github-hosted-runners

Publishing the workflow, pushing this branch, and dispatching any CI require
separate authorization. No such operation was performed.

## Actual local checks

| Command/check | Observed outcome |
| --- | --- |
| hostname / source rev-parse / status | DESKTOP-SDAI72B; exact required SHA; source clean |
| git worktree add -b feature/g1-wasm-repro C:\taply-g1-wasm-repro 352a7cfd9efeda314634a81905f459b290f947ec | Exit 0 |
| git log / diff comparisons described above | Only ca363b0 changes compared production inputs; historical-parent comparison exit 0; unchanged build/pin input comparison exit 0 |
| node --check diagnostics/measure.mjs and rebuild.mjs (under contracts/payments) | Exit 0 |
| node --test contracts/payments/diagnostics/measure.test.mjs contracts/payments/test/file-url.test.mjs | Exit 0; 4 passed, 0 failed |
| Initial restricted file-url test invocation | spawn EPERM; rerun with local subprocess permission passed, no test alteration |
| node contracts/payments/diagnostics/rebuild.mjs on Windows | Expected exit 1 before mutation: refuses non-diagnostic Linux CI context |
| measure.mjs against retained historical binary | Observed approved SHA/code hash, 345541 bytes, exactly matching 12 function exports; JSON committed |
| node apps/web/scripts/deploy-preflight.mjs wasm <historical temp binary> | Exit 0, 5/5 unchanged checks pass |
| git diff --check | Exit 0 |
| Get-Command cargo,rustc,rustup | None found on PATH |
| docker info --format '{{.OSType}}' | Exit 1; Linux engine pipe unavailable |
| wsl --list --quiet | Restricted attempt access denied; host-permitted retry exit 0, only docker-desktop |
| python -c "import yaml" | Exit 1, PyYAML not installed; no local YAML/actionlint semantic validation claimed |

Historical binary checked at
%TEMP%\taply-wasm-ci-audit\approved\payments.wasm; it was downloaded by the
previous audit, not built here. Local check JSON is labelled UNAPPROVED because
it is diagnostic evidence, not a new approval. Its digest matching approved
pins does not prove that today's sources rebuild to those bytes.

cargo fmt/test/clippy/build, callback-fault build, sandbox and wire-schema runs
were NOT executed: no runnable Rust/Linux build environment is available.
No dependencies or toolchains were installed. No application production code
changed, so broad UI/API test suites were not rerun. Merchant artifact-dependent
tests require an actual candidate WASM and prerequisites; none exists in this
fresh worktree. The diagnostic workflow has not been executed, and its full
GitHub execution and workflow validation remain blocked.

## Safe next steps and decision criteria

1. Review the inactive draft (including actionlint/workflow parsing) and approve
   an exact runner image plus publication/dispatch separately.
2. Run paired clean builds. Require historical and parent to reproduce approved
   pins first. If both reproduce, current/introduction drift, and the restoration
   reproduces, source-level causality and the isolation strategy are supported.
   Diff resulting WASM code/data/custom sections to identify the remaining
   mechanism; do not infer it solely from byte length.
3. If historical does not reproduce, stop source remediation and investigate the
   environment, including compiler distribution, registry source paths, runner
   image and generated metadata. Never replace the approved hash.
4. Only after that evidence, preserve G2 in a separate reviewed crate/context and
   apply the proven minimal G1 restoration. Run default fmt, 15 unit tests,
   Clippy, production plus callback-fault builds, unchanged preflight, full
   nine-test sandbox and wire-schema validation; separately run merchant unit,
   Clippy, preflight and runtime/security tests.
5. Require the normal approved-artifact workflow to be green with unchanged pins
   before claiming restored reproducibility. A diagnostic green result is
   insufficient for deployment or feature activation.

No push, merge, deployment, signing, payment, feature activation or deployed
Testnet modification occurred. The prior audit's deployed-byte match is not
reasserted as a new chain observation. The exact 118-byte cause and successful
G1 rebuild remain blocked verification, not completed deliverables.
