# Final integration safety review — 2026-11-06

> **Archived status report.** This file records what was true on the date in its
> title or sections and is kept unchanged as history. It is not the current status.
> Current status (2026-11-11): payments are signed on taplyapp.xyz, the live two-phone
> Handshake and Protected Pay (Testnet escrow, not audited) are on. Authoritative:
> [README](../README.md) and [VERIFICATION_MATRIX.md](VERIFICATION_MATRIX.md).

**Recommendation: NO-GO for an all-checks-passed publication recommendation, signing, merge or release.** The cumulative inventory and risk-based assessment cover all **704 inherited changed paths**. The confirmed HIGH signing-boundary defect F-01 is **fixed locally** (commits `9db43fb`, `24cf04a`, see F-01 below) and awaits independent review; F-02 to F-06 and the human gates remain open. This review is not an independent security audit or a claim that every line or image was manually inspected. No push or PR was performed.

## Exact scope and provenance

Host: `DESKTOP-SDAI72B`; worktree: `C:\taply-final-integration`; branch: `feature/final-integration-review`.

- Reviewed source HEAD: `7443c01161fa412943140d8e52ad1de9f56ff97e`.
- Expected and observed `origin/main`: `86bd54b981e0e4d8e8ff09d81bb888b370740baa`.
- Source `feature/release-candidate` matches the reviewed HEAD. Initial final worktree was clean. Remote refs were checked read-only; main is the merge base and ancestor, with no unexpected divergence.
- Local Git enumerated 126 inherited commits (115 non-merge), 704 changed files, 65,412 additions and 805 deletions. No GitHub file-list cutoff was used.
- This document is one additional path; the final documentation commit therefore has 705 cumulative changed paths. Its exact SHA is obtained with `git log -1 --format=%H -- docs/FINAL_INTEGRATION_REVIEW.md`, avoiding a self-referential commit hash.
- Implementation, contracts, packages, workflows, manifests and locks match the isolated PR #9 baseline `2199fab57ace177b60cdfe70e2c72672eefd9cfe`; PR #10 adds release documentation. The current changes do not alter those implementations.

Commands used for inventory: `git diff --name-status --no-renames origin/main...HEAD`, `git diff --numstat --no-renames origin/main...HEAD`, rename/mode summary, local history and ancestor checks. Every surviving input path was read and SHA-256 fingerprinted by the inventory program. The appendix preserves all 704 paths and review methods. Temporary detailed inventory, automation results and logs are host-local evidence, not public artifacts.

### Inherited PR audit

| PR | Verified inherited head | Audit focus |
| --- | --- | --- |
| #3 | `f3d15acd73faf35b7ff255ffbac6e7d48307b162` | Payment and wallet boundaries, receipt proofs, original contract-validation history |
| #6 | `6a485a251f38271fa9f95567e601a71c2b0ae70b` | Integration, backend/auth/room coordination, UI status boundaries and tests |
| #7 | `352a7cfd9efeda314634a81905f459b290f947ec` | Release/UI refinements and evidence labels, preserving signing review |
| #9 | `2199fab57ace177b60cdfe70e2c72672eefd9cfe` | Frozen G1 restored independently of G2; normal CI and artifact routing |
| #10 | `7443c01161fa412943140d8e52ad1de9f56ff97e` | Documentation provenance and publication claims |

All five heads are ancestors. PR #8 head `69e02ca52d7da95542fb16549b7732bd740cdf05` is not an ancestor. No diagnostic/g1-wasm-repro workflow is tracked. Only the three intended workflows are present. Historical failed contract runs are not misrepresented as current failures; historical passing runs are not current-HEAD acceptance.

## Inventory and coverage

Classification is exclusive by primary type; security implications cross categories. Contract build scripts are CI/config, Rust test modules stay with contract, and test fixtures are tests. HIGH is review priority, not a finding severity. All 704 paths were classified; none were silently omitted. Coverage means the methods below, not 704 manual semantic audits.

| Category | Paths | Method |
| --- | ---: | --- |
| contract | 13 | SEC |
| payment/verifier | 72 | SEC |
| wallet/signing | 33 | SEC |
| API/auth | 11 | SEC |
| CI/config | 37 | CFG |
| dependencies | 9 | DEP |
| frontend | 54 | UI |
| tests | 126 | TEST |
| docs | 76 | DOC |
| screenshots | 273 | PNG |
| binary/generated | 0 | OPEN |

637 additions, 66 modifications, one deletion. Rename detection reported no renames; no symlink, submodule or executable-mode change was found. The sole deletion is `apps/web/src/components/shell/RouteScaffold.tsx` (obsolete scaffold replaced by implemented screens). All 273 binary additions are PNG documentation screenshots. No tracked generated WASM, key store, customer backup or unexpected executable was found in the inventory. Candidate Rust sources and lockfiles are deliberate separate inputs, not approved deployment artifacts.

### Review method and boundaries

- Security logic: followed contract entrypoints through exact deposits, terms hashes, operation reservation, payout callbacks and retry accounting; wallet review through adapter/error handling and persistent journals; receipt hints through final RPC receipt graphs and UI status; backend authentication, persistence, authorization and coordination; flags and CI artifact handling. Reviewed cumulative changes and the surrounding final source where needed. Findings below remain OPEN rather than being obscured by passing tests.
- All changed text: inventory/content scan, endpoint and dangerous-pattern scan, relevant build/type/lint/tests. Frontend presentation and localization are covered by these checks plus review of trust-sensitive action/status boundaries; not every CSS or translated sentence received a manual semantic audit.
- Tests: existing executable suites and targeted failure investigation; fixtures and Rust tests also inspected for intended adversarial coverage. Rust tests were not executed locally. Passing tests are evidence for their cases, not a proof of absence of bugs.
- Docs: relative Markdown file targets checked automatically (zero missing targets), changed JSON parsed (zero failures), provenance and release claims checked. Anchor fragments and every external link were not exhaustively validated; these remain OPEN for final editorial acceptance.
- Assets: all 273 PNGs decoded to raw pixels using installed Sharp with warning failures enabled; zero decode failures. This validates files, not image privacy, visual correctness or physical-device behavior. No claim of line-by-line/manual review of 273 images. Human media/privacy/licensing acceptance remains OPEN before media publication.
- Dependencies: all nine manifests/locks classified; direct changes, new registry/integrity entries and reproducible-install evidence reviewed. This is not a source audit of every third-party package.

## Findings and unresolved risks

### F-01 — HIGH / FIXED LOCALLY, pending independent review: ambiguous wallet transport errors become nonblocking user rejection

Evidence: `apps/web/src/lib/wallet/adapter.ts:108` (especially line 111), `apps/web/src/lib/wallet/near-connect.ts:137`, `apps/web/src/lib/payments/submit.ts:65`, `apps/web/src/lib/payments/journal.ts:62`.

`classifyWalletError` matches `reject|cancel|denied|declin|closed|abort` in free-form error messages. The adapter uses this classification after invoking the external wallet. `submitCall` then records `USER_REJECTED`, and `isBlocking` excludes that phase. A transport failure after broadcast can therefore be treated as proof that nothing was sent.

Read-only reproduction with Node's TypeScript transform imported the actual classifier. All three messages returned `cancelled`: `The operation was aborted`, `connection closed after broadcast`, and `request rejected by RPC`. No wallet, signature, network payment or key was involved. This directly establishes the classification defect; the downstream journal consequence follows the code above. An actual post-broadcast wallet failure was not induced.

Impact: an uncertain action can lose its retry brake. A user can attempt another action/new request while the original may exist. The contract still rejects duplicate funding of the same intent; this is **not** evidence of a double payout for one contract request. New-intent duplication, misleading cancellation and unnecessary transactions/gas remain plausible consequences.

Required fix: accept only documented, explicit pre-broadcast user-decline signals as rejection; preserve OUTCOME_UNKNOWN for generic exceptions, aborts, closures and RPC rejection text. Add adapter-to-submit-to-journal regressions for each ambiguous message, explicit genuine decline, redirect/no-hash, account switch, storage failure and concurrent tabs. Retest workspace and wallet flows.

**Fix applied locally on 2026-11-06 (not pushed):**

- `9db43fb`: `@hot-labs/near-connect` 0.12.0 exposes no structured decline code (only the text `User rejected`), so **no external wallet signal is trusted as proof that nothing was sent**. Every error or malformed result after the SDK is invoked records `OUTCOME_UNKNOWN` (blocking). Only a local check before any SDK signing call (no connected wallet, or connected as another signer) throws `WalletNotDispatchedError` and records `USER_REJECTED` with `notDispatched: true`, the only nonblocking unresolved state. Legacy `USER_REJECTED` entries without that evidence are read back as `OUTCOME_UNKNOWN`, so the brake survives reloads. The redirect `errorCode=userRejected` path already recorded `OUTCOME_UNKNOWN` and is unchanged. `classifyWalletError` keeps its text matching for the connect picker only and is no longer called on the signing path.
- `24cf04a`: with declines now blocking, a declined `create_request` locked that merchant account out of new sales on the device indefinitely (the creation gate is account-wide and a declined creation never appears on chain). The G1 contract refuses a creation at or after its funding expiry (`IntentTerms::validate`, `INVALID_FUNDING_EXPIRY`), so a not-found read at a verified final, non-stale block at or after the signed expiry now resolves it. Unmarked or degraded absence still explains nothing.
- Regression suite `apps/web/src/lib/wallet/__tests__/retry-safety.test.ts` (70 tests) drives the real near-connect adapter through `submitCall` into the journal for all four methods: ambiguous and decline-shaped messages, strings, null/undefined, forged `WalletError`/`WalletNotDispatchedError` from the SDK, throwing getters, redirect/no-hash and malformed results, account mismatch, failed outcome and initial writes, concurrent tabs, legacy entries after reload and the creation expiry unblock. Four older tests that asserted the unsafe "decline is nonblocking" behavior were updated.
- `pnpm check` on `24cf04a`: exit 0 (brand, build, types, lint; shared 92, near-client 207, web 927 passed, 1 opt-in live skip). No wallet, signature, network payment or key was used.

Remaining consequences, disclosed rather than hidden: after a wallet decline the same payer cannot retry **that** request until a finalized read shows it funded, cancelled or expired (default sale lifetime 15 minutes; a new sale is a new request). A declined `cancel_unfunded` or `retry_native_transfer` has no comparable chain proof and stays blocked on that device until the request state changes. Real-device decline/return behavior is still unverified. Independent review of the fix is still required before signing.

### F-02 — HIGH governance / OPEN: main has no enforced protection

Read-only GitHub API: `/repos/KendineCrypto/taply/branches/main/protection` returned 404 with `Branch not protected`; repository rulesets returned `[]`. This permits bypassing the review/CI process. No settings were changed. This is a merge gate, not evidence that existing code was maliciously changed.

### F-03 — MEDIUM / OPEN: current CI is incomplete as a permanent required-check policy

Evidence: `.github/workflows/instant-pay-sandbox.yml:9` and `:17`, `workspace-check.yml:58`, `wallet-browser-check.yml:5`.

The cumulative PR touches all three workflows and their selected paths, so normal `pull_request` events should schedule workspace, G1, G2 and offline-browser jobs, subject to GitHub permissions/availability. No manual dispatch is necessary or authorized. That expectation is not an observed run for this final commit.

Future preflight-only changes do not match the contract workflow's PR paths (the preflight path is listed only under push). The independent `packages/near-client/verification-tests` tsc/Vitest suite is not executed by `pnpm check` or the workspace workflow's explicit steps. Root runtime/workspace changes do not trigger every relevant contract/browser job. Path-filtered workflows can leave required contexts pending on docs-only PRs. Wallet push branches omit main. Add unconditional required aggregation or explicit successful no-op routing, appropriate path coverage, and the independent verifier suite before relying on branch protection. Do not solve this by disabling or bypassing required checks.

### F-04 — MEDIUM / OPEN: development dependency advisory

`pnpm audit --json` ran on 2026-11-06, exit 1: one moderate advisory, zero reported high/critical. `minimatch@10.2.6` (`pnpm-lock.yaml:1741`, `:3626`) is reported vulnerable to globparts amplification DoS, GHSA-g3hv-75wg-m249, fixed at >=11.0.1. Reported paths are ESLint/typescript-eslint development dependencies. Review compatible upstream upgrades or an owner-approved documented risk decision; do not blindly override a major version. This finding is not evidence of a reachable production-payment exploit. [Advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).

Rust advisory scanning was not available locally and remains OPEN; locked versions and historical CI alone do not establish current advisory clearance.

### F-05 — MEDIUM / OPEN before live Handshake: reader body limits

`apps/web/src/lib/handshake/http-reader.ts:27` and `apps/web/src/lib/handshake/room.ts:388` consume `response.text()` before strict schema validation without an explicit byte budget. Five-second timeouts and schema/event limits do not bound bytes already buffered from a fast response. These same-origin HTTPS seams are not wired to live routes. Add bounded streaming reads and oversized-response regressions before enabling them. This is resource exhaustion risk, not a payment-authority bypass.

### F-06 — HIGH activation gate / OPEN: durable auth is not production-accepted

`apps/api/src/freshness.mts:10` explicitly supplies no production external freshness authority. Auth persistence's encrypted local database cannot by itself prove anti-rollback after restore. The separate fencing/CAS model and its tests do not establish a deployed independent authority. Windows ACL acceptance is also untested. Keep production auth closed, independently review key revocation/session lifetime, restore rollback, multi-worker replay fencing, secrets provisioning and incident recovery before live integration. These are documented disabled-feature limitations, not claims that encrypted storage is plaintext or that current routes accept live auth.

## Security boundary assessment

### G1 freeze and independent G2

The G1 source/config/lock/ABI inputs match frozen historical commit `258f138110760f726c7e090e807015332f513b19`. `node contracts/payments/scripts/check-isolation.mjs` passed again during this review. Frozen source files include `src/lib.rs`, `src/model.rs`, `src/tests.rs`, Cargo manifest/lock, `.cargo/config.toml`, Rust toolchain and ABI. The guard also forbids extra source/build scripts and Rust override variables.

Approved G1 pins remain unchanged (`apps/web/scripts/deploy-preflight.mjs:22`): SHA-256 `a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2`; NEAR code hash `BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`; 345541 bytes; 12 ABI methods. A pin match is not release approval.

