# Release readiness

> **Archived status report.** This file records what was true on the date in its
> title or sections and is kept unchanged as history. It is not the current status.
> Current status (2026-11-11): payments are signed on taplyapp.xyz, the live two-phone
> Handshake and Protected Pay (Testnet escrow, not audited) are on. Authoritative:
> [README](../README.md) and [VERIFICATION_MATRIX.md](VERIFICATION_MATRIX.md).

## Current state — 2026-11-09

- **Public read-only release is live** at https://taplyapp.xyz (Vercel
  production, branch `release/taplyapp`). Payment signing, merchant signing,
  Handshake and Protected Pay are off on the public site.
- Exact deployment IDs, Git revisions, CI runs, browser results, rollback steps
  and open items: [NIGHTLY_RELEASE_REPORT_2026-11-09.md](NIGHTLY_RELEASE_REPORT_2026-11-09.md).
- Public Testnet signing requires the acceptance gate in
  [TESTNET_ACCEPTANCE_PLAN.md](TESTNET_ACCEPTANCE_PLAN.md) (fresh owner-signed
  G1 run on the protected QA build). It has not run yet.

The 2026-11-06 report below is kept unchanged as the historical record of the
release-candidate review.

---

## Final release candidate readiness — 2026-11-06

**Prepared for review and a read-only judge demo; not approved for release or submission.**
G1 Instant Pay has historical live Testnet proof and passing normal contract CI.
Physical iPhone payment acceptance is still pending. G2 candidate CI passed,
but G2 is unapproved, undeployed and disabled; live Handshake is NO-GO.
Protected Pay remains disabled. No new chain observation or payment is claimed.

## Provenance and scope

Prepared on DESKTOP-SDAI72B in `C:\taply-release-candidate`, branch
`feature/release-candidate`, from exact approved clean G1 isolation HEAD
`2199fab57ace177b60cdfe70e2c72672eefd9cfe`. Source tree:
`84fa725983a08869c34e5b9d20073458b5efd17b`.
Clean release-prep `6b6187c` was reviewed and its 13 documentation files
selectively copied, then updated. Its obsolete contract-CI blocker narrative
was replaced, not imported as current fact. No branch merge or cherry-pick.
The final report-bearing commit is identified by `git rev-parse HEAD`.

Only README/docs are changed. Contract logic, approved pins, dependencies,
lockfiles, web source and gates are unchanged. PR #8 diagnostic workflow is
absent. At the preparation stage, no push or PR had been performed; the
release-candidate documentation was subsequently published in PR #10 at
`7443c01161fa412943140d8e52ad1de9f56ff97e`. This historical report does not
claim that published source is still local-only. The later local cumulative
safety assessment is [FINAL_INTEGRATION_REVIEW.md](FINAL_INTEGRATION_REVIEW.md).
No merge, deployment, signing, funds movement, G2 activation, LICENSE addition
or submission is authorized by either report.

## Normal contract CI: observed evidence

