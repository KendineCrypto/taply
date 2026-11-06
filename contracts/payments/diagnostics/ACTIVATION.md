# G1 branch-only diagnostic activation plan

Prepared locally on DESKTOP-SDAI72B, 2026-11-06. No push, workflow dispatch,
deployment, signing, funds movement, merge, tag or G2 activation was performed.

## Reviewed starting state

Clean branch feature/g1-wasm-repro at
bd8a40b6dcd9864dc5bd61f0ac0d6e3337b22845; remote branch independently observed at
the same SHA. Existing diagnostic scripts and inactive template were reviewed
and are unchanged. The only preparation changes are the new active-path
.github/workflows/g1-wasm-repro.yml and this note. The workflow is locally
present but cannot execute on GitHub until a separately authorized push.

## Why no default-branch change is needed

GitHub documents that push workflows can run before being merged into the
default branch, and that branch and path filters must both match:
https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push

There is no workflow_dispatch, PR, pull_request_target, schedule, tag or
workflow_run trigger in the new workflow. No main or source-branch modification
is required. The old .yml.disabled template remains an inactive historical draft;
it is not the activation path.

## Exact future activation

After explicit authorization of the resulting local commit:
1. Verify HEAD equals the reviewed preparation commit and the tree is clean.
2. Read origin's feature/g1-wasm-repro SHA; it must still be exactly bd8a40b... .
3. Normal, non-force push ONLY
   refs/heads/feature/g1-wasm-repro:refs/heads/feature/g1-wasm-repro,
   with tag following disabled. Do not push other refs.
4. That push adds the workflow itself, satisfying its path filter. The job
   requires repository KendineCrypto/taply, event push, exact diagnostic branch,
   before=bd8a40b6dcd9864dc5bd61f0ac0d6e3337b22845, and neither deletion nor force.
5. Only these exact paths match:
   - .github/workflows/g1-wasm-repro.yml
   - contracts/payments/diagnostics/rebuild.mjs
   - contracts/payments/diagnostics/measure.mjs
   - contracts/payments/diagnostics/measure.test.mjs

A README/report-only change does not ordinarily match. No glob or broad PR
trigger is added. Existing repository validation may run independently when
the already-open PR is updated; it is unchanged.

A later matching push can schedule the workflow but its job is skipped because
the previous SHA no longer equals bd8a40b... . If the remote has advanced before
activation, STOP: do not reset/force it or silently change the guard. Manual
reruns of an existing run remain possible to authorized GitHub users and require
separate approval; this is not a repository-wide prohibition on reruns.

## Runner finding and fail-closed behavior

Official release:
https://github.com/actions/runner-images/releases/tag/ubuntu24/20261101.360

Read-only GitHub REST release metadata observed:
- tag_name: ubuntu24/20261101.360
- published_at: 2026-11-02T13:32:48Z
- prerelease: false
- body Image Version: 20261101.360.1

The web page also reports this image version (its cached prerelease badge
differs from the REST status). This establishes a published image, not a promise
that every future ubuntu-24.04 allocation will use it. The prior audit also
observed this version in actual failed Taply CI logs.

EXPECTED_IMAGE_VERSION is the literal 20261101.360.1. The first step checks
ImageVersion before checkout/setup/install; rebuild.mjs independently checks it
again. A missing or different value fails. No fallback, range or automatic
version update is allowed. If rollout changes, review fresh official release
evidence and obtain approval for a new guarded run; do not remove the check.

## Preserved build and safety boundaries

The six variants and two repetitions remain unchanged: historical 258f138...,
parent 5999d0c..., introduction ca363b0..., current 352a7cf... default, current
with historical lib.rs/model.rs/tests.rs/Cargo.toml in disposable build context,
and untouched current compiled with merchant-bound-v1.

All builds share one runner, paths and pinned Rust 1.95.0; the script checks full
compiler commit 59807616e1fa2540724bfbac14d7976d7e4a3860. Locked dependencies,
release/target flags, fresh target and registry/git caches, repeat comparison,
ABI export checking and unchanged preflight remain intact. G2 is compiled as
diagnostic evidence only.

Permissions remain contents: read; checkout persist-credentials is false.
No repository-secret inputs, wallet-key access, signing/deployment tools,
write credentials, protected-branch mutation or production artifact changes
are introduced. Cargo's temporary compiler output stays in the isolated build
context; every retained/uploaded binary is UNAPPROVED-payments.wasm beneath
UNAPPROVED-diagnostics. The upload name is UNAPPROVED-g1-repro-<run_id>,
never instant-pay-approved-wasm. Production gates, ABI and pins are unchanged.

## Local validation

No software installed.
- Existing yaml 1.10.2 from the installed @expo/ngrok dependency parsed YAML 1.2
  with unique keys enabled: no errors/warnings.
- Assertions verified exact event/branch/path allowlist, read-only permissions,
  pinned actions, no persisted credentials, fixed image, only one job, build
  command/path, UNAPPROVED upload name/path, and no secret/write trigger additions.
- Job expression: positive case and eight rejection cases passed (wrong repo,
  PR event, main, source branch, tag, wrong previous SHA, deletion, force push).
  This exercises the simple boolean expression locally; it is not GitHub execution.
- Existing Git Bash checked all run blocks with bash -n; isolated image guard
  passed matching version and rejected absent/different versions.
- JavaScript syntax checks and four existing tests passed.
- Staged diff whitespace check passed; Gitleaks 8.30.1 found no leaks in the staged diff.
- actionlint was not installed/found; no actionlint or GitHub execution result
  is claimed. Full builds remain unproven because local Rust is unavailable.

## Deactivation after the authorized run

After evidence has been collected, prepare a separate reviewed commit deleting
.github/workflows/g1-wasm-repro.yml on this diagnostic branch, and obtain approval
to push that removal. Keep the scripts, reports and .yml.disabled template for
review. Do not merge the active workflow into main or feature/phase7i-ux.
The before-SHA guard already prevents a later ordinary branch update from
executing the build; removal eliminates its future push trigger entirely.
Removing a workflow does not cancel an already-running job; any cancellation
would be a separate explicit action. No deactivation push is authorized here.