G2 has its own Cargo workspace, source, lockfiles, target and `artifacts/merchant-v1` output. Build scripts reject `CARGO_TARGET_DIR`; G1 wrappers route candidate operations to that workspace. G2 preflight rejects the pilot account/G1 SHA and returns `deploymentApproved: false`. Callback-fault binaries are test-only. G2 CI uploads logs/hash/read records, not WASM. No stale or unapproved artifact was copied into G1; no generated WASM was committed.

Contract review found exact-deposit and canonical-term checks, direct signer/predecessor authorization, immutable recipient, reservation before asynchronous payout, private callback with runtime result count/operation nonce/status checks, recipient-only retry following recorded failure, and checked conservation arithmetic. Unknown callbacks remain in-flight. G2 adds creator-bound session commitments and durable tombstones; it does not turn session service messages into payment finality. No Protected Pay or FT capability is accepted by this candidate; those tests/features must not be claimed complete.

### Signing, reads and receipts

Payment construction reviews full terms/deposit, fresh config and approved code hash; journals are written before wallet invocation and use cross-tab locks. Redirect hashes are hints matched to signer, contract, method, terms and nonce. F-01 was an exception to the intended unknown-outcome behavior; it is fixed locally and pending independent review.

Near-client RPC reads check Testnet/genesis and final anchors with bounded transport/strict parsing. No ambiguous timeout is treated as paid or missing-account proof. Receipt verification traverses funding, recipient transfer and callback receipts, enforces amount/beneficiary/nonce, verifies code and retained-key observations, and distinguishes final contract state from independently verified receipt evidence. Locator/query/local journal hashes are untrusted candidates. UI success ribbons depend on verified evidence; room/socket hints cannot settle payments. RPC verification trusts the configured provider; it is not a light-client cryptographic proof. Historical evidence is not fresh chain acceptance.

Native-wallet vault code uses encrypted local storage/backup, Web Crypto and lock lifetime; provider UI handles encrypted backups rather than plaintext private keys. Native signing is hard-coded off. External wallet integration still requires independent review of third-party behavior and real device return/cancellation acceptance; F-01 demonstrates why unit test success alone is insufficient.

### Disabled capabilities

`apps/web/src/lib/flags/features.ts` defaults payment/merchant/Handshake/Protected Pay off. Some are soft environment flags, **not hard-disabled guarantees**. Contract capability checks and unavailable adapters remain necessary even if flags are changed. Social login, milestone and sponsored-gas flags are hard-disabled. `wallet/taply-wallet.ts` hard-disables native signing, and `components/send/SendFlow.tsx:31` has no live direct-transfer signer. Handshake/room resolvers supply unavailable adapters; session entry does not authenticate or pay. API production acceptance remains closed. No flags/env files were enabled by this task.

### Secrets, endpoints and workflows

The inherited history Gitleaks run scanned all 115 non-merge commits (~3.29 MB), returned four redacted matches, and each was reviewed: test idempotency literal `integration_key_0001` at historical `200d08c` API test line 30; local-storage identifiers `taply.pay-followup.v1`, `taply.wallet-return.v1`, `taply.journal.v1` at historical `8884e43`, `ba700a9`, `6f9b2d4`. These are false positives, not private keys. Scanner exit was 1; it must not be reported as an unqualified clean exit. No actual secret was identified. This is pattern-based history coverage, not a guarantee about encoded content or screenshot pixels.

Changed text endpoint inventory was reviewed: production defaults are public NEAR Testnet RPC/NEARBlocks; archival/FastNEAR are explicit read-only evidence/QA providers; localhost endpoints are development/QA; .example/.invalid/attacker/mainnet strings are fixtures or rejection tests. Public share origins in tests/docs are not proof of a hosted production site. Operator RPC/share overrides remain trust inputs. Third-party NEAR Connect runtime resources are not exhaustively audited here.

Workflow review: read-only contents permissions, SHA-pinned actions, no persisted checkout credentials, no repository-secret references, no pull_request_target, no deployment/signing command. Sandbox keys are ephemeral local test keys. Artifact globs separate approved G1 WASM from candidate/fault output. Dependency install/build remains execution of trusted-by-lock third-party code; no claim of zero supply-chain risk.

Public repository, exact source commit, PR #10 and historical run 42229980978 URLs each returned HTTP 200 during this review. No new live transaction was inspected or created. All external docs/explorer links and transient CI artifact retention remain OPEN for final release link checks.

## Dependency review

Direct additions: `@hot-labs/near-connect@0.12.0`, `jsqr@1.4.0`, workspace near-client and `near-api-js@7.4.0`; exact versions, not floating Git/tarball dependencies. The pnpm lock adds 561 lines of importers, integrity-pinned registry packages and snapshots. SDK transitives include cryptographic, Borsh/base58 and seed-phrase utilities; their presence does not authorize seed handling in the server. No new exotic resolution/override was found. Root pnpm policy retains strict peer/build checks, minimum release age and exotic-subdependency blocking.

G1 sandbox adds direct references to already-locked `near-jsonrpc-client =0.23.0` with sandbox feature and `near-primitives =0.38.0`, to await FINAL refunds; its lock changes by two dependency lines. G2 manifest pins near-sdk =5.30.0 and borsh =1.5.7, and has independent full locks (2749/3861 lines). G1 production lock is frozen. Current Rust security advisories and a full third-party license audit remain OPEN. Do not add a project LICENSE without owner approval.

## Test evidence and the two artifact failures

Local check logs from the preceding review run were inspected and retained because implementation inputs are unchanged. They are not newly executed Rust/CI results. Additional current checks: source isolation, classifier reproduction, dependency audit, complete inventory/content/JSON/link scan and PNG decoding.

| Check | Observed result | Limitation |
| --- | --- | --- |
| `pnpm check` | PASS, exit 0; brand/build/types/lint; 92 shared + 207 near-client + 856 web = 1155 passed | One opt-in live test skipped; fixture/jsdom evidence, not physical devices |
| Standalone API tsc + ESLint | PASS, exit 0 | API is not a root package test script |
| `node --test apps/api/test/*.test.mts` | 67 passed, 1 skipped | Windows POSIX file-permission case skipped |
| Independent verifier tsc/Vitest | 13 passed | Separate suite absent from normal workspace CI |
| `next build --webpack` | PASS, exit 0 | Not deployment or runtime/device acceptance |
| G1 source-isolation script | PASS, including current rerun | Source identity, not rebuilt WASM identity |
| Combined contract JavaScript test glob | 6 passed executions, 2 failed file loads | File-URL test is duplicated through forwarding; do not inflate unique coverage |
| Current pnpm audit | FAIL exit 1, one moderate development advisory | F-04; Rust audit OPEN |
| PNG full decode / changed JSON / relative file links | 273 decoded, 0 failures / 0 failures / 0 missing | No visual/privacy or anchor-fragment claim |
| Inherited diff whitespace check | Warnings, not clean | Patch-context spaces in web docs patch at 6/21/31 and historical report EOF at 506; unchanged |

Both file failures are the **same missing prerequisite**, not two demonstrated implementation defects. `contracts/payments-merchant/test/preflight.test.mjs:8` immediately reads `contracts/payments-merchant/artifacts/merchant-v1/payments.wasm` at module initialization. `contracts/payments/test/preflight.test.mjs:1` forwards to it. Running both globs loads it twice; both fail ENOENT before assertions. Native Windows file URL conversion is correct and its test passes. Rust/cargo are not installed on this host, so no fresh candidate output exists. No assertion on a fresh artifact has failed here, but a fresh build/test regression remains unexcluded until Linux CI runs.

Required Linux path: pinned Rust 1.95.0, clean G1 freeze/fmt/unit/Clippy/build/pinned hash/exports/full sandbox/wire; separately candidate `scripts/check.sh` (default + merchant unit, Clippy, candidate/fault build, sandbox), then candidate exports/preflight/wire and isolation tests. Use isolated outputs, frozen pnpm and Cargo `--locked`; never copy old artifacts to make tests green. CI is the applicable environment for POSIX permissions and Chromium/Firefox/WebKit offline crypto coverage too.