[Run 42229980978](https://github.com/KendineCrypto/taply/actions/runs/42229980978)
is successful for PR #9 head `2199fab57ace177b60cdfe70e2c72672eefd9cfe`.
Both job metadata and decoded logs were inspected read-only on 2026-11-06.
GitHub checked out its synthetic PR merge commit
`2752b20f07bf2a23a0c632216997ee0f0bfe3b12`, merging that head into
`352a7cfd9efeda314634a81905f459b290f947ec`. Do not describe this as a
local Rust run or CI on this later documentation commit.

| Job / scope | Observed result |
| --- | --- |
| G1 job 127933107049 | PASS: source isolation, both fmt checks, 15 unit tests, contract/sandbox Clippy, WASM build, unchanged approved preflight, 10 sandbox tests, wire schemas, production artifact upload |
| G2 job 127933106740 | PASS: fmt, 15 default + 19 merchant-feature unit tests, Clippy, isolated candidate/fault WASM, 10 sandbox tests, export/wire checks and offline candidate preflight |
| G1 WASM | 345541 bytes; SHA-256 `a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2`; NEAR hash `BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`; unchanged 12 ABI exports |

Listed artifacts (all unexpired when inspected):

- `instant-pay-approved-wasm`, ID 13507114182; archive digest
  `ddf165041e0f4fbaec6dd1d2fcb0f4b8c51fca36ec31d1bbe19565af7dafcc03`.
- `instant-pay-validation-logs`, ID 13507726985; archive digest
  `ffb57181c3e034a1c7f447ed1dbfd1b58f4ce30063b296999c92e5fc6406678d`.
- `UNAPPROVED-merchant-candidate-validation-logs`, ID 13507368537; archive digest
  `55bca0dad6052aa7e97ed828525ca3fe007fd358451d0d97d5dec9f5d3bbf0eb`.

Retention expires around 2026-11-20 14:01–14:05 UTC. Archive digests above are
ZIP artifact digests, not WASM hashes. Candidate upload contains logs, hash and
read records only, not deployment WASM. Preserve evidence before expiry.
Old #3/#6 contract failures describe the pre-isolation tree and remain historical;
#9 resolves the source-drift/hash and sandbox gate on the isolated tree without
changing approved pins. It does not authorize G2 or establish live G2 acceptance.

## Local checks on the candidate

Node 24.22.2 / pnpm 11.5.0. No env file or signing overrides added.
Local output logs: host temporary directory `taply-rc-workspace.log`,
`taply-rc-api.log`, `taply-rc-webpack.log`; these are not public evidence.

| Command | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS exit 0; 336 reused, zero downloaded; lockfile unchanged |
| `pnpm check` | PASS exit 0: brand, default production build, strict types, lint, tests |
| Workspace tests | 92 shared + 207 near-client + 856 web = 1,155 passed; 1 opt-in live test skipped |
| `node packages/shared/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json` | PASS exit 0 |
| `node apps/web/node_modules/eslint/bin/eslint.js --config apps/api/eslint.config.mjs apps/api/src apps/api/test` | PASS exit 0 |
| `node --test apps/api/test/*.test.mts` | PASS exit 0; 67 passed, 1 Windows/POSIX-permissions skip |
| `node apps/web/node_modules/typescript/bin/tsc -p packages/near-client/verification-tests/tsconfig.json` | PASS exit 0 |
| `node apps/web/node_modules/vitest/vitest.mjs run --config packages/near-client/verification-tests/vitest.config.mts` | PASS exit 0; 13 passed |
| `node contracts/payments/scripts/check-isolation.mjs` | PASS exit 0; frozen source/config/lock/ABI intact |
| `node --test contracts/payments/test/isolation.test.mjs contracts/payments/test/file-url.test.mjs` | PASS exit 0; 5 passed; routing uses stub Cargo, not WASM execution |
| `pnpm --filter @taply/web exec next build --webpack` | PASS exit 0 |

Unique executed local tests: **1,240 passed, 2 intentional skips**. jsdom
navigation/media/scroll warnings did not fail suites. Rust/cargo/rustup remain
unavailable locally; no install, local Rust/WASM/sandbox run or local fresh
merchant-artifact preflight is claimed. Those checks passed in normal CI above.
Do not copy diagnostic WASM into this candidate to make a local test green.

## Feature and security consistency

- Live G1: `taply-pay-pilot-1.testnet`, native Testnet NEAR only. Historical
  funding tx `CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su` and complete receipt
  references are in [EVIDENCE.md](EVIDENCE.md). Phase 7H reverified the existing
  payment at 2026-11-06T09:24:42.194Z. This task did not reverify chain state.
- Phase 7I retains mandatory signing review, simplified EN/TR copy, accessible
  Details and neutral clocks for Paid per contract. Verified Paid still requires
  independent successful funding/transfer/callback, code/key and finality proof.
- G1 source is frozen in `contracts/payments`; unapproved G2 is independently
  built in `contracts/payments-merchant`. Passing candidate tests do not approve
  authentication, rollout, deployment hash, wallet behavior or merchant binding.
- `.env.example` keeps Instant, Protected, Handshake and merchant flags off.
  `apps/api/src/service.mts` still sets `authenticationAccepted:false`.
- G2 production freshness/rollback authority, wallet NEP-413 acceptance, secure
  hosting/cookie/ACL/recovery behavior and live two-device acceptance remain open.
- Configured RPC trust is not a light client; retained contract FullAccess key
  is an upgrade/trust risk. Unknown RPC results cannot establish payment success
  or authorize automatic retry. Callback failure can leave principal reserved
  pending reconciliation; no timeout/admin reset is claimed.
- Protected/FT/sponsorship/embedded wallets/recurring debit are not shipped.
  Product/API/architecture and old phase reports are marked historical targets.

## PR audit and precise proposed merge path

GitHub inspection: all four PRs open, draft, unmerged, `mergeable:true`, with
no submitted reviews returned. Mergeability is neither security approval nor
required-check acceptance. Local ancestry confirms the full stack below.

| PR | Head → current base | Scope and review risk |
| --- | --- | --- |
| [#3](https://github.com/KendineCrypto/taply/pull/3) | `f3d15ac` → `feature/phase7-integration` at `5999d0c` | Core/UX integration, 96 changed files; contains #1/#2 histories. G2 auth/freshness and contract gates in its old body are not acceptance. |
| [#6](https://github.com/KendineCrypto/taply/pull/6) | `6a485a2` → `feature/phase7g-integration` at `f3d15ac` | 71 files, includes #4/#5; stricter room reducer and verifier HTTP-history hardening. Its failed hash gate is fixed only by later #9. |
| [#7](https://github.com/KendineCrypto/taply/pull/7) | `352a7cf` → `feature/phase7h-integration` at `6a485a2` | 93 files, copy/disclosure and final neutral-clock polish. Signing terms remain visible; screenshots predate final polish. |
| [#9](https://github.com/KendineCrypto/taply/pull/9) | `2199fab` → `feature/phase7i-ux` at `352a7cf` | 44 files, source freeze and separate G2 workspace/CI. Both normal jobs now pass; approve isolation without approving G2 deployment. |

This is a release/ancestry/CI audit, not a fresh independent contract security
audit. Local `main` at `86bd54b` is an ancestor of the candidate, but outdated.
The latest remote main and branch-protection policy must be re-read by maintainer
before integration. No existing PR targets main. No changes were made to them.

**Recommended future path, after human review only:**

1. Review #3/#6/#7/#9 as one cumulative implementation; include #1/#2 and #4/#5
   through their existing integration histories. Approve the exact heads and
   this docs-only candidate commit. Do not merge old failing intermediate trees
   into main or bypass their failed required checks.
2. Prefer a new final integration-to-main review whose head is this candidate
   (after any separately approved fixes/license), containing the entire ancestry
   `5999d0c → f3d15ac → 6a485a2 → 352a7cf → 2199fab → candidate docs`.
   This avoids replaying the same code or publishing a broken intermediate tree.
   Re-read remote main first; resolve any new divergence only on a new isolated
   integration branch, preserving existing branches. No rebase of this stack.
3. Run full workspace/API/verifier/Webpack and both normal contract jobs on the
   exact proposed main merge result, plus wallet/browser checks where required.
   Confirm source freeze, approved pins, G2/auth flags, diff and license review.
   Do not infer success from path-filter-skipped checks or earlier head results.
4. Only after acceptance and explicit merge authorization use a history-preserving
   merge to main. Afterwards close superseded stack/component PRs with ancestry
   references rather than replaying/squashing them separately. Publication,
   closing PRs, merging and tags are future human-authorized actions.

If maintainer instead requires individual stack integration, preserve history:
#9 into `feature/phase7i-ux`, then updated #7 into `feature/phase7h-integration`,
then updated #6 into `feature/phase7g-integration`, then updated #3 into
`feature/phase7-integration`; add the candidate docs once and review the final
integration-to-main diff. This carries the isolation fix into each downstream
merge. Every changed PR head needs new checks/review; none is authorized here.

Expected conflicts: no overlapping implementation in this docs-only delta;
release-prep README/status hunks must not overwrite current CI facts. Future
main divergence, squashing ancestors, selectively replaying source restores,
legacy candidate paths and cached build outputs can invalidate ancestry or
reintroduce the wrong WASM. Highest regression risks are verified/unverified
status distinctions, unknown RPC retries, mandatory signing disclosures and
accidental auth/G2 gate enablement. Never import PR #8's diagnostic workflow.

## Judge evidence and submission gates

Use [JUDGE_QUICK_START.md](JUDGE_QUICK_START.md), [RELEASE_DEMO.md](RELEASE_DEMO.md)
and [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md). No wallet/funds are
needed for the prepared demo. Public hosted demo/video/X post are not claimed.

Current public checks: exact-base Phase 7I home PNG and archived receipt JSON
returned HTTP 200; official HACKATHON.md returned 200. Nearblocks contract and
funding links returned HTTP 403 to automated requests, so human-browser
accessibility is unverified, not declared broken. Test before recording.
Committed screenshots are historical/synthetic; the inspected contract-paid
fixture visibly says DEMO and still has the pre-polish checkmark. Refresh
final screenshot/video evidence before presenting it as final-build UI.

Release remains stopped at the known human gates: physical iPhone acceptance
(and Android untested), license/attribution approval, final reviewed/public
commit, demo video/X publication and submission consent. No unconditional
release recommendation. Current rules allow Testnet and local-only demos with
public repo plus video; deadline 2026-11-14 23:59 UTC. Recheck on submission day.
[License/attribution recommendation](LICENSE_RECOMMENDATION.md) requires owner
approval; no LICENSE was added. Next action: review this local commit, authorize
and record physical-device acceptance separately, then decide license/media and
the cumulative main integration review. No payment is authorized by this report.

## Final documentation and production smoke audit

- All 74 relative Markdown file/directory targets in changed documents resolve.
  Fragments were stripped; this is not a complete heading-anchor parser.
- All 95 Phase 7H/7I PNG signatures and nonzero dimensions passed; four QA JSON
  files and the archived receipt JSON parse. One contract-paid fixture was
  visually inspected. No fresh full browser/device screenshot matrix is claimed.
- Production Webpack server at loopback port 3219 returned HTTP 200 with DEMO
  markers for `/demo` and `/demo/handshake`; server stopped after inspection.
  This is route-serving smoke coverage, not wallet/browser interaction acceptance.
- `git diff --check` passed. Exact G1 and release-prep source worktrees stayed
  clean; main stayed `86bd54b981e0e4d8e8ff09d81bb888b370740baa`.
- Diff against approved base is README/docs only; apps, contracts, packages,
  workflows, root manifest and lockfile are identical. No LICENSE was added.
- Public URL checks are representative probes listed above, not a guarantee of
  every external site's availability. Final public judged links and video must
  be checked again after separately approved publication.
