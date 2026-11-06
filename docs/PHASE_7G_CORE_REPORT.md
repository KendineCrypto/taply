# Phase 7G CORE implementation report

2026-11-05, Europe/Istanbul. Repository `KendineCrypto/taply`, branch
`feature/phase7g-core`, exact base
`5999d0c2bee67839e1ba55546b0021b22f2d0ce4`. Safe local implementation and
verification only. **Production auth and real Testnet G2 remain NO-GO.**

## Preparation and environment

Initial cloud snapshot was clean on `work` at `86bd54b`, not the requested base.
The base object was absent. Fetched `feature/phase7-integration` from the verified
origin and created a new branch at exact `5999d0c`; no other branch was moved.
No implementation occurred on main/integration/UX. The managed environment was
running/connected with current observations and enforced package-manager/S3
network policy. Fetch/download commands needed execution-tool network access.

Read AGENTS, mandatory product/security/state-machine/API/architecture/testing
context and Phase 7C/shared-room/7E handoffs; inspected actual Rust, shared schema,
ABI, API persistence/auth/session engine, near-client and existing tests. The
[G2 acceptance matrix](PHASE_7G_SECURITY_GATES.md) records the ten required proofs.

Retried sandbox dependency installation. Rust download reached the allowed S3
host but near-sandbox's ureq certificate store rejected the proxy certificate.
Downloaded the exact pinned nearcore 2.14.0 archive using curl, inherited proxy
and system CA trust, with TLS verification enabled. Supplied its local binary via
NEAR_SANDBOX_BIN_PATH. Compilation then passed, but every node startup failed:
required NOFILE `(65535,65535)`, available hard/soft `(16384,16384)`, Operation not
permitted. This is an environment block, not passing sandbox validation. No node
patch, TLS disablement, test skipping or fabricated receipt was used.

The approved pilot deployment and its recorded pins were not modified. No fresh
chain observation is claimed. Important artifact finding: the initial cloud
`artifacts/payments.wasm` was already an **unapproved** build with SHA-256
`245068f8871d419971b598fd30e0346e935b173bdab9dd547124dc470455a12c`;
the default fault artifact was `7fc7cf2c160e62d5eb54c7a24694d62ebe3e91dfc8210cc127e2931ba11c9222`.
Both remained byte-for-byte unchanged. The historical approved pilot remains
`taply-pay-pilot-1.testnet`, code hash
`BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`, SHA-256
`a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2`.
Do not deploy the pre-existing unapproved cloud artifact.

## Stages and implementation

| Stage | Completed safe work / limit |
| --- | --- |
| 1 | Repository/base/environment verified; security baseline and acceptance matrix written |
| 2 | Isolated versioned merchant contract, sale/nonce replay protection, exact storage and adversarial unit/sandbox source; runtime sandbox blocked |
| 3 | Independent pinned finalized request reader, strict session/terms matching, two-client malicious-server harness and candidate-only call preparation |
| 4 | NEP-413 specification review, capability detection, exact challenge/response compatibility contract and key-rotation/revocation fixtures; real wallets untested |
| 5 | External freshness interface, fenced new-format repository/coordinator, deliberate restore/uncertain-commit and independent-process tests; no production provider/integration/migration |
| 6 | Client room replacement reducer, auth-generation/cursor fencing, visibility/reconnect two-client harness and SSE byte bound; existing durable multi-worker/restart tests retained |
| 7 | Versioned ABI, reproducible separate WASM build, offline byte/ABI preflight, deployment/init/security/device/incident runbook; no live action |
| 8 | Available strict checks/regressions run, limits retained, frontend/security/report handoff and local commits |

The `merchant-bound-v1` feature builds **0.5.0-merchant.1** separately. Default
0.4.0 retains HANDSHAKE_DISABLED and all ordinary Instant semantics. No frozen
IntentTerms/ContractRequest/method argument/hash/event schema was changed. Config
version/handshake capability differ only in the candidate; its separate schema
is additive and the old config parser deliberately refuses it. Source/ABI details:
[MERCHANT_V1](../contracts/payments/MERCHANT_V1.md),
[candidate ABI](../contracts/payments/abi.merchant-v1.json).

Merchant must equal creator/receiver, with direct creator signature and exact
storage deposit. Both binding values must be present together, session must be
valid UUIDv4/32-byte nonce with valid bounded expiry. Commitment is the frozen v1
hash. Permanent creator-scoped session-ID tombstones prevent a second request for
the same sale even with a fresh creation nonce. Request records still prevent
nonce replay. No terms/substitution/admin payout/backend custody method exists.
The existing fixed-size record, exact-principal, reserved transfer, private
nonce-checked callback and recipient-only recorded-failure retry are reused.
Unknown callback stays in flight; no duplicate payout/refund escape is added.

Candidate production WASM SHA-256:
`6af31a17a3c425d9a825084e2961a4bf30e22b82dc30e6fce190890871845a5c`.
Candidate size: 347,611 bytes; NEAR code hash:
`8CVDZRmJh9fyVmjmT6xk1erDnG1HwVuzwbzmTmCtc84j`.
Two builds produced identical production and fault hashes. These bytes are
unapproved, not deployed. Actual gas/runtime/storage acceptance still requires
sandbox success; mock storage accounting tests are not promoted into node proof.

Backend changes add a controlled async external-freshness protocol and an SSE
catch-up cap. No HTTP route/body, production factory or listener was enabled.
The shipped synchronous encrypted auth/room store is **still rollback-vulnerable**;
new fencing is an isolated interface/harness requiring external infrastructure
and real async integration. Existing vulnerable-restore tests remain explicit.
New client helpers have no signer/network transaction authority and are not wired
into web routes. [Frontend handoff](PHASE_7G_FRONTEND_HANDOFF.md) describes exact
exports, schemas, request expectations, errors, manual wallet tests and integration.