Historical normal contract CI [42229980978](https://github.com/KendineCrypto/taply/actions/runs/42229980978) passed on PR #9 head `2199fab57ace177b60cdfe70e2c72672eefd9cfe` using synthetic merge `2752b20f07bf2a23a0c632216997ee0f0bfe3b12`: G1 15 unit + 10 sandbox, G2 15 default + 19 merchant + 10 sandbox. It is supporting history, not final-branch CI. Artifact retention is time-limited; see RELEASE_READINESS for IDs/expiry.

## Exact recommended repository protections (not applied)

Protect main for administrators and normal contributors; prohibit direct push, force push and deletion; require a PR, two approvals including an independent security reviewer, code-owner approval for contracts/wallet/verifier/auth/CI/locks, dismissal of stale approvals and approval of the latest reviewable push by someone other than its author; require resolved conversations and an up-to-date base. Establish an owner-approved CODEOWNERS policy first; this review does not invent owners or alter settings.

Require successful GitHub Actions contexts using the actual names emitted by normal PR CI:

1. `frozen install + pnpm check`
2. `fmt, unit tests, clippy, WASM, full sandbox suite, wire schema`
3. `UNAPPROVED G2 candidate validation (no deployment artifact)`
4. `offline-crypto`

Also require a dedicated independent verifier suite and secret/dependency scan after those checks are implemented. Restrict accepted check sources to GitHub Actions, verify context identifiers from the eventual run, and resolve F-03 path-filter gaps before enforcing required contexts. No bypass actors or manual dispatch workaround is recommended. A security review draft does not grant release, deployment or signing approval.

## Final-PR acceptance matrix

| Gate / scenario | Required evidence | Current disposition | Must precede |
| --- | --- | --- | --- |
| Exact source/base/clean tree and full inventory | Recheck refs, ancestor, all paths and documentation-only final diff | Observed for source; recheck immediately before any later push | Draft |
| Publish authorization | Explicit later user instruction; one draft against main; normal non-force branch-only push | NOT AUTHORIZED now | Draft |
| F-01 | Narrow decline classification; regression across real adapter, submit and journal; all uncertain errors remain blocked | FIXED LOCALLY (`9db43fb`, `24cf04a`); independent review and real-device decline acceptance OPEN | Signing/merge until reviewed |
| Secrets and workflow safety | No real secret/exfiltration; #8 absent; read-only permissions; safe artifact scopes | No actual secret/dangerous workflow identified; scan limitations disclosed | Draft |
| Full findings disclosure | Include F-01–F-06, exact SHA/base, CI/device/license limitations in draft body | Prepared here; no PR created | Draft |
| Workspace/API/verifier/Webpack | Frozen install, types/lint/tests, explicit independent verifier, production Webpack | Local results above; final CI pending | Merge |
| G1 identity and sandbox | Exact unchanged pins, 15 units, 10 sandbox, gas/storage/conservation/failed callback/replay, wire and export checks | Source PASS; historical CI PASS; fresh Linux OPEN | Merge |
| G2 isolation and sandbox | 15 default + 19 merchant units, 10 sandbox, canonical binding/tombstone/replay, artifact preflight | Local artifact unavailable; historical CI PASS; fresh Linux OPEN | Merge; never means enablement |
| RPC and receipt adversity | Timeout/pruned history/malformed/duplicate/unsafe numeric values, wrong code/key/nonce/beneficiary, incomplete graph, refunds not paid | Existing offline tests pass; final independent security acceptance OPEN | Merge/signing |
| Auth/room persistence | Replay/expiry/origin/CSRF/token leak, concurrent workers, restored DB rollback, socket hints cannot settle, ACL | Offline tests; F-05/F-06 OPEN, live adapters remain closed | Live auth/Handshake; preserve disabled gates in merge |
| Dependency advisory/license | Resolve or explicitly accept moderate dev advisory; Rust advisory review; owner licensing decision | OPEN | Merge/release according to owner policy; license required before claiming open-source readiness |
| Main protection and CI routing | Exact required contexts + approvals; verifier execution and path gaps resolved | F-02/F-03 OPEN; settings untouched | Merge |
| Mobile/browser acceptance | Real iPhone Safari/PWA + Android wallet return, cancellation, QR camera, disconnect/background/offline, no duplicate resubmit; EN/TR/a11y | Physical acceptance OPEN; emulation cannot replace it | Signing/release |
| Protected/FT/social/sponsored modes | Separate security design/proofs and explicit approval; otherwise remain disabled | NOT ACCEPTED, disabled | Any enablement |
| Media/public links/evidence | Screenshot privacy/rights, actual hosted origin if used, links/retention, historical vs synthetic labels | Automated file checks only; human acceptance OPEN | Media publication/final submission |
| Human final security/release approval | Independent security review and explicit human approval | OPEN | Merge/release; no approval inferred |

Missing local candidate WASM is not intrinsically a Draft PR blocker: normal CI is intended to build it. Lack of main protection, device acceptance and licensing do not inherently prevent a clearly labelled review-only draft, but they prevent the corresponding merge/release claims. F-01 is fixed locally but not yet independently reviewed, so it still prevents an all-checks-passed recommendation. Review the fix before recommending publication as checked; an owner could separately authorize a security-review draft carrying the open finding, which is not authorized in this task. Never publish if refs diverge, the inventory is incomplete, a real secret is unresolved or workflow safety is unknown.

## Documentation changes and disposition

README and JUDGE_QUICK_START now identify the already published docs-bearing source `7443c01161fa412943140d8e52ad1de9f56ff97e`, instead of the earlier implementation-only SHA. The guide explicitly distinguishes that baseline from this local final-review branch/report and explains how to obtain its full report-bearing SHA. RELEASE_READINESS scopes its old no-push/no-PR claim to the original preparation and acknowledges later PR #10 publication. Historical phase reports and local-only demo/identity descriptions remain historical, not silently rewritten as current claims.

Final documentation checks: all 704 ledger rows present; all 700 surviving input files outside the three edited existing docs retain their inventoried SHA-256; no broken relative file links in the four final documents; staged `git diff --check` passed. Gitleaks on the staged documentation diff returned exit 0 with no leaks (about 98.57 KB scanned). A final fetch reconfirmed both expected refs and the final branch remained absent remotely.

No LICENSE, application code, approved pin, workflow, dependency or generated artifact was changed. No push, PR, merge, deploy, live signing, transfer, tag, media publication or submission occurred. Safe documentation can be committed locally without implying the findings are resolved.

## Complete inherited path ledger

Legend: A added, M modified, D deleted. Methods: **SEC** security-boundary review plus automated checks (not blanket approval); **CFG** configuration/script surface review plus relevant tests; **DEP** dependency/lock review plus advisory check; **TEST** test/fixture coverage, with Linux exclusions above; **UI** automated frontend checks and trust-sensitive boundary review; **DOC** content/provenance/link/JSON checks; **PNG** full decode and inventory, no manual visual/privacy certification. All entries also received risk/type classification. Rust tests within contract entries remain execution-OPEN. A method does not mark associated findings PASS.

| # | Change | Path | Category | Risk | Method |
| ---: | --- | --- | --- | --- | --- |
| 1 | A | `.github/workflows/instant-pay-sandbox.yml` | CI/config | HIGH | CFG |
| 2 | A | `.github/workflows/wallet-browser-check.yml` | CI/config | HIGH | CFG |
| 3 | A | `.github/workflows/workspace-check.yml` | CI/config | HIGH | CFG |
| 4 | M | `README.md` | docs | LOW | DOC |
| 5 | A | `apps/api/README.md` | docs | LOW | DOC |
| 6 | A | `apps/api/eslint.config.mjs` | CI/config | HIGH | CFG |
| 7 | A | `apps/api/src/auth.mts` | API/auth | HIGH | SEC |
| 8 | A | `apps/api/src/commerce-http.mts` | API/auth | HIGH | SEC |
| 9 | A | `apps/api/src/durable-auth.mts` | API/auth | HIGH | SEC |
| 10 | A | `apps/api/src/freshness.mts` | API/auth | HIGH | SEC |
| 11 | A | `apps/api/src/http.mts` | API/auth | HIGH | SEC |
| 12 | A | `apps/api/src/nep413.mts` | API/auth | HIGH | SEC |
| 13 | A | `apps/api/src/pilot-reader.mts` | API/auth | HIGH | SEC |
| 14 | A | `apps/api/src/room.mts` | API/auth | HIGH | SEC |
| 15 | A | `apps/api/src/service.mts` | API/auth | HIGH | SEC |
| 16 | A | `apps/api/src/sessions.mts` | API/auth | HIGH | SEC |
| 17 | A | `apps/api/src/storage.mts` | API/auth | HIGH | SEC |
| 18 | A | `apps/api/test/auth-hardening.test.mts` | tests | MEDIUM | TEST |
| 19 | A | `apps/api/test/auth.test.mts` | tests | MEDIUM | TEST |
| 20 | A | `apps/api/test/commerce-http.test.mts` | tests | MEDIUM | TEST |
| 21 | A | `apps/api/test/durable.test.mts` | tests | MEDIUM | TEST |
| 22 | A | `apps/api/test/freshness-worker.mts` | tests | MEDIUM | TEST |
| 23 | A | `apps/api/test/freshness.test.mts` | tests | MEDIUM | TEST |
| 24 | A | `apps/api/test/frontend-boundary.test.mts` | tests | MEDIUM | TEST |
| 25 | A | `apps/api/test/http-security.test.mts` | tests | MEDIUM | TEST |
| 26 | A | `apps/api/test/nep413.test.mts` | tests | MEDIUM | TEST |
| 27 | A | `apps/api/test/persistence-security.test.mts` | tests | MEDIUM | TEST |
| 28 | A | `apps/api/test/pilot-reader.test.mts` | tests | MEDIUM | TEST |
| 29 | A | `apps/api/test/room-consumer.test.mts` | tests | MEDIUM | TEST |
| 30 | A | `apps/api/test/room-fixture.mts` | tests | MEDIUM | TEST |
| 31 | A | `apps/api/test/room-persistence.test.mts` | tests | MEDIUM | TEST |
| 32 | A | `apps/api/test/room.test.mts` | tests | MEDIUM | TEST |
| 33 | A | `apps/api/test/sessions.test.mts` | tests | MEDIUM | TEST |
| 34 | A | `apps/api/test/signer-fixture.mts` | tests | MEDIUM | TEST |
| 35 | A | `apps/api/tsconfig.json` | CI/config | HIGH | CFG |
| 36 | M | `apps/web/.env.example` | CI/config | HIGH | CFG |
| 37 | M | `apps/web/README.md` | docs | LOW | DOC |
| 38 | A | `apps/web/docs/CHANGE_REQUEST_phase-2a.md` | docs | LOW | DOC |
| 39 | A | `apps/web/docs/DEMO_KIT.md` | docs | LOW | DOC |
| 40 | A | `apps/web/docs/PHASE_2E_REVIEW.md` | docs | LOW | DOC |
| 41 | A | `apps/web/docs/PHASE_5C_RELIABILITY.md` | docs | LOW | DOC |
| 42 | A | `apps/web/docs/PHASE_6A_PAY.md` | docs | LOW | DOC |
| 43 | A | `apps/web/docs/PHASE_6B_REVIEW.md` | docs | LOW | DOC |
| 44 | A | `apps/web/docs/PHASE_6C_MOBILE_PILOT.md` | docs | LOW | DOC |
| 45 | A | `apps/web/docs/PHASE_7D_QA.md` | docs | LOW | DOC |
| 46 | A | `apps/web/docs/PHASE_7F_SHARED_JOURNEY.md` | docs | LOW | DOC |
| 47 | A | `apps/web/docs/PHASE_7G_HANDSHAKE_ADAPTER.md` | docs | LOW | DOC |
| 48 | A | `apps/web/docs/PHASE_7G_UX_REPORT.md` | docs | LOW | DOC |
| 49 | A | `apps/web/docs/PHASE_7_COMMERCE_UI.md` | docs | LOW | DOC |
| 50 | A | `apps/web/docs/TESTNET_DEPLOYMENT_DRY_RUN.md` | docs | LOW | DOC |
| 51 | A | `apps/web/docs/TESTNET_PILOT_RUNBOOK.md` | docs | LOW | DOC |
| 52 | A | `apps/web/docs/TESTNET_READINESS_REVIEW.md` | docs | LOW | DOC |
| 53 | A | `apps/web/docs/lockfile-change-request.patch` | docs | LOW | DOC |
| 54 | A | `apps/web/docs/phase6b/audit-prod.json` | docs | LOW | DOC |
| 55 | A | `apps/web/docs/phase6b/audit.json` | docs | LOW | DOC |
| 56 | A | `apps/web/docs/phase6b/browser-smoke.json` | docs | LOW | DOC |
| 57 | A | `apps/web/docs/phase6b/qr-benchmark.json` | docs | LOW | DOC |
| 58 | A | `apps/web/docs/phase7/smoke.json` | docs | LOW | DOC |
| 59 | A | `apps/web/docs/phase7d/qa.json` | docs | LOW | DOC |
| 60 | A | `apps/web/docs/screenshots/01-home-en.png` | screenshots | LOW | PNG |
| 61 | A | `apps/web/docs/screenshots/02-tour-home-en.png` | screenshots | LOW | PNG |
| 62 | A | `apps/web/docs/screenshots/03-create-en.png` | screenshots | LOW | PNG |
| 63 | A | `apps/web/docs/screenshots/04-share-en.png` | screenshots | LOW | PNG |
| 64 | A | `apps/web/docs/screenshots/04-share-tr.png` | screenshots | LOW | PNG |
| 65 | A | `apps/web/docs/screenshots/05-review-en.png` | screenshots | LOW | PNG |
| 66 | A | `apps/web/docs/screenshots/06-progress-contract_paid-en.png` | screenshots | LOW | PNG |
| 67 | A | `apps/web/docs/screenshots/06-progress-failed-en.png` | screenshots | LOW | PNG |
| 68 | A | `apps/web/docs/screenshots/06-progress-transfer-en.png` | screenshots | LOW | PNG |
| 69 | A | `apps/web/docs/screenshots/06-progress-unresolved-en.png` | screenshots | LOW | PNG |
| 70 | A | `apps/web/docs/screenshots/06-progress-verified-en.png` | screenshots | LOW | PNG |
| 71 | A | `apps/web/docs/screenshots/07-receipt-en.png` | screenshots | LOW | PNG |
| 72 | A | `apps/web/docs/screenshots/07-receipt-tr.png` | screenshots | LOW | PNG |
| 73 | A | `apps/web/docs/screenshots/phase5-one-tap/README.md` | docs | LOW | DOC |
| 74 | A | `apps/web/docs/screenshots/phase5-one-tap/after/en-1280-home.png` | screenshots | LOW | PNG |
| 75 | A | `apps/web/docs/screenshots/phase5-one-tap/after/en-1280-receipt.png` | screenshots | LOW | PNG |
| 76 | A | `apps/web/docs/screenshots/phase5-one-tap/after/en-360-home.png` | screenshots | LOW | PNG |
| 77 | A | `apps/web/docs/screenshots/phase5-one-tap/after/en-390-account-menu.png` | screenshots | LOW | PNG |
| 78 | A | `apps/web/docs/screenshots/phase5-one-tap/after/en-390-activity.png` | screenshots | LOW | PNG |
| 79 | A | `apps/web/docs/screenshots/phase5-one-tap/after/en-390-home.png` | screenshots | LOW | PNG |
| 80 | A | `apps/web/docs/screenshots/phase5-one-tap/after/en-390-pay-status.png` | screenshots | LOW | PNG |
| 81 | A | `apps/web/docs/screenshots/phase5-one-tap/after/en-390-receipt-proof-open.png` | screenshots | LOW | PNG |
| 82 | A | `apps/web/docs/screenshots/phase5-one-tap/after/en-390-receipt.png` | screenshots | LOW | PNG |
| 83 | A | `apps/web/docs/screenshots/phase5-one-tap/after/en-390-request.png` | screenshots | LOW | PNG |
| 84 | A | `apps/web/docs/screenshots/phase5-one-tap/after/en-390-tap-pay-link.png` | screenshots | LOW | PNG |
| 85 | A | `apps/web/docs/screenshots/phase5-one-tap/after/en-390-tap-sheet.png` | screenshots | LOW | PNG |
| 86 | A | `apps/web/docs/screenshots/phase5-one-tap/after/en-390-wallet-create.png` | screenshots | LOW | PNG |
| 87 | A | `apps/web/docs/screenshots/phase5-one-tap/after/en-430-home.png` | screenshots | LOW | PNG |
| 88 | A | `apps/web/docs/screenshots/phase5-one-tap/after/overflow.txt` | docs | LOW | DOC |
| 89 | A | `apps/web/docs/screenshots/phase5-one-tap/after/tr-390-home.png` | screenshots | LOW | PNG |
| 90 | A | `apps/web/docs/screenshots/phase5-one-tap/after/tr-390-tap-sheet.png` | screenshots | LOW | PNG |
| 91 | A | `apps/web/docs/screenshots/phase5-one-tap/before/en-390-activity.png` | screenshots | LOW | PNG |
| 92 | A | `apps/web/docs/screenshots/phase5-one-tap/before/en-390-home.png` | screenshots | LOW | PNG |
| 93 | A | `apps/web/docs/screenshots/phase5-one-tap/before/en-390-pay-status.png` | screenshots | LOW | PNG |
| 94 | A | `apps/web/docs/screenshots/phase5-one-tap/before/en-390-receipt.png` | screenshots | LOW | PNG |
| 95 | A | `apps/web/docs/screenshots/phase5-one-tap/before/en-390-request.png` | screenshots | LOW | PNG |
| 96 | A | `apps/web/docs/screenshots/phase5-one-tap/before/en-390-wallet-create.png` | screenshots | LOW | PNG |
| 97 | A | `apps/web/docs/screenshots/phase5-one-tap/before/tr-390-home.png` | screenshots | LOW | PNG |
| 98 | A | `apps/web/docs/screenshots/phase6a-pay/01-pay-choices-390.png` | screenshots | LOW | PNG |
| 99 | A | `apps/web/docs/screenshots/phase6a-pay/02-scanner-invalid-qr-390.png` | screenshots | LOW | PNG |
| 100 | A | `apps/web/docs/screenshots/phase6a-pay/03-scanner-paused-390.png` | screenshots | LOW | PNG |
| 101 | A | `apps/web/docs/screenshots/phase6a-pay/04-scanner-denied-390.png` | screenshots | LOW | PNG |
| 102 | A | `apps/web/docs/screenshots/phase6a-pay/05-pay-with-link-390.png` | screenshots | LOW | PNG |
| 103 | A | `apps/web/docs/screenshots/phase6a-pay/06-scanner-360.png` | screenshots | LOW | PNG |
| 104 | A | `apps/web/docs/screenshots/phase6a-pay/06-scanner-430.png` | screenshots | LOW | PNG |
| 105 | A | `apps/web/docs/screenshots/phase7-commerce/checkout-customer-1280.png` | screenshots | LOW | PNG |
| 106 | A | `apps/web/docs/screenshots/phase7-commerce/checkout-customer-360.png` | screenshots | LOW | PNG |
| 107 | A | `apps/web/docs/screenshots/phase7-commerce/checkout-customer-390-tr.png` | screenshots | LOW | PNG |
| 108 | A | `apps/web/docs/screenshots/phase7-commerce/checkout-customer-390.png` | screenshots | LOW | PNG |
| 109 | A | `apps/web/docs/screenshots/phase7-commerce/checkout-customer-430.png` | screenshots | LOW | PNG |
| 110 | A | `apps/web/docs/screenshots/phase7-commerce/checkout-not-testnet-390.png` | screenshots | LOW | PNG |
| 111 | A | `apps/web/docs/screenshots/phase7-commerce/checkout-own-1280.png` | screenshots | LOW | PNG |
| 112 | A | `apps/web/docs/screenshots/phase7-commerce/checkout-own-360.png` | screenshots | LOW | PNG |
| 113 | A | `apps/web/docs/screenshots/phase7-commerce/checkout-own-390.png` | screenshots | LOW | PNG |
| 114 | A | `apps/web/docs/screenshots/phase7-commerce/checkout-own-430.png` | screenshots | LOW | PNG |
| 115 | A | `apps/web/docs/screenshots/phase7-commerce/checkout-paste-invalid-390.png` | screenshots | LOW | PNG |
| 116 | A | `apps/web/docs/screenshots/phase7-commerce/demo-handshake-1-create-390.png` | screenshots | LOW | PNG |
| 117 | A | `apps/web/docs/screenshots/phase7-commerce/demo-handshake-3-compare-390.png` | screenshots | LOW | PNG |
| 118 | A | `apps/web/docs/screenshots/phase7-commerce/demo-handshake-3-mismatch-390.png` | screenshots | LOW | PNG |
| 119 | A | `apps/web/docs/screenshots/phase7-commerce/demo-handshake-5-wallet-390.png` | screenshots | LOW | PNG |
| 120 | A | `apps/web/docs/screenshots/phase7-commerce/demo-handshake-compare-1280.png` | screenshots | LOW | PNG |
| 121 | A | `apps/web/docs/screenshots/phase7-commerce/demo-handshake-compare-390-tr.png` | screenshots | LOW | PNG |
| 122 | A | `apps/web/docs/screenshots/phase7-commerce/discovery-qr-1280.png` | screenshots | LOW | PNG |
| 123 | A | `apps/web/docs/screenshots/phase7-commerce/discovery-qr-360.png` | screenshots | LOW | PNG |
| 124 | A | `apps/web/docs/screenshots/phase7-commerce/discovery-qr-390-tr.png` | screenshots | LOW | PNG |
| 125 | A | `apps/web/docs/screenshots/phase7-commerce/discovery-qr-390.png` | screenshots | LOW | PNG |
| 126 | A | `apps/web/docs/screenshots/phase7-commerce/discovery-qr-430.png` | screenshots | LOW | PNG |
| 127 | A | `apps/web/docs/screenshots/phase7-commerce/merchant-hub-1280.png` | screenshots | LOW | PNG |
| 128 | A | `apps/web/docs/screenshots/phase7-commerce/merchant-hub-360.png` | screenshots | LOW | PNG |
| 129 | A | `apps/web/docs/screenshots/phase7-commerce/merchant-hub-390-tr.png` | screenshots | LOW | PNG |
| 130 | A | `apps/web/docs/screenshots/phase7-commerce/merchant-hub-390.png` | screenshots | LOW | PNG |
| 131 | A | `apps/web/docs/screenshots/phase7-commerce/merchant-hub-430.png` | screenshots | LOW | PNG |
| 132 | A | `apps/web/docs/screenshots/phase7-commerce/pos-amount-1280.png` | screenshots | LOW | PNG |
| 133 | A | `apps/web/docs/screenshots/phase7-commerce/pos-amount-360.png` | screenshots | LOW | PNG |
| 134 | A | `apps/web/docs/screenshots/phase7-commerce/pos-amount-390.png` | screenshots | LOW | PNG |
| 135 | A | `apps/web/docs/screenshots/phase7-commerce/pos-amount-430.png` | screenshots | LOW | PNG |
| 136 | A | `apps/web/docs/screenshots/phase7-commerce/pos-review-390.png` | screenshots | LOW | PNG |
| 137 | A | `apps/web/docs/screenshots/phase7-commerce/session-invalid-390.png` | screenshots | LOW | PNG |
| 138 | A | `apps/web/docs/screenshots/phase7-commerce/session-unavailable-390.png` | screenshots | LOW | PNG |
| 139 | A | `apps/web/docs/screenshots/phase7d-qa/disconnected-merchant-360.png` | screenshots | LOW | PNG |
| 140 | A | `apps/web/docs/screenshots/phase7d-qa/disconnected-merchant-register-360.png` | screenshots | LOW | PNG |
| 141 | A | `apps/web/docs/screenshots/phase7d-qa/large-amount-form-360.png` | screenshots | LOW | PNG |
| 142 | A | `apps/web/docs/screenshots/phase7d-qa/long-account-checkout-360.png` | screenshots | LOW | PNG |
| 143 | A | `apps/web/docs/screenshots/phase7d-qa/long-account-discovery-360.png` | screenshots | LOW | PNG |
| 144 | A | `apps/web/docs/screenshots/phase7d-qa/long-account-hub-360.png` | screenshots | LOW | PNG |
| 145 | A | `apps/web/docs/screenshots/phase7d-qa/long-account-pos-360.png` | screenshots | LOW | PNG |
| 146 | A | `apps/web/docs/screenshots/phase7d-qa/scanner-from-checkout-390.png` | screenshots | LOW | PNG |
| 147 | A | `apps/web/docs/screenshots/phase7d-qa/tiny-amount-review-360.png` | screenshots | LOW | PNG |
| 148 | A | `apps/web/docs/screenshots/phase7f-journey/customer-paid-360.png` | screenshots | LOW | PNG |
| 149 | A | `apps/web/docs/screenshots/phase7f-journey/customer-paid-390.png` | screenshots | LOW | PNG |
| 150 | A | `apps/web/docs/screenshots/phase7f-journey/demo-joined-390.png` | screenshots | LOW | PNG |
| 151 | A | `apps/web/docs/screenshots/phase7f-journey/demo-wallet-390.png` | screenshots | LOW | PNG |
| 152 | A | `apps/web/docs/screenshots/phase7f-journey/merchant-paid-360.png` | screenshots | LOW | PNG |
| 153 | A | `apps/web/docs/screenshots/phase7f-journey/merchant-paid-390.png` | screenshots | LOW | PNG |
| 154 | A | `apps/web/docs/screenshots/phase7f-journey/phase7f-qa.json` | docs | LOW | DOC |
| 155 | A | `apps/web/docs/screenshots/phase7f-journey/receipt-verified-360.png` | screenshots | LOW | PNG |
| 156 | A | `apps/web/docs/screenshots/phase7f-journey/receipt-verified-390.png` | screenshots | LOW | PNG |
| 157 | A | `apps/web/docs/screenshots/phase7f-journey/receipt-verified-burst-360.png` | screenshots | LOW | PNG |
| 158 | A | `apps/web/docs/screenshots/phase7f-journey/receipt-verified-burst-390.png` | screenshots | LOW | PNG |
| 159 | A | `apps/web/docs/screenshots/phase7f-journey/tr-merchant-paid-360.png` | screenshots | LOW | PNG |
| 160 | A | `apps/web/docs/screenshots/phase7g/checkout-390.png` | screenshots | LOW | PNG |
| 161 | A | `apps/web/docs/screenshots/phase7g/customer-paid-1280.png` | screenshots | LOW | PNG |
| 162 | A | `apps/web/docs/screenshots/phase7g/customer-paid-360.png` | screenshots | LOW | PNG |
| 163 | A | `apps/web/docs/screenshots/phase7g/customer-paid-390.png` | screenshots | LOW | PNG |
| 164 | A | `apps/web/docs/screenshots/phase7g/customer-receipt-verified-390.png` | screenshots | LOW | PNG |
| 165 | A | `apps/web/docs/screenshots/phase7g/demo-room-joined-360.png` | screenshots | LOW | PNG |
| 166 | A | `apps/web/docs/screenshots/phase7g/demo-room-mismatch-360.png` | screenshots | LOW | PNG |
| 167 | A | `apps/web/docs/screenshots/phase7g/demo-room-pending-1280.png` | screenshots | LOW | PNG |
| 168 | A | `apps/web/docs/screenshots/phase7g/demo-room-pending-360.png` | screenshots | LOW | PNG |
| 169 | A | `apps/web/docs/screenshots/phase7g/keyboard-verify-receipt-focus-390.png` | screenshots | LOW | PNG |
| 170 | A | `apps/web/docs/screenshots/phase7g/merchant-home-390.png` | screenshots | LOW | PNG |
| 171 | A | `apps/web/docs/screenshots/phase7g/merchant-paid-1280.png` | screenshots | LOW | PNG |
| 172 | A | `apps/web/docs/screenshots/phase7g/merchant-paid-360.png` | screenshots | LOW | PNG |
| 173 | A | `apps/web/docs/screenshots/phase7g/merchant-paid-390.png` | screenshots | LOW | PNG |
| 174 | A | `apps/web/docs/screenshots/phase7g/merchant-receipt-verified-1280.png` | screenshots | LOW | PNG |
| 175 | A | `apps/web/docs/screenshots/phase7g/phase7g-qa.json` | docs | LOW | DOC |
| 176 | A | `apps/web/docs/screenshots/phase7g/rpc-unavailable-merchant-receipt-en-390.png` | screenshots | LOW | PNG |
| 177 | A | `apps/web/docs/screenshots/phase7g/rpc-unavailable-tr-customer-paid-768.png` | screenshots | LOW | PNG |
| 178 | A | `apps/web/docs/screenshots/phase7g/stranger-paid-390.png` | screenshots | LOW | PNG |
| 179 | A | `apps/web/docs/screenshots/phase7g/synthetic-rpc-down-390.png` | screenshots | LOW | PNG |
| 180 | A | `apps/web/docs/screenshots/phase7g/synthetic-slow-rpc-loading-390.png` | screenshots | LOW | PNG |
| 181 | A | `apps/web/docs/screenshots/phase7g/tr-customer-paid-1280.png` | screenshots | LOW | PNG |
| 182 | A | `apps/web/docs/screenshots/phase7g/tr-customer-paid-360.png` | screenshots | LOW | PNG |
| 183 | A | `apps/web/docs/screenshots/phase7g/tr-merchant-paid-1280.png` | screenshots | LOW | PNG |
| 184 | A | `apps/web/docs/screenshots/phase7g/tr-merchant-paid-360.png` | screenshots | LOW | PNG |
| 185 | A | `apps/web/docs/screenshots/phase7g/tr-merchant-receipt-verified-360.png` | screenshots | LOW | PNG |
| 186 | A | `apps/web/docs/screenshots/phase7g/two-phones-paid-side-by-side.png` | screenshots | LOW | PNG |
| 187 | A | `apps/web/docs/screenshots/phase7h/en-checkout-390.png` | screenshots | LOW | PNG |
| 188 | A | `apps/web/docs/screenshots/phase7h/en-customer-paid-1280.png` | screenshots | LOW | PNG |
| 189 | A | `apps/web/docs/screenshots/phase7h/en-customer-paid-390.png` | screenshots | LOW | PNG |
| 190 | A | `apps/web/docs/screenshots/phase7h/en-customer-receipt-1280.png` | screenshots | LOW | PNG |
| 191 | A | `apps/web/docs/screenshots/phase7h/en-customer-receipt-390.png` | screenshots | LOW | PNG |
| 192 | A | `apps/web/docs/screenshots/phase7h/en-demo-390.png` | screenshots | LOW | PNG |
| 193 | A | `apps/web/docs/screenshots/phase7h/en-home-390.png` | screenshots | LOW | PNG |
| 194 | A | `apps/web/docs/screenshots/phase7h/en-merchant-home-390.png` | screenshots | LOW | PNG |
| 195 | A | `apps/web/docs/screenshots/phase7h/en-merchant-paid-1280.png` | screenshots | LOW | PNG |
| 196 | A | `apps/web/docs/screenshots/phase7h/en-merchant-paid-390.png` | screenshots | LOW | PNG |
| 197 | A | `apps/web/docs/screenshots/phase7h/en-merchant-receipt-verified-390.png` | screenshots | LOW | PNG |
| 198 | A | `apps/web/docs/screenshots/phase7h/handshake-live-route-390.png` | screenshots | LOW | PNG |
| 199 | A | `apps/web/docs/screenshots/phase7h/phase7h-qa-liveregion.json` | docs | LOW | DOC |
| 200 | A | `apps/web/docs/screenshots/phase7h/phase7h-qa-rerun.json` | docs | LOW | DOC |
| 201 | A | `apps/web/docs/screenshots/phase7h/phase7h-qa.json` | docs | LOW | DOC |
| 202 | A | `apps/web/docs/screenshots/phase7h/pruned-customer-receipt-390.png` | screenshots | LOW | PNG |
| 203 | A | `apps/web/docs/screenshots/phase7h/pruned-merchant-receipt-390.png` | screenshots | LOW | PNG |
| 204 | A | `apps/web/docs/screenshots/phase7h/reconnect-merchant-paid-390.png` | screenshots | LOW | PNG |
| 205 | A | `apps/web/docs/screenshots/phase7h/switch-disconnected-390.png` | screenshots | LOW | PNG |
| 206 | A | `apps/web/docs/screenshots/phase7h/switch-someone-else-qa-390.png` | screenshots | LOW | PNG |
| 207 | A | `apps/web/docs/screenshots/phase7h/switch-taply-pilot-funder-1101-390.png` | screenshots | LOW | PNG |
| 208 | A | `apps/web/docs/screenshots/phase7h/switch-taplytest-390.png` | screenshots | LOW | PNG |
| 209 | A | `apps/web/docs/screenshots/phase7h/synthetic-receipt-read-failure-390.png` | screenshots | LOW | PNG |
| 210 | A | `apps/web/docs/screenshots/phase7h/synthetic-rpc-down-en-390.png` | screenshots | LOW | PNG |
| 211 | A | `apps/web/docs/screenshots/phase7h/synthetic-rpc-down-tr-390.png` | screenshots | LOW | PNG |
| 212 | A | `apps/web/docs/screenshots/phase7h/synthetic-slow-rpc-loading-390.png` | screenshots | LOW | PNG |
| 213 | A | `apps/web/docs/screenshots/phase7h/throttled-fastnear-429-tr-customer-paid-430.png` | screenshots | LOW | PNG |
| 214 | A | `apps/web/docs/screenshots/phase7h/throttled-rpc-testnet-near-org-429-tr-390.png` | screenshots | LOW | PNG |
| 215 | A | `apps/web/docs/screenshots/phase7h/tr-checkout-360.png` | screenshots | LOW | PNG |
| 216 | A | `apps/web/docs/screenshots/phase7h/tr-customer-paid-360.png` | screenshots | LOW | PNG |
| 217 | A | `apps/web/docs/screenshots/phase7h/tr-customer-receipt-360.png` | screenshots | LOW | PNG |
| 218 | A | `apps/web/docs/screenshots/phase7h/tr-demo-360.png` | screenshots | LOW | PNG |
| 219 | A | `apps/web/docs/screenshots/phase7h/tr-home-360.png` | screenshots | LOW | PNG |
| 220 | A | `apps/web/docs/screenshots/phase7h/tr-merchant-home-360.png` | screenshots | LOW | PNG |
| 221 | A | `apps/web/docs/screenshots/phase7h/tr-merchant-paid-360.png` | screenshots | LOW | PNG |
| 222 | A | `apps/web/docs/screenshots/phase7h/tr-merchant-receipt-verified-360.png` | screenshots | LOW | PNG |
| 223 | A | `apps/web/docs/screenshots/phase7i/en-activity-390.png` | screenshots | LOW | PNG |
| 224 | A | `apps/web/docs/screenshots/phase7i/en-checkout-1280.png` | screenshots | LOW | PNG |
| 225 | A | `apps/web/docs/screenshots/phase7i/en-checkout-390.png` | screenshots | LOW | PNG |
| 226 | A | `apps/web/docs/screenshots/phase7i/en-demo-create-390.png` | screenshots | LOW | PNG |
| 227 | A | `apps/web/docs/screenshots/phase7i/en-demo-progress-390.png` | screenshots | LOW | PNG |
| 228 | A | `apps/web/docs/screenshots/phase7i/en-demo-receipt-390.png` | screenshots | LOW | PNG |
| 229 | A | `apps/web/docs/screenshots/phase7i/en-demo-receive-390.png` | screenshots | LOW | PNG |
| 230 | A | `apps/web/docs/screenshots/phase7i/en-demo-review-390.png` | screenshots | LOW | PNG |
| 231 | A | `apps/web/docs/screenshots/phase7i/en-demo-send-390.png` | screenshots | LOW | PNG |
| 232 | A | `apps/web/docs/screenshots/phase7i/en-demo-share-390.png` | screenshots | LOW | PNG |
| 233 | A | `apps/web/docs/screenshots/phase7i/en-fixture-awaiting-1280.png` | screenshots | LOW | PNG |
| 234 | A | `apps/web/docs/screenshots/phase7i/en-fixture-awaiting-360.png` | screenshots | LOW | PNG |
| 235 | A | `apps/web/docs/screenshots/phase7i/en-fixture-awaiting-390.png` | screenshots | LOW | PNG |
| 236 | A | `apps/web/docs/screenshots/phase7i/en-fixture-contract_paid-1280.png` | screenshots | LOW | PNG |
| 237 | A | `apps/web/docs/screenshots/phase7i/en-fixture-contract_paid-360.png` | screenshots | LOW | PNG |
| 238 | A | `apps/web/docs/screenshots/phase7i/en-fixture-contract_paid-390.png` | screenshots | LOW | PNG |
| 239 | A | `apps/web/docs/screenshots/phase7i/en-fixture-transfer-1280.png` | screenshots | LOW | PNG |
| 240 | A | `apps/web/docs/screenshots/phase7i/en-fixture-transfer-360.png` | screenshots | LOW | PNG |
| 241 | A | `apps/web/docs/screenshots/phase7i/en-fixture-transfer-390.png` | screenshots | LOW | PNG |
| 242 | A | `apps/web/docs/screenshots/phase7i/en-fixture-unresolved-1280.png` | screenshots | LOW | PNG |
| 243 | A | `apps/web/docs/screenshots/phase7i/en-fixture-unresolved-360.png` | screenshots | LOW | PNG |
| 244 | A | `apps/web/docs/screenshots/phase7i/en-fixture-unresolved-390.png` | screenshots | LOW | PNG |
| 245 | A | `apps/web/docs/screenshots/phase7i/en-fixture-verified-1280.png` | screenshots | LOW | PNG |
| 246 | A | `apps/web/docs/screenshots/phase7i/en-fixture-verified-360.png` | screenshots | LOW | PNG |
| 247 | A | `apps/web/docs/screenshots/phase7i/en-fixture-verified-390.png` | screenshots | LOW | PNG |
| 248 | A | `apps/web/docs/screenshots/phase7i/en-home-390.png` | screenshots | LOW | PNG |
| 249 | A | `apps/web/docs/screenshots/phase7i/en-invalid-payment-390.png` | screenshots | LOW | PNG |
| 250 | A | `apps/web/docs/screenshots/phase7i/en-merchant-390.png` | screenshots | LOW | PNG |
| 251 | A | `apps/web/docs/screenshots/phase7i/en-request-390.png` | screenshots | LOW | PNG |
| 252 | A | `apps/web/docs/screenshots/phase7i/en-sale-390.png` | screenshots | LOW | PNG |
| 253 | A | `apps/web/docs/screenshots/phase7i/en-wallet-390.png` | screenshots | LOW | PNG |
| 254 | A | `apps/web/docs/screenshots/phase7i/qa.json` | docs | LOW | DOC |
| 255 | A | `apps/web/docs/screenshots/phase7i/tr-activity-360.png` | screenshots | LOW | PNG |
| 256 | A | `apps/web/docs/screenshots/phase7i/tr-checkout-1280.png` | screenshots | LOW | PNG |
| 257 | A | `apps/web/docs/screenshots/phase7i/tr-checkout-360.png` | screenshots | LOW | PNG |
| 258 | A | `apps/web/docs/screenshots/phase7i/tr-demo-create-360.png` | screenshots | LOW | PNG |
| 259 | A | `apps/web/docs/screenshots/phase7i/tr-demo-progress-360.png` | screenshots | LOW | PNG |
| 260 | A | `apps/web/docs/screenshots/phase7i/tr-demo-receipt-360.png` | screenshots | LOW | PNG |
| 261 | A | `apps/web/docs/screenshots/phase7i/tr-demo-receive-360.png` | screenshots | LOW | PNG |
| 262 | A | `apps/web/docs/screenshots/phase7i/tr-demo-review-360.png` | screenshots | LOW | PNG |
| 263 | A | `apps/web/docs/screenshots/phase7i/tr-demo-send-360.png` | screenshots | LOW | PNG |
| 264 | A | `apps/web/docs/screenshots/phase7i/tr-demo-share-360.png` | screenshots | LOW | PNG |
| 265 | A | `apps/web/docs/screenshots/phase7i/tr-fixture-awaiting-1280.png` | screenshots | LOW | PNG |
| 266 | A | `apps/web/docs/screenshots/phase7i/tr-fixture-awaiting-360.png` | screenshots | LOW | PNG |
| 267 | A | `apps/web/docs/screenshots/phase7i/tr-fixture-awaiting-390.png` | screenshots | LOW | PNG |
| 268 | A | `apps/web/docs/screenshots/phase7i/tr-fixture-contract_paid-1280.png` | screenshots | LOW | PNG |
| 269 | A | `apps/web/docs/screenshots/phase7i/tr-fixture-contract_paid-360.png` | screenshots | LOW | PNG |
| 270 | A | `apps/web/docs/screenshots/phase7i/tr-fixture-contract_paid-390.png` | screenshots | LOW | PNG |
| 271 | A | `apps/web/docs/screenshots/phase7i/tr-fixture-transfer-1280.png` | screenshots | LOW | PNG |
| 272 | A | `apps/web/docs/screenshots/phase7i/tr-fixture-transfer-360.png` | screenshots | LOW | PNG |
| 273 | A | `apps/web/docs/screenshots/phase7i/tr-fixture-transfer-390.png` | screenshots | LOW | PNG |
| 274 | A | `apps/web/docs/screenshots/phase7i/tr-fixture-unresolved-1280.png` | screenshots | LOW | PNG |
| 275 | A | `apps/web/docs/screenshots/phase7i/tr-fixture-unresolved-360.png` | screenshots | LOW | PNG |
| 276 | A | `apps/web/docs/screenshots/phase7i/tr-fixture-unresolved-390.png` | screenshots | LOW | PNG |
| 277 | A | `apps/web/docs/screenshots/phase7i/tr-fixture-verified-1280.png` | screenshots | LOW | PNG |
| 278 | A | `apps/web/docs/screenshots/phase7i/tr-fixture-verified-360.png` | screenshots | LOW | PNG |
| 279 | A | `apps/web/docs/screenshots/phase7i/tr-fixture-verified-390.png` | screenshots | LOW | PNG |
| 280 | A | `apps/web/docs/screenshots/phase7i/tr-home-360.png` | screenshots | LOW | PNG |
| 281 | A | `apps/web/docs/screenshots/phase7i/tr-invalid-payment-360.png` | screenshots | LOW | PNG |
| 282 | A | `apps/web/docs/screenshots/phase7i/tr-merchant-360.png` | screenshots | LOW | PNG |
| 283 | A | `apps/web/docs/screenshots/phase7i/tr-request-360.png` | screenshots | LOW | PNG |
| 284 | A | `apps/web/docs/screenshots/phase7i/tr-sale-360.png` | screenshots | LOW | PNG |
| 285 | A | `apps/web/docs/screenshots/phase7i/tr-wallet-360.png` | screenshots | LOW | PNG |
| 286 | A | `apps/web/docs/screenshots/taply-wallet/20-wallet-external-390-en.png` | screenshots | LOW | PNG |
| 287 | A | `apps/web/docs/screenshots/taply-wallet/20-wallet-external-390-tr.png` | screenshots | LOW | PNG |
| 288 | A | `apps/web/docs/screenshots/taply-wallet/21-taply-intro-390-en.png` | screenshots | LOW | PNG |
| 289 | A | `apps/web/docs/screenshots/taply-wallet/21-taply-intro-390-tr.png` | screenshots | LOW | PNG |
| 290 | A | `apps/web/docs/screenshots/taply-wallet/21-taply-intro-desktop-en.png` | screenshots | LOW | PNG |
| 291 | A | `apps/web/docs/screenshots/taply-wallet/22-create-understand-390-en.png` | screenshots | LOW | PNG |
| 292 | A | `apps/web/docs/screenshots/taply-wallet/22-create-understand-390-tr.png` | screenshots | LOW | PNG |
| 293 | A | `apps/web/docs/screenshots/taply-wallet/23-create-passphrase-390-en.png` | screenshots | LOW | PNG |
| 294 | A | `apps/web/docs/screenshots/taply-wallet/23-create-passphrase-390-tr.png` | screenshots | LOW | PNG |
| 295 | A | `apps/web/docs/screenshots/taply-wallet/24-create-backup-390-en.png` | screenshots | LOW | PNG |
| 296 | A | `apps/web/docs/screenshots/taply-wallet/24-create-backup-390-tr.png` | screenshots | LOW | PNG |
| 297 | A | `apps/web/docs/screenshots/taply-wallet/25-taply-local-locked-390-en.png` | screenshots | LOW | PNG |
| 298 | A | `apps/web/docs/screenshots/taply-wallet/25-taply-local-locked-390-tr.png` | screenshots | LOW | PNG |
| 299 | A | `apps/web/docs/screenshots/taply-wallet/26-taply-unlocked-390-en.png` | screenshots | LOW | PNG |
| 300 | A | `apps/web/docs/screenshots/taply-wallet/26-taply-unlocked-390-tr.png` | screenshots | LOW | PNG |
| 301 | A | `apps/web/docs/screenshots/taply-wallet/27-home-taply-390-en.png` | screenshots | LOW | PNG |
| 302 | A | `apps/web/docs/screenshots/taply-wallet/27-home-taply-390-tr.png` | screenshots | LOW | PNG |
| 303 | A | `apps/web/docs/screenshots/taply-wallet/28-receive-taply-390-en.png` | screenshots | LOW | PNG |
| 304 | A | `apps/web/docs/screenshots/taply-wallet/28-receive-taply-390-tr.png` | screenshots | LOW | PNG |
| 305 | A | `apps/web/docs/screenshots/taply-wallet/29-send-taply-local-390-en.png` | screenshots | LOW | PNG |
| 306 | A | `apps/web/docs/screenshots/taply-wallet/29-send-taply-local-390-tr.png` | screenshots | LOW | PNG |
| 307 | A | `apps/web/docs/screenshots/taply-wallet/30-restore-existing-390-en.png` | screenshots | LOW | PNG |
| 308 | A | `apps/web/docs/screenshots/taply-wallet/30-restore-existing-390-tr.png` | screenshots | LOW | PNG |
| 309 | A | `apps/web/docs/screenshots/taply-wallet/31-restore-390-en.png` | screenshots | LOW | PNG |
| 310 | A | `apps/web/docs/screenshots/taply-wallet/31-restore-390-tr.png` | screenshots | LOW | PNG |
| 311 | A | `apps/web/docs/screenshots/wallet/01-home-390-en.png` | screenshots | LOW | PNG |
| 312 | A | `apps/web/docs/screenshots/wallet/01-home-390-tr.png` | screenshots | LOW | PNG |
| 313 | A | `apps/web/docs/screenshots/wallet/01-home-desktop-en.png` | screenshots | LOW | PNG |
| 314 | A | `apps/web/docs/screenshots/wallet/02-wallet-onboarding-390-en.png` | screenshots | LOW | PNG |
| 315 | A | `apps/web/docs/screenshots/wallet/02-wallet-onboarding-390-tr.png` | screenshots | LOW | PNG |
| 316 | A | `apps/web/docs/screenshots/wallet/02-wallet-onboarding-desktop-en.png` | screenshots | LOW | PNG |
| 317 | A | `apps/web/docs/screenshots/wallet/03-wallet-create-explained-390-en.png` | screenshots | LOW | PNG |
| 318 | A | `apps/web/docs/screenshots/wallet/03-wallet-create-explained-390-tr.png` | screenshots | LOW | PNG |
| 319 | A | `apps/web/docs/screenshots/wallet/04-send-connect-390-en.png` | screenshots | LOW | PNG |
| 320 | A | `apps/web/docs/screenshots/wallet/04-send-connect-390-tr.png` | screenshots | LOW | PNG |
| 321 | A | `apps/web/docs/screenshots/wallet/05-tour-wallet-home-390-en.png` | screenshots | LOW | PNG |
| 322 | A | `apps/web/docs/screenshots/wallet/05-tour-wallet-home-390-tr.png` | screenshots | LOW | PNG |
| 323 | A | `apps/web/docs/screenshots/wallet/05-tour-wallet-home-desktop-en.png` | screenshots | LOW | PNG |
| 324 | A | `apps/web/docs/screenshots/wallet/06-tour-receive-390-en.png` | screenshots | LOW | PNG |
| 325 | A | `apps/web/docs/screenshots/wallet/06-tour-receive-390-tr.png` | screenshots | LOW | PNG |
| 326 | A | `apps/web/docs/screenshots/wallet/07-tour-send-review-390-en.png` | screenshots | LOW | PNG |
| 327 | A | `apps/web/docs/screenshots/wallet/07-tour-send-review-390-tr.png` | screenshots | LOW | PNG |
| 328 | A | `apps/web/docs/screenshots/wallet/08-tour-send-sent-390-en.png` | screenshots | LOW | PNG |
| 329 | A | `apps/web/docs/screenshots/wallet/08-tour-send-sent-390-tr.png` | screenshots | LOW | PNG |
| 330 | A | `apps/web/docs/screenshots/wallet/09-tour-create-390-en.png` | screenshots | LOW | PNG |
| 331 | A | `apps/web/docs/screenshots/wallet/09-tour-create-390-tr.png` | screenshots | LOW | PNG |
| 332 | A | `apps/web/docs/screenshots/wallet/10-tour-share-390-en.png` | screenshots | LOW | PNG |
| 333 | A | `apps/web/docs/screenshots/wallet/10-tour-share-390-tr.png` | screenshots | LOW | PNG |
| 334 | A | `apps/web/docs/screenshots/wallet/10-tour-share-desktop-en.png` | screenshots | LOW | PNG |
| 335 | A | `apps/web/docs/screenshots/wallet/11-tour-review-390-en.png` | screenshots | LOW | PNG |
| 336 | A | `apps/web/docs/screenshots/wallet/11-tour-review-390-tr.png` | screenshots | LOW | PNG |
| 337 | A | `apps/web/docs/screenshots/wallet/12-tour-verified-390-en.png` | screenshots | LOW | PNG |
| 338 | A | `apps/web/docs/screenshots/wallet/12-tour-verified-390-tr.png` | screenshots | LOW | PNG |
| 339 | A | `apps/web/docs/screenshots/wallet/13-tour-receipt-390-en.png` | screenshots | LOW | PNG |
| 340 | A | `apps/web/docs/screenshots/wallet/13-tour-receipt-390-tr.png` | screenshots | LOW | PNG |
| 341 | M | `apps/web/next.config.ts` | CI/config | HIGH | CFG |
| 342 | M | `apps/web/package.json` | dependencies | HIGH | DEP |
| 343 | A | `apps/web/scripts/deploy-preflight.d.mts` | CI/config | HIGH | CFG |
| 344 | A | `apps/web/scripts/deploy-preflight.mjs` | CI/config | HIGH | CFG |
| 345 | A | `apps/web/scripts/phase6b-browser-smoke.mjs` | CI/config | HIGH | CFG |
| 346 | A | `apps/web/scripts/phase6b-qr-benchmark.mjs` | CI/config | HIGH | CFG |
| 347 | A | `apps/web/scripts/phase7-screenshot-smoke.mjs` | CI/config | HIGH | CFG |
| 348 | A | `apps/web/scripts/phase7d-mobile-qa.mjs` | CI/config | HIGH | CFG |
| 349 | A | `apps/web/scripts/phase7f-journey-shots.mjs` | CI/config | HIGH | CFG |
| 350 | A | `apps/web/scripts/phase7g-qa.mjs` | CI/config | HIGH | CFG |
| 351 | A | `apps/web/scripts/phase7h-qa.mjs` | CI/config | HIGH | CFG |
| 352 | A | `apps/web/scripts/phase7i-fixtures.mjs` | CI/config | HIGH | CFG |
| 353 | A | `apps/web/scripts/phase7i-fixtures.tsx` | CI/config | HIGH | CFG |
| 354 | A | `apps/web/scripts/phase7i-qa.mjs` | CI/config | HIGH | CFG |
| 355 | A | `apps/web/src/app/__tests__/home.test.tsx` | tests | MEDIUM | TEST |
| 356 | M | `apps/web/src/app/activity/page.tsx` | frontend | MEDIUM | UI |
| 357 | M | `apps/web/src/app/checkout/[accountId]/page.tsx` | payment/verifier | HIGH | SEC |
| 358 | M | `apps/web/src/app/contacts/page.tsx` | frontend | MEDIUM | UI |
| 359 | A | `apps/web/src/app/demo/handshake/page.tsx` | payment/verifier | HIGH | SEC |
| 360 | M | `apps/web/src/app/demo/page.tsx` | frontend | MEDIUM | UI |
| 361 | M | `apps/web/src/app/error.tsx` | frontend | MEDIUM | UI |
| 362 | M | `apps/web/src/app/globals.css` | frontend | MEDIUM | UI |
| 363 | M | `apps/web/src/app/layout.tsx` | frontend | MEDIUM | UI |
| 364 | M | `apps/web/src/app/loading.tsx` | frontend | MEDIUM | UI |
| 365 | M | `apps/web/src/app/merchant/page.tsx` | payment/verifier | HIGH | SEC |
| 366 | M | `apps/web/src/app/merchant/register/page.tsx` | payment/verifier | HIGH | SEC |
| 367 | M | `apps/web/src/app/merchant/setup/page.tsx` | payment/verifier | HIGH | SEC |
| 368 | M | `apps/web/src/app/not-found.tsx` | frontend | MEDIUM | UI |
| 369 | M | `apps/web/src/app/page.tsx` | frontend | MEDIUM | UI |
| 370 | M | `apps/web/src/app/pay/[id]/page.tsx` | payment/verifier | HIGH | SEC |
| 371 | M | `apps/web/src/app/pay/page.tsx` | payment/verifier | HIGH | SEC |
| 372 | M | `apps/web/src/app/receipt/[id]/page.tsx` | payment/verifier | HIGH | SEC |
| 373 | M | `apps/web/src/app/receive/page.tsx` | frontend | MEDIUM | UI |
| 374 | M | `apps/web/src/app/recurring/page.tsx` | frontend | MEDIUM | UI |
| 375 | M | `apps/web/src/app/request/new/page.tsx` | payment/verifier | HIGH | SEC |
| 376 | M | `apps/web/src/app/s/[sessionId]/page.tsx` | payment/verifier | HIGH | SEC |
| 377 | M | `apps/web/src/app/scan/page.tsx` | frontend | MEDIUM | UI |
| 378 | M | `apps/web/src/app/send/page.tsx` | wallet/signing | HIGH | SEC |
| 379 | M | `apps/web/src/app/settings/page.tsx` | frontend | MEDIUM | UI |
| 380 | M | `apps/web/src/app/split/page.tsx` | frontend | MEDIUM | UI |
| 381 | A | `apps/web/src/app/wallet/create/page.tsx` | wallet/signing | HIGH | SEC |
| 382 | A | `apps/web/src/app/wallet/page.tsx` | wallet/signing | HIGH | SEC |
| 383 | A | `apps/web/src/app/wallet/restore/page.tsx` | wallet/signing | HIGH | SEC |
| 384 | M | `apps/web/src/components/brand/TaplyIcon.tsx` | frontend | MEDIUM | UI |
| 385 | A | `apps/web/src/components/demo/DemoTour.tsx` | frontend | MEDIUM | UI |
| 386 | A | `apps/web/src/components/experience/Basics.tsx` | frontend | MEDIUM | UI |
| 387 | A | `apps/web/src/components/experience/PaymentProgress.tsx` | frontend | MEDIUM | UI |
| 388 | A | `apps/web/src/components/experience/ReceiptTicket.tsx` | frontend | MEDIUM | UI |
| 389 | A | `apps/web/src/components/experience/RequestTicket.tsx` | frontend | MEDIUM | UI |
| 390 | A | `apps/web/src/components/experience/ReviewSummary.tsx` | frontend | MEDIUM | UI |
| 391 | A | `apps/web/src/components/experience/SharedSession.tsx` | frontend | MEDIUM | UI |
| 392 | A | `apps/web/src/components/experience/__tests__/motion-7g.test.tsx` | tests | MEDIUM | TEST |
| 393 | A | `apps/web/src/components/experience/__tests__/progress.test.ts` | tests | MEDIUM | TEST |
| 394 | A | `apps/web/src/components/experience/__tests__/receipt-ticket.test.tsx` | tests | MEDIUM | TEST |
| 395 | A | `apps/web/src/components/experience/__tests__/shared-session-7g.test.tsx` | tests | MEDIUM | TEST |
| 396 | A | `apps/web/src/components/experience/__tests__/shared-session.test.tsx` | tests | MEDIUM | TEST |
| 397 | A | `apps/web/src/components/experience/progress.ts` | frontend | MEDIUM | UI |
| 398 | M | `apps/web/src/components/feedback/ErrorState.tsx` | frontend | MEDIUM | UI |
| 399 | A | `apps/web/src/components/feedback/InlineNotice.tsx` | frontend | MEDIUM | UI |
| 400 | A | `apps/web/src/components/handshake/HandshakeDemo.tsx` | payment/verifier | HIGH | SEC |
| 401 | A | `apps/web/src/components/handshake/HandshakeParts.tsx` | payment/verifier | HIGH | SEC |
| 402 | A | `apps/web/src/components/handshake/RoomDemo.tsx` | payment/verifier | HIGH | SEC |
| 403 | A | `apps/web/src/components/handshake/RoomStatusPanel.tsx` | payment/verifier | HIGH | SEC |
| 404 | A | `apps/web/src/components/handshake/SessionEntry.tsx` | payment/verifier | HIGH | SEC |
| 405 | A | `apps/web/src/components/handshake/__tests__/handshake-ui.test.tsx` | tests | MEDIUM | TEST |
| 406 | A | `apps/web/src/components/handshake/__tests__/room-ui.test.tsx` | tests | MEDIUM | TEST |
| 407 | A | `apps/web/src/components/home/RecentActivity.tsx` | frontend | MEDIUM | UI |
| 408 | A | `apps/web/src/components/merchant/CheckoutView.tsx` | payment/verifier | HIGH | SEC |
| 409 | A | `apps/web/src/components/merchant/DiscoveryQr.tsx` | payment/verifier | HIGH | SEC |
| 410 | A | `apps/web/src/components/merchant/MerchantParts.tsx` | payment/verifier | HIGH | SEC |
| 411 | A | `apps/web/src/components/merchant/MerchantScreens.tsx` | payment/verifier | HIGH | SEC |
| 412 | A | `apps/web/src/components/merchant/RecentSales.tsx` | payment/verifier | HIGH | SEC |
| 413 | A | `apps/web/src/components/merchant/__tests__/checkout.test.tsx` | tests | MEDIUM | TEST |
| 414 | A | `apps/web/src/components/merchant/__tests__/merchant.test.tsx` | tests | MEDIUM | TEST |
| 415 | A | `apps/web/src/components/payments/CreateRequest.tsx` | payment/verifier | HIGH | SEC |
| 416 | A | `apps/web/src/components/payments/PaymentParts.tsx` | payment/verifier | HIGH | SEC |
| 417 | A | `apps/web/src/components/payments/PaymentScreen.tsx` | payment/verifier | HIGH | SEC |
| 418 | A | `apps/web/src/components/payments/QrCode.tsx` | payment/verifier | HIGH | SEC |
| 419 | A | `apps/web/src/components/payments/ReceiptScreen.tsx` | payment/verifier | HIGH | SEC |
| 420 | A | `apps/web/src/components/payments/__tests__/create-request.test.tsx` | tests | MEDIUM | TEST |
| 421 | A | `apps/web/src/components/payments/__tests__/freshness.test.tsx` | tests | MEDIUM | TEST |
| 422 | A | `apps/web/src/components/payments/__tests__/merchant-verified-receipt.test.tsx` | tests | MEDIUM | TEST |
| 423 | A | `apps/web/src/components/payments/__tests__/mobile-receipt.test.tsx` | tests | MEDIUM | TEST |
| 424 | A | `apps/web/src/components/payments/__tests__/payment-screen.test.tsx` | tests | MEDIUM | TEST |
| 425 | A | `apps/web/src/components/payments/__tests__/receipt-verification.test.tsx` | tests | MEDIUM | TEST |
| 426 | A | `apps/web/src/components/payments/__tests__/redirect-recovery.test.tsx` | tests | MEDIUM | TEST |
| 427 | A | `apps/web/src/components/payments/__tests__/shared-journey.test.tsx` | tests | MEDIUM | TEST |
| 428 | A | `apps/web/src/components/primitives/Button.tsx` | frontend | MEDIUM | UI |
| 429 | M | `apps/web/src/components/primitives/Surface.tsx` | frontend | MEDIUM | UI |
| 430 | A | `apps/web/src/components/scan/PayEntry.tsx` | frontend | MEDIUM | UI |
| 431 | A | `apps/web/src/components/scan/QrScanner.tsx` | frontend | MEDIUM | UI |
| 432 | A | `apps/web/src/components/scan/__tests__/qr-scanner.test.tsx` | tests | MEDIUM | TEST |
| 433 | A | `apps/web/src/components/send/SendFlow.tsx` | wallet/signing | HIGH | SEC |
| 434 | A | `apps/web/src/components/send/SendParts.tsx` | wallet/signing | HIGH | SEC |
| 435 | A | `apps/web/src/components/send/__tests__/send-flow.test.tsx` | tests | MEDIUM | TEST |
| 436 | M | `apps/web/src/components/shell/AppShell.tsx` | frontend | MEDIUM | UI |
| 437 | A | `apps/web/src/components/shell/ComingSoon.tsx` | frontend | MEDIUM | UI |
| 438 | A | `apps/web/src/components/shell/Icons.tsx` | frontend | MEDIUM | UI |
| 439 | D | `apps/web/src/components/shell/RouteScaffold.tsx` | frontend | MEDIUM | UI |
| 440 | A | `apps/web/src/components/shell/Sheet.tsx` | frontend | MEDIUM | UI |
| 441 | A | `apps/web/src/components/shell/__tests__/app-shell.test.tsx` | tests | MEDIUM | TEST |
| 442 | M | `apps/web/src/components/status/StatusBadge.tsx` | frontend | MEDIUM | UI |
| 443 | A | `apps/web/src/components/wallet/AccountChip.tsx` | wallet/signing | HIGH | SEC |
| 444 | A | `apps/web/src/components/wallet/BalanceCard.tsx` | wallet/signing | HIGH | SEC |
| 445 | A | `apps/web/src/components/wallet/ReceiveCard.tsx` | wallet/signing | HIGH | SEC |
| 446 | A | `apps/web/src/components/wallet/WalletConnect.tsx` | wallet/signing | HIGH | SEC |
| 447 | A | `apps/web/src/components/wallet/WalletKind.tsx` | wallet/signing | HIGH | SEC |
| 448 | A | `apps/web/src/components/wallet/WalletOnboarding.tsx` | wallet/signing | HIGH | SEC |
| 449 | A | `apps/web/src/components/wallet/__tests__/wallet-ux.test.tsx` | tests | MEDIUM | TEST |
| 450 | A | `apps/web/src/components/wallet/taply/CreateWalletFlow.tsx` | wallet/signing | HIGH | SEC |
| 451 | A | `apps/web/src/components/wallet/taply/RestoreWalletFlow.tsx` | wallet/signing | HIGH | SEC |
| 452 | A | `apps/web/src/components/wallet/taply/TaplyHomeCard.tsx` | wallet/signing | HIGH | SEC |
| 453 | A | `apps/web/src/components/wallet/taply/TaplyReceive.tsx` | wallet/signing | HIGH | SEC |
| 454 | A | `apps/web/src/components/wallet/taply/TaplySend.tsx` | wallet/signing | HIGH | SEC |
| 455 | A | `apps/web/src/components/wallet/taply/TaplyWalletProvider.tsx` | wallet/signing | HIGH | SEC |
| 456 | A | `apps/web/src/components/wallet/taply/TaplyWalletUi.tsx` | wallet/signing | HIGH | SEC |
| 457 | A | `apps/web/src/components/wallet/taply/__tests__/passphrase.test.ts` | tests | MEDIUM | TEST |
| 458 | A | `apps/web/src/components/wallet/taply/__tests__/taply-wallet-ui.test.tsx` | tests | MEDIUM | TEST |
| 459 | A | `apps/web/src/components/wallet/taply/mode.ts` | wallet/signing | HIGH | SEC |
| 460 | A | `apps/web/src/components/wallet/taply/passphrase.ts` | wallet/signing | HIGH | SEC |
| 461 | M | `apps/web/src/env.d.ts` | frontend | MEDIUM | UI |
| 462 | A | `apps/web/src/lib/deploy/__tests__/preflight.test.ts` | tests | MEDIUM | TEST |
| 463 | M | `apps/web/src/lib/flags/features.ts` | payment/verifier | HIGH | SEC |
| 464 | A | `apps/web/src/lib/handshake/__tests__/handshake.test.ts` | tests | MEDIUM | TEST |
| 465 | A | `apps/web/src/lib/handshake/__tests__/http-reader.test.ts` | tests | MEDIUM | TEST |
| 466 | A | `apps/web/src/lib/handshake/__tests__/room-reducer-parity.test.ts` | tests | MEDIUM | TEST |
| 467 | A | `apps/web/src/lib/handshake/__tests__/room.test.ts` | tests | MEDIUM | TEST |
| 468 | A | `apps/web/src/lib/handshake/adapter.ts` | payment/verifier | HIGH | SEC |
| 469 | A | `apps/web/src/lib/handshake/http-reader.ts` | payment/verifier | HIGH | SEC |
| 470 | A | `apps/web/src/lib/handshake/present.ts` | payment/verifier | HIGH | SEC |
| 471 | A | `apps/web/src/lib/handshake/room.ts` | payment/verifier | HIGH | SEC |
| 472 | A | `apps/web/src/lib/hooks/browser.ts` | frontend | MEDIUM | UI |
| 473 | M | `apps/web/src/lib/i18n/__tests__/dictionaries.test.ts` | tests | MEDIUM | TEST |
| 474 | A | `apps/web/src/lib/i18n/commerce-types.ts` | frontend | MEDIUM | UI |
| 475 | A | `apps/web/src/lib/i18n/dictionaries/commerce-en.ts` | frontend | MEDIUM | UI |
| 476 | A | `apps/web/src/lib/i18n/dictionaries/commerce-tr.ts` | frontend | MEDIUM | UI |
| 477 | M | `apps/web/src/lib/i18n/dictionaries/en.ts` | frontend | MEDIUM | UI |
| 478 | A | `apps/web/src/lib/i18n/dictionaries/room-copy.ts` | frontend | MEDIUM | UI |
| 479 | M | `apps/web/src/lib/i18n/dictionaries/tr.ts` | frontend | MEDIUM | UI |
| 480 | M | `apps/web/src/lib/i18n/index.ts` | frontend | MEDIUM | UI |
| 481 | M | `apps/web/src/lib/i18n/types.ts` | frontend | MEDIUM | UI |
| 482 | A | `apps/web/src/lib/merchant/__tests__/discovery.test.ts` | tests | MEDIUM | TEST |
| 483 | A | `apps/web/src/lib/merchant/__tests__/journey-status.test.ts` | tests | MEDIUM | TEST |
| 484 | A | `apps/web/src/lib/merchant/__tests__/journey.test.ts` | tests | MEDIUM | TEST |
| 485 | A | `apps/web/src/lib/merchant/discovery.ts` | payment/verifier | HIGH | SEC |
| 486 | A | `apps/web/src/lib/merchant/journey.ts` | payment/verifier | HIGH | SEC |
| 487 | A | `apps/web/src/lib/mock/demo-journey.ts` | frontend | MEDIUM | UI |
| 488 | A | `apps/web/src/lib/mock/handshake-demo.ts` | payment/verifier | HIGH | SEC |
| 489 | A | `apps/web/src/lib/mock/room-demo.ts` | frontend | MEDIUM | UI |
| 490 | A | `apps/web/src/lib/near/__tests__/near.test.ts` | tests | MEDIUM | TEST |
| 491 | A | `apps/web/src/lib/near/__tests__/use-native-balance.test.tsx` | tests | MEDIUM | TEST |
| 492 | A | `apps/web/src/lib/near/account.ts` | payment/verifier | HIGH | SEC |
| 493 | A | `apps/web/src/lib/near/balance.ts` | payment/verifier | HIGH | SEC |
| 494 | A | `apps/web/src/lib/near/client.ts` | payment/verifier | HIGH | SEC |
| 495 | A | `apps/web/src/lib/near/config.ts` | payment/verifier | HIGH | SEC |
| 496 | A | `apps/web/src/lib/near/use-native-balance.ts` | payment/verifier | HIGH | SEC |
| 497 | A | `apps/web/src/lib/payments/__tests__/context-sync.test.tsx` | tests | MEDIUM | TEST |
| 498 | A | `apps/web/src/lib/payments/__tests__/creation-gate.test.ts` | tests | MEDIUM | TEST |
| 499 | A | `apps/web/src/lib/payments/__tests__/follow-up.test.ts` | tests | MEDIUM | TEST |
| 500 | A | `apps/web/src/lib/payments/__tests__/journal-lock.test.ts` | tests | MEDIUM | TEST |
| 501 | M | `apps/web/src/lib/payments/__tests__/map-chain-state.test.ts` | tests | MEDIUM | TEST |
| 502 | A | `apps/web/src/lib/payments/__tests__/pay-link.test.ts` | tests | MEDIUM | TEST |
| 503 | A | `apps/web/src/lib/payments/__tests__/payments-core.test.ts` | tests | MEDIUM | TEST |
| 504 | A | `apps/web/src/lib/payments/__tests__/qr-security.test.ts` | tests | MEDIUM | TEST |
| 505 | A | `apps/web/src/lib/payments/__tests__/scan-input.test.ts` | tests | MEDIUM | TEST |
| 506 | A | `apps/web/src/lib/payments/__tests__/unknown-outcome.test.ts` | tests | MEDIUM | TEST |
| 507 | A | `apps/web/src/lib/payments/__tests__/use-payment-request.test.tsx` | tests | MEDIUM | TEST |
| 508 | A | `apps/web/src/lib/payments/__tests__/wallet-return.test.ts` | tests | MEDIUM | TEST |
| 509 | A | `apps/web/src/lib/payments/context.tsx` | payment/verifier | HIGH | SEC |
| 510 | A | `apps/web/src/lib/payments/create.ts` | payment/verifier | HIGH | SEC |
| 511 | A | `apps/web/src/lib/payments/creation-gate.ts` | payment/verifier | HIGH | SEC |
| 512 | A | `apps/web/src/lib/payments/follow-up.ts` | payment/verifier | HIGH | SEC |
| 513 | A | `apps/web/src/lib/payments/freshness.ts` | payment/verifier | HIGH | SEC |
| 514 | A | `apps/web/src/lib/payments/intent.ts` | payment/verifier | HIGH | SEC |
| 515 | A | `apps/web/src/lib/payments/journal-lock.ts` | payment/verifier | HIGH | SEC |
| 516 | A | `apps/web/src/lib/payments/journal.ts` | payment/verifier | HIGH | SEC |
| 517 | M | `apps/web/src/lib/payments/map-chain-state.ts` | payment/verifier | HIGH | SEC |
| 518 | A | `apps/web/src/lib/payments/pay-link.ts` | payment/verifier | HIGH | SEC |
| 519 | A | `apps/web/src/lib/payments/submit.ts` | payment/verifier | HIGH | SEC |
| 520 | A | `apps/web/src/lib/payments/use-payment-request.ts` | payment/verifier | HIGH | SEC |
| 521 | A | `apps/web/src/lib/payments/wallet-return.ts` | wallet/signing | HIGH | SEC |
| 522 | A | `apps/web/src/lib/qr/__tests__/decoder.test.ts` | tests | MEDIUM | TEST |
| 523 | A | `apps/web/src/lib/qr/__tests__/encode.test.ts` | tests | MEDIUM | TEST |
| 524 | A | `apps/web/src/lib/qr/__tests__/roundtrip.test.ts` | tests | MEDIUM | TEST |
| 525 | A | `apps/web/src/lib/qr/camera.ts` | payment/verifier | HIGH | SEC |
| 526 | A | `apps/web/src/lib/qr/decode-worker.ts` | payment/verifier | HIGH | SEC |
| 527 | A | `apps/web/src/lib/qr/decoder.ts` | payment/verifier | HIGH | SEC |
| 528 | A | `apps/web/src/lib/qr/encode.ts` | payment/verifier | HIGH | SEC |
| 529 | A | `apps/web/src/lib/share/__tests__/origin.test.ts` | tests | MEDIUM | TEST |
| 530 | A | `apps/web/src/lib/share/origin.ts` | payment/verifier | HIGH | SEC |
| 531 | A | `apps/web/src/lib/share/use-share-origin.ts` | payment/verifier | HIGH | SEC |
| 532 | A | `apps/web/src/lib/verify/__tests__/fake-chain.ts` | tests | MEDIUM | TEST |
| 533 | A | `apps/web/src/lib/verify/__tests__/fake-locator.ts` | tests | MEDIUM | TEST |
| 534 | A | `apps/web/src/lib/verify/__tests__/fixtures/testnet/README.md` | tests | MEDIUM | TEST |
| 535 | A | `apps/web/src/lib/verify/__tests__/fixtures/testnet/failed-call-with-refunds.json` | tests | MEDIUM | TEST |
| 536 | A | `apps/web/src/lib/verify/__tests__/fixtures/testnet/final-block.json` | tests | MEDIUM | TEST |
| 537 | A | `apps/web/src/lib/verify/__tests__/fixtures/testnet/linkdrop-create-account-callback.json` | tests | MEDIUM | TEST |
| 538 | A | `apps/web/src/lib/verify/__tests__/http-history.test.ts` | tests | MEDIUM | TEST |
| 539 | A | `apps/web/src/lib/verify/__tests__/instant-receipt.test.ts` | tests | MEDIUM | TEST |
| 540 | A | `apps/web/src/lib/verify/__tests__/locate-funding.live.test.ts` | tests | MEDIUM | TEST |
| 541 | A | `apps/web/src/lib/verify/__tests__/locate-funding.test.ts` | tests | MEDIUM | TEST |
| 542 | A | `apps/web/src/lib/verify/__tests__/rpc-bounded.test.ts` | tests | MEDIUM | TEST |
| 543 | A | `apps/web/src/lib/verify/__tests__/rpc.test.ts` | tests | MEDIUM | TEST |
| 544 | A | `apps/web/src/lib/verify/__tests__/testnet-compat.test.ts` | tests | MEDIUM | TEST |
| 545 | A | `apps/web/src/lib/verify/__tests__/use-funding-locator.test.tsx` | tests | MEDIUM | TEST |
| 546 | A | `apps/web/src/lib/verify/instant-receipt.ts` | payment/verifier | HIGH | SEC |
| 547 | A | `apps/web/src/lib/verify/locate-funding.ts` | payment/verifier | HIGH | SEC |
| 548 | A | `apps/web/src/lib/verify/references.ts` | payment/verifier | HIGH | SEC |
| 549 | A | `apps/web/src/lib/verify/rpc.ts` | payment/verifier | HIGH | SEC |
| 550 | A | `apps/web/src/lib/verify/use-funding-locator.ts` | payment/verifier | HIGH | SEC |
| 551 | A | `apps/web/src/lib/verify/use-receipt-verification.ts` | payment/verifier | HIGH | SEC |
| 552 | A | `apps/web/src/lib/wallet/TAPLY_WALLET.md` | docs | LOW | DOC |
| 553 | A | `apps/web/src/lib/wallet/__tests__/adapter.test.ts` | tests | MEDIUM | TEST |
| 554 | A | `apps/web/src/lib/wallet/__tests__/taply-wallet.test.ts` | tests | MEDIUM | TEST |
| 555 | A | `apps/web/src/lib/wallet/adapter.ts` | wallet/signing | HIGH | SEC |
| 556 | A | `apps/web/src/lib/wallet/near-connect.ts` | wallet/signing | HIGH | SEC |
| 557 | A | `apps/web/src/lib/wallet/provider.tsx` | wallet/signing | HIGH | SEC |
| 558 | A | `apps/web/src/lib/wallet/taply-wallet.ts` | wallet/signing | HIGH | SEC |
| 559 | A | `apps/web/src/test/chain.tsx` | tests | MEDIUM | TEST |
| 560 | A | `apps/web/src/test/fixtures/sandbox/cancelled.json` | tests | MEDIUM | TEST |
| 561 | A | `apps/web/src/test/fixtures/sandbox/failed.json` | tests | MEDIUM | TEST |
| 562 | A | `apps/web/src/test/fixtures/sandbox/in-flight.json` | tests | MEDIUM | TEST |
| 563 | A | `apps/web/src/test/fixtures/sandbox/open-restricted.json` | tests | MEDIUM | TEST |
| 564 | A | `apps/web/src/test/fixtures/sandbox/open.json` | tests | MEDIUM | TEST |
| 565 | A | `apps/web/src/test/fixtures/sandbox/paid-after-retry.json` | tests | MEDIUM | TEST |
| 566 | A | `apps/web/src/test/fixtures/sandbox/paid-restricted.json` | tests | MEDIUM | TEST |
| 567 | A | `apps/web/src/test/qr-worker.ts` | tests | MEDIUM | TEST |
| 568 | A | `contracts/payments-merchant/.cargo/config.toml` | contract | HIGH | SEC |
| 569 | A | `contracts/payments-merchant/.gitignore` | contract | HIGH | SEC |
| 570 | A | `contracts/payments-merchant/Cargo.lock` | dependencies | HIGH | DEP |
| 571 | A | `contracts/payments-merchant/Cargo.toml` | dependencies | HIGH | DEP |
| 572 | A | `contracts/payments-merchant/MERCHANT_V1.md` | docs | LOW | DOC |
| 573 | A | `contracts/payments-merchant/README.md` | docs | LOW | DOC |
| 574 | A | `contracts/payments-merchant/abi.json` | contract | HIGH | SEC |
| 575 | A | `contracts/payments-merchant/abi.merchant-v1.json` | contract | HIGH | SEC |
| 576 | A | `contracts/payments-merchant/rust-toolchain.toml` | contract | HIGH | SEC |
| 577 | A | `contracts/payments-merchant/sandbox/Cargo.lock` | dependencies | HIGH | DEP |
| 578 | A | `contracts/payments-merchant/sandbox/Cargo.toml` | dependencies | HIGH | DEP |
| 579 | A | `contracts/payments-merchant/sandbox/src/lib.rs` | contract | HIGH | SEC |
| 580 | A | `contracts/payments-merchant/sandbox/tests/instant.rs` | tests | MEDIUM | TEST |
| 581 | A | `contracts/payments-merchant/scripts/build-merchant.sh` | CI/config | HIGH | CFG |
| 582 | A | `contracts/payments-merchant/scripts/build.sh` | CI/config | HIGH | CFG |
| 583 | A | `contracts/payments-merchant/scripts/check-exports.mjs` | CI/config | HIGH | CFG |
| 584 | A | `contracts/payments-merchant/scripts/check-wire.mjs` | CI/config | HIGH | CFG |
| 585 | A | `contracts/payments-merchant/scripts/check.sh` | CI/config | HIGH | CFG |
| 586 | A | `contracts/payments-merchant/scripts/preflight-merchant.mjs` | CI/config | HIGH | CFG |
| 587 | A | `contracts/payments-merchant/scripts/sandbox.sh` | CI/config | HIGH | CFG |
| 588 | A | `contracts/payments-merchant/src/lib.rs` | contract | HIGH | SEC |
| 589 | A | `contracts/payments-merchant/src/merchant.rs` | contract | HIGH | SEC |
| 590 | A | `contracts/payments-merchant/src/model.rs` | contract | HIGH | SEC |
| 591 | A | `contracts/payments-merchant/src/tests.rs` | contract | HIGH | SEC |
| 592 | A | `contracts/payments-merchant/test/file-url.test.mjs` | tests | MEDIUM | TEST |
| 593 | A | `contracts/payments-merchant/test/preflight.test.mjs` | tests | MEDIUM | TEST |
| 594 | M | `contracts/payments/.cargo/config.toml` | contract | HIGH | SEC |
| 595 | A | `contracts/payments/MERCHANT_V1.md` | docs | LOW | DOC |
| 596 | A | `contracts/payments/PHASE_3A_VALIDATION.md` | docs | LOW | DOC |
| 597 | A | `contracts/payments/PHASE_7G_DEPLOYMENT.md` | docs | LOW | DOC |
| 598 | A | `contracts/payments/PILOT.md` | docs | LOW | DOC |
| 599 | M | `contracts/payments/README.md` | docs | LOW | DOC |
| 600 | A | `contracts/payments/VALIDATION.md` | docs | LOW | DOC |
| 601 | A | `contracts/payments/abi.merchant-v1.json` | contract | HIGH | SEC |
| 602 | A | `contracts/payments/g1-source-freeze.json` | contract | HIGH | SEC |
| 603 | M | `contracts/payments/sandbox/Cargo.lock` | dependencies | HIGH | DEP |
| 604 | M | `contracts/payments/sandbox/Cargo.toml` | dependencies | HIGH | DEP |
| 605 | M | `contracts/payments/sandbox/tests/instant.rs` | tests | MEDIUM | TEST |
| 606 | A | `contracts/payments/scripts/build-merchant.sh` | CI/config | HIGH | CFG |
| 607 | M | `contracts/payments/scripts/build.sh` | CI/config | HIGH | CFG |
| 608 | A | `contracts/payments/scripts/check-isolation.mjs` | CI/config | HIGH | CFG |
| 609 | M | `contracts/payments/scripts/check.sh` | CI/config | HIGH | CFG |
| 610 | A | `contracts/payments/scripts/preflight-merchant.mjs` | CI/config | HIGH | CFG |
| 611 | M | `contracts/payments/scripts/sandbox.sh` | CI/config | HIGH | CFG |
| 612 | A | `contracts/payments/test/file-url.test.mjs` | tests | MEDIUM | TEST |
| 613 | A | `contracts/payments/test/isolation.test.mjs` | tests | MEDIUM | TEST |
| 614 | A | `contracts/payments/test/preflight.test.mjs` | tests | MEDIUM | TEST |
| 615 | M | `docs/API.md` | docs | LOW | DOC |
| 616 | M | `docs/ARCHITECTURE.md` | docs | LOW | DOC |
| 617 | M | `docs/DEMO_AND_JUDGING.md` | docs | LOW | DOC |
| 618 | M | `docs/EVIDENCE.md` | docs | LOW | DOC |
| 619 | A | `docs/G1_CONTRACT_ISOLATION_REPORT.md` | docs | LOW | DOC |
| 620 | A | `docs/JUDGE_QUICK_START.md` | docs | LOW | DOC |
| 621 | A | `docs/LICENSE_RECOMMENDATION.md` | docs | LOW | DOC |
| 622 | A | `docs/PHASE_7C_POS_INTEGRATION.md` | docs | LOW | DOC |
| 623 | A | `docs/PHASE_7C_SECURITY_REVIEW.md` | docs | LOW | DOC |
| 624 | A | `docs/PHASE_7C_SERVICE.md` | docs | LOW | DOC |
| 625 | A | `docs/PHASE_7E_INTEGRATION_REPORT.md` | docs | LOW | DOC |
| 626 | A | `docs/PHASE_7G_CORE_REPORT.md` | docs | LOW | DOC |
| 627 | A | `docs/PHASE_7G_DEMO_KIT.md` | docs | LOW | DOC |
| 628 | A | `docs/PHASE_7G_FRONTEND_HANDOFF.md` | docs | LOW | DOC |
| 629 | A | `docs/PHASE_7G_INTEGRATION_REPORT.md` | docs | LOW | DOC |
| 630 | A | `docs/PHASE_7G_SECURITY_GATES.md` | docs | LOW | DOC |
| 631 | A | `docs/PHASE_7H_CORE_REPORT.md` | docs | LOW | DOC |
| 632 | A | `docs/PHASE_7H_INTEGRATION_REPORT.md` | docs | LOW | DOC |
| 633 | A | `docs/PHASE_7H_RELEASE_CHECKLIST.md` | docs | LOW | DOC |
| 634 | A | `docs/PHASE_7H_RELEASE_REPORT.md` | docs | LOW | DOC |
| 635 | A | `docs/PHASE_7I_UX_REPORT.md` | docs | LOW | DOC |
| 636 | A | `docs/PHASE_7_COMMERCE_PLAN.md` | docs | LOW | DOC |
| 637 | A | `docs/PHASE_7_FRONTEND_HANDOFF.md` | docs | LOW | DOC |
| 638 | A | `docs/PHASE_7_SESSION_ENGINE.md` | docs | LOW | DOC |
| 639 | A | `docs/PHASE_7_SHARED_ROOM.md` | docs | LOW | DOC |
| 640 | A | `docs/PHASE_7_TEST_TRIAGE.md` | docs | LOW | DOC |
| 641 | M | `docs/PRODUCT.md` | docs | LOW | DOC |
| 642 | A | `docs/RELEASE_DEMO.md` | docs | LOW | DOC |
| 643 | A | `docs/RELEASE_READINESS.md` | docs | LOW | DOC |
| 644 | A | `docs/SUBMISSION_CHECKLIST.md` | docs | LOW | DOC |
| 645 | A | `docs/UX_ONE_TAP_REDESIGN.md` | docs | LOW | DOC |
| 646 | A | `docs/evidence/instant-pay-2026-11-01-receipt.json` | docs | LOW | DOC |
| 647 | A | `packages/near-client/PHASE_5B.md` | docs | LOW | DOC |
| 648 | M | `packages/near-client/README.md` | docs | LOW | DOC |
| 649 | A | `packages/near-client/browser-tests/index.html` | tests | MEDIUM | TEST |
| 650 | A | `packages/near-client/browser-tests/main.js` | tests | MEDIUM | TEST |
| 651 | A | `packages/near-client/browser-tests/run.mjs` | tests | MEDIUM | TEST |
| 652 | A | `packages/near-client/evidence/phase5b-2026-11-01/benchmark.json` | frontend | MEDIUM | UI |
| 653 | A | `packages/near-client/evidence/phase5b-2026-11-01/browser-cors.json` | frontend | MEDIUM | UI |
| 654 | A | `packages/near-client/evidence/phase5b-2026-11-01/fastnear-testnet.json` | frontend | MEDIUM | UI |
| 655 | A | `packages/near-client/evidence/phase5b-2026-11-01/near-public-testnet.json` | frontend | MEDIUM | UI |
| 656 | A | `packages/near-client/evidence/phase5b-2026-11-01/summary.json` | frontend | MEDIUM | UI |
| 657 | M | `packages/near-client/package.json` | dependencies | HIGH | DEP |
| 658 | A | `packages/near-client/scripts/benchmark-read-reliability.mjs` | CI/config | HIGH | CFG |
| 659 | A | `packages/near-client/scripts/check-rpc-cors.mjs` | CI/config | HIGH | CFG |
| 660 | A | `packages/near-client/scripts/pilot-read.mjs` | CI/config | HIGH | CFG |
| 661 | A | `packages/near-client/scripts/reproduce-instant-proof.mjs` | CI/config | HIGH | CFG |
| 662 | A | `packages/near-client/scripts/rpc-browser-check.html` | CI/config | HIGH | CFG |
| 663 | M | `packages/near-client/src/client.ts` | payment/verifier | HIGH | SEC |
| 664 | A | `packages/near-client/src/contract-errors.ts` | payment/verifier | HIGH | SEC |
| 665 | A | `packages/near-client/src/contract.ts` | payment/verifier | HIGH | SEC |
| 666 | M | `packages/near-client/src/index.ts` | payment/verifier | HIGH | SEC |
| 667 | A | `packages/near-client/src/merchant.ts` | payment/verifier | HIGH | SEC |
| 668 | A | `packages/near-client/src/room-sync.ts` | payment/verifier | HIGH | SEC |
| 669 | M | `packages/near-client/src/rpc.ts` | payment/verifier | HIGH | SEC |
| 670 | M | `packages/near-client/src/transactions.ts` | payment/verifier | HIGH | SEC |
| 671 | M | `packages/near-client/src/types.ts` | payment/verifier | HIGH | SEC |
| 672 | M | `packages/near-client/src/validation.ts` | payment/verifier | HIGH | SEC |
| 673 | A | `packages/near-client/src/wallet-auth.ts` | wallet/signing | HIGH | SEC |
| 674 | A | `packages/near-client/src/wallet-backend.ts` | wallet/signing | HIGH | SEC |
| 675 | A | `packages/near-client/src/wallet-chain.ts` | wallet/signing | HIGH | SEC |
| 676 | A | `packages/near-client/src/wallet-journal.ts` | wallet/signing | HIGH | SEC |
| 677 | A | `packages/near-client/src/wallet-sdk-rpc.ts` | wallet/signing | HIGH | SEC |
| 678 | A | `packages/near-client/src/wallet-transfer.ts` | wallet/signing | HIGH | SEC |
| 679 | A | `packages/near-client/src/wallet-vault.ts` | wallet/signing | HIGH | SEC |
| 680 | M | `packages/near-client/test-types/public.ts` | frontend | MEDIUM | UI |
| 681 | A | `packages/near-client/test/contract.test.mjs` | tests | MEDIUM | TEST |
| 682 | A | `packages/near-client/test/fixtures/request-cancelled-unfunded.json` | tests | MEDIUM | TEST |
| 683 | A | `packages/near-client/test/fixtures/request-final-paid.json` | tests | MEDIUM | TEST |
| 684 | A | `packages/near-client/test/fixtures/request-open-restricted.json` | tests | MEDIUM | TEST |
| 685 | A | `packages/near-client/test/fixtures/request-open.json` | tests | MEDIUM | TEST |
| 686 | A | `packages/near-client/test/fixtures/request-payout-failed.json` | tests | MEDIUM | TEST |
| 687 | A | `packages/near-client/test/fixtures/request-payout-in-flight.json` | tests | MEDIUM | TEST |
| 688 | A | `packages/near-client/test/http-history.test.mjs` | tests | MEDIUM | TEST |
| 689 | A | `packages/near-client/test/merchant.test.mjs` | tests | MEDIUM | TEST |
| 690 | A | `packages/near-client/test/pilot-read.test.mjs` | tests | MEDIUM | TEST |
| 691 | A | `packages/near-client/test/reliability.test.mjs` | tests | MEDIUM | TEST |
| 692 | A | `packages/near-client/test/room-sync.test.mjs` | tests | MEDIUM | TEST |
| 693 | A | `packages/near-client/test/rpc-json.test.mjs` | tests | MEDIUM | TEST |
| 694 | A | `packages/near-client/test/wallet-auth.test.mjs` | tests | MEDIUM | TEST |
| 695 | A | `packages/near-client/test/wallet-chain.test.mjs` | tests | MEDIUM | TEST |
| 696 | A | `packages/near-client/test/wallet-payment-signer.test.mjs` | tests | MEDIUM | TEST |
| 697 | A | `packages/near-client/test/wallet-signer-fixture.mjs` | tests | MEDIUM | TEST |
| 698 | A | `packages/near-client/test/wallet-signer.test.mjs` | tests | MEDIUM | TEST |
| 699 | A | `packages/near-client/test/wallet-transfer.test.mjs` | tests | MEDIUM | TEST |
| 700 | A | `packages/near-client/test/wallet-vault.test.mjs` | tests | MEDIUM | TEST |
| 701 | A | `packages/near-client/verification-tests/receipt-adversarial.test.ts` | tests | MEDIUM | TEST |
| 702 | A | `packages/near-client/verification-tests/tsconfig.json` | tests | MEDIUM | TEST |
| 703 | A | `packages/near-client/verification-tests/vitest.config.mts` | tests | MEDIUM | TEST |
| 704 | M | `pnpm-lock.yaml` | dependencies | HIGH | DEP |