## Security QA and actual results

Pinned tools observed: Node 24.22.2, pnpm 11.5.0, Rust 1.95.0. Frozen install
passed without changing manifests/root lockfile. API runs separately from the
workspace manifest. POSIX permissions test executed here and was not skipped.

| Command/check | Actual result |
| --- | --- |
| `pnpm check` | **FAIL** at Next/Turbopack production build fetching Inter from fonts.googleapis.com; type/lint/test stages after build did not run in this command |
| `pnpm -r --sort run typecheck` | PASS: shared/near-client strict source and type fixtures, web types |
| `pnpm lint` | PASS |
| `pnpm test` | PASS all workspace suites |
| shared, explicit Node run | **92 passed, 0 failed, 0 skipped** |
| near-client, explicit Node run | **167 passed, 0 failed, 0 skipped** |
| web, Vitest JSON report | **665 passed, 0 failed, 0 pending** |
| API, explicit Node run with `--test-isolation=none` | **66 passed, 0 failed, 0 skipped** |
| `node --test apps/api/test/*.test.mts` | PASS, 14 file-level results in this runtime; individual count above |
| API standalone strict tsc / ESLint | PASS, no diagnostics |
| Rust default `cargo test --locked --lib` | **15 passed, 0 failed, 0 ignored** |
| Rust `--features merchant-bound-v1` unit suite | **19 passed, 0 failed, 0 ignored** |
| Rust fmt (contract/sandbox) and Clippy `-D warnings` (default/candidate/sandbox runner) | PASS |
| Candidate production/fault WASM builds and repeat hash comparison | PASS |
| Offline candidate SHA-256/base58/12-export preflight test | **1 passed, 0 failed** |
| Existing sandbox suite retry | **0 passed, 9 failed before contract execution**, NOFILE startup block |
| Candidate sandbox suite | **0 passed, 10 failed before contract execution**, same startup block |
| Real wallet / deployed candidate / physical two-device G2 | NOT RUN; no approval/evidence |

No successful production web build is claimed. Next reported a Google Fonts
connection failure; that host is outside this environment's configured allowlist.
Frontend source was not changed to bypass it. Local unit/crypto/RPC fixtures are
labelled synthetic. Actual failed tests are reported, not reclassified as passes.
No sandbox request snapshots were produced for new candidate wire validation.

Adversarial coverage includes forged merchant/creator/recipient, exact amount and
expiry/hash/session substitution, nonce and session reuse after cancellation,
duplicate funding, exact storage/max u128/64-byte accounts/UTF-8 memo/input bounds,
low gas, wrong/private/stale callback, failed/missing callback, liquidity and
conservation. Reader tests reject wrong genesis/code/block/provenance, stale/future
or inconsistent timestamps, malformed/duplicate JSON, unauthorized payer policy
and malicious server expectations. Existing receipt/journal tests remain intact.
Auth tests retain wrong-account, signature/key association, browser/origin,
expiry/replay/logout fences and new-login rotation cases. Room tests cover
cross-session/account contamination, out-of-order/duplicate/gap events, stale
auth generation, close/visibility/lease/restart/multi-worker behavior and false
Paid claims. Freshness tests include deliberate valid encrypted restore for
challenge/join/logout decisions, CAS races across independent processes and
uncertain external commit refusal.

## Commits

Each tested implementation slice was committed locally, without push/merge:

- `ca363b0` — versioned merchant contract, immutable binding/sale replay guards.
- `b076359` — independently verified merchant request/session reader.
- `63b4cc0` — wallet NEP-413 compatibility preparation and rotation checks.
- `70c762c` — external freshness CAS/restore model and process tests.
- `13e8ec5` — room client fencing and bounded SSE.
- `ee6f6cc` — separate deployment runbook/ABI artifact preflight.
- `b716a0b` — candidate-only call preparation and maximum resource adversarial QA.

The final documentation commit follows these; obtain its hash with
`git log --oneline feature/phase7g-core`. No apps/web, shared schemas, root
manifests/lockfile, local env files or existing wallet keys were modified.

## Decisions and exact next actions

**Offline coordination/compatibility/model testing: GO**, explicitly synthetic.
**Candidate contract runtime acceptance: NO-GO** until sandbox execution succeeds.
**Actual Testnet G2 and production authentication: NO-GO.** A complete real G2
has not been demonstrated; ordinary Instant Pay remains a separate existing flow.

Remaining blockers: cloud NOFILE and Google Fonts build access; candidate sandbox
and security review; separately approved deployment/account/hash; independently
verified candidate config/quote and frontend signing/receipt integration; signed
merchant discovery; actual NEP-413/mobile/wallet and key-revocation policy evidence;
external non-restorable authority **and async auth/room integration**; trusted
HTTPS/cookies/host ACL/service-key/recovery/load acceptance; actual two-device
funding/payout/callback and independent receipt proof.

Operator can first repair the resource/network environment and rerun the recorded
checks without any blockchain signature. Then review this branch and exact
candidate bytes, authority design and frontend handoff. The full approval sequence
and stop conditions are in [deployment preparation](../contracts/payments/PHASE_7G_DEPLOYMENT.md).
Each real wallet authentication signature, account creation, account funding,
deploy/init, payment/retry and any later upgrade requires a separate concrete
operator review and explicit approval. No push, merge, deploy, real-wallet
signature, live blockchain transaction, funds movement or live-gate enablement
was performed. No private wallet keys were accessed or copied.
