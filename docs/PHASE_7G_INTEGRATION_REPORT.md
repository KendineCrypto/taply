# Phase 7G integration report (Windows)

2026-11-06. Integration performed on the operator's Windows machine after the
Codex Cloud attempt failed on an unreachable proxy (port 8080; no branch or
merge was created there, and that environment was not touched).

**Offline integration: GO (with Rust-side checks BLOCKED, see below).
Real Testnet G2: NO-GO.** Nothing was pushed, merged into an existing branch,
deployed, signed or funded. No live gate was enabled.

## Branch, worktree and commits

| Item | Value |
| --- | --- |
| Worktree | `C:\taply-phase7g-integration` (new, isolated) |
| Branch | `feature/phase7g-integration` (new, local only) |
| Base | `feature/phase7-integration` @ `5999d0c2bee67839e1ba55546b0021b22f2d0ce4` (verified on origin) |
| Core source | `origin/feature/phase7g-core` @ `f284bd863c25cdc55c042295544a87cb6bc6971b` (8 commits) |
| UX source | `origin/feature/phase7g-ux` @ `615f8f1c206080d09252af7f97b970a59ae1da55` (7 commits) |
| Core merge (no-ff, full history) | `fafbff29959b799ad9dcf489a158253ec3d61a07` |
| UX merge (no-ff, full history) | `9a00199e95fca195e55d6c02e46d12b1d500320e` |
| Integration head | the commit that adds this report (on top of `9a00199`; see `git log -1`) |

Both source heads are ancestors of the integration head (`git merge-base
--is-ancestor` checked). 17 commits over the base, 95 files changed
(+6654/−180) before this report. **No conflicts:** core touches
`contracts/payments/**`, `apps/api/**`, `packages/near-client/**` and core docs;
UX touches only `apps/web/**`, `README.md` and `docs/PHASE_7G_DEMO_KIT.md`.

Core commits: `ca363b0` merchant-bound candidate contract, `b076359` finalized
merchant session reader, `63b4cc0` NEP-413 preparation, `70c762c` external
freshness CAS model, `13e8ec5` room client fencing and SSE byte bound, `ee6f6cc`
deployment runbook and offline preflight, `b716a0b` candidate call preparation,
`f284bd8` docs. UX commits: `5f375cf`, `5e661ae`, `213fca7`, `419916b`,
`2ed177c`, `1c71088`, `615f8f1` (see `apps/web/docs/PHASE_7G_UX_REPORT.md`).

Unchanged versus the base: `pnpm-lock.yaml`, root and package manifests,
`apps/web/.env.example`, `apps/web/src/lib/flags/**`, `docs/EVIDENCE.md`,
`docs/evidence/**`, `contracts/payments/abi.json`, `contracts/payments/PILOT.md`.
No existing branch or worktree was modified (the local `feature/phase7g-core`
worktree still sits at `5999d0c` and was left alone).

## Environment

| Tool | Required | Observed |
| --- | --- | --- |
| Node | 24.22.2 | 24.22.2 |
| pnpm | 11.5.0 | 11.5.0 |
| Rust / Cargo | 1.95.0 + wasm32 (`rust-toolchain.toml`) | **Not installed** (no cargo/rustc/rustup on PATH, no `~/.cargo`/`~/.rustup`) |
| GitHub fetch | origin reachable | OK; all three SHAs matched exactly |

Per instructions, no toolchain was installed. Every Rust-dependent check is
reported as **BLOCKED**, not passed.

## Validation results (this machine, merged tree)

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS, no tracked file changed |
| `pnpm check` (brand, build incl. default Next production build, types, lint, tests) | **PASS, exit 0** |
| `packages/shared` tests | **92 passed, 0 failed, 0 skipped** |
| `packages/near-client` tests (incl. new merchant, room-sync, wallet-auth) | **167 passed, 0 failed, 0 skipped** |
| `apps/web` tests (incl. room adapter, locator, status, motion) | **757 passed, 0 failed, 1 skipped** (opt-in live Testnet test) |
| `pnpm --filter @taply/web exec next build --webpack` | **PASS, exit 0** ("Compiled successfully") |
| API `node --test --test-isolation=none apps/api/test/*.test.mts` | **65 passed, 0 failed, 1 skipped** (POSIX permission test, skipped by design on Windows; Codex ran it on Linux) |
| API strict `tsc -p apps/api/tsconfig.json` | PASS |
| API ESLint | PASS |
| Candidate preflight `node --test contracts/payments/test/preflight.test.mjs` | **BLOCKED / 1 failed**: `artifacts/merchant-v1/payments.wasm` is not committed and needs `cargo build`; also a Windows path defect (below) |
| Rust default `cargo test --locked --lib` | **BLOCKED** (no Rust) |
| Rust `--features merchant-bound-v1` tests | **BLOCKED** |
| Rust fmt / Clippy | **BLOCKED** |
| Reproducible candidate WASM builds and hash comparison | **BLOCKED** |
| Default-build byte equality with the approved pilot (`a13d932f…`, `BrR6bioU…`) | **BLOCKED** (not re-verified here) |
| near-workspaces sandbox suites | **BLOCKED** (no Rust; Codex's cloud also failed on NOFILE limits) |

**Totals run here:** 1,081 passed, 0 failed, 2 skipped (both by design), 1
blocked test file, 6 blocked Rust/artifact check groups.

For reference, Codex reported Rust default 15/15, candidate 19/19, fmt and
Clippy clean, two identical candidate builds (SHA-256 `6af31a17…`, code hash
`8CVDZRmJh9fyVmjmT6xk1erDnG1HwVuzwbzmTmCtc84j`) and 0/19 sandbox runs (NOFILE).
Those are Codex's observations from its environment, **not reproduced here**.

## Cross-package compatibility findings

1. **Session commitment and code agree.** Contract candidate:
   `sha256("taply.session.v1\n" + termsHash)`; `@taply/shared`
   `calculateSessionCommitment` uses the same domain hash; the near-client
   merchant reader checks equality; the frontend room presenter derives its code
   with the same shared function. A bound sale will show the same code on the
   contract, near-client and web.
2. **Two room reducers diverge** (frontend `lib/handshake/room.ts`
   `applyRoomSync` vs near-client `applyRoomCatchUp`). An ad-hoc synthetic
   cross-check (temporary, not committed) on identical inputs:

   | Input | Frontend | Near-client |
   | --- | --- | --- |
   | Valid first sync / reset / older cursor | applied / applied / ignored | same |
   | Forged extra field (`paid`) | refused | refused |
   | Event gap after the client cursor | **applied** | refused `ROOM_REFRESH_REQUIRED` |
   | Equal cursor with a different room | **ignored** | refused `ROOM_CURSOR_CONFLICT` |
   | Last event room ≠ snapshot | **applied** | refused `ROOM_CURSOR_CONFLICT` |
   | Non-ISO `emittedAt` | **applied** | refused |
   | 17-digit cursor | **applied** (≤ 20 digits) | refused (≤ 16 digits) |
   | Account not in the room | not checked | refused `SESSION_MISMATCH` |

   Neither reducer can produce payment status, and neither is wired to a route,
   so this is not a merge blocker. **Before activation, the frontend must adopt
   `applyRoomCatchUp` (or match it exactly) and drop its own reducer.**
3. **Config schemas:** the candidate returns `contractVersion 0.5.0-merchant.1`
   and `handshake: true`. The web app's existing config check accepts only the
   0.4.0 pilot shape, so pointing this build at a candidate deployment would
   refuse to sign (fail-closed). Wiring `MerchantContractConfigSchema` is future
   work.
4. **Merchant helpers are not wired:** no `apps/web` file imports
   `createMerchantRequestReader`, `prepareMerchant*`, `prepareWalletAuthentication`,
   `signMessageCapability` or `applyRoomCatchUp`.
5. **Funding locator vs candidate:** the locator matches `pay_instant_native`
   with an `id` argument, which the candidate ABI keeps. Bound-sale receipts
   would still need the verifier's (unchanged) checks; the merchant-bound
   candidate has not been exercised against the verifier (no sandbox).

## Security review

| Area | Finding |
| --- | --- |
| Rollback / freshness | Core adds an external CAS fencing **model** and process tests; the shipped synchronous encrypted auth/room store **remains rollback-vulnerable** (documented in `docs/PHASE_7G_SECURITY_GATES.md`; vulnerability tests kept). **G2 blocker.** |
| Auth | Production factory hardcodes `authenticationAccepted:false` (`apps/api/src/service.mts`); NEP-413 helpers prepare and validate only; no real wallet tested; callback-URL behaviour `direct_only_unverified`. **G2 blocker.** |
| Session binding | Default 0.4.0 keeps `HANDSHAKE_DISABLED` and `sessionCommitment: null`; candidate binding exists only behind `merchant-bound-v1`; candidate bytes unapproved, not deployed, sandbox unrun. **G2 blocker.** |
| Approved pilot contract | Not altered on chain or in pins. All contract source changes are `cfg(feature = "merchant-bound-v1")`-gated; default-build byte equality with the approved hash was **not re-verified** here (no Rust). |
| Payment status | Only finalized contract state and the independent verifier set Paid / Verified Paid; room reducers and the locator cannot (tests on both sides). |
| Wallet signing | Instant signing still gated by flag + on-chain config check; merchant call builders never sign and are unwired; no signMessage added to the WalletAdapter. |
| Mock isolation | Web source-scan test passes: `lib/mock` only in demo surfaces; no live route constructs a room reader. |
| Funding locator | Read-only `block`/`chunk` transport, ≤ 48 calls, candidate-only; verifier allowlist and logic unchanged. Open item: verifier maps FastNEAR 422/408 pruned-history answers to transient. |
| Flags | Handshake, merchant and Instant Pay default OFF; `.env.example` unchanged (`HANDSHAKE=off`, `MERCHANT=off`). |
| Secrets | Diff scan for key/seed/token/email/private-hostname patterns: no hits. No `.env*` (other than `.env.example`), `.wasm`, key, credential or database file added. New tests use runtime `randomBytes` keys only. `.env.local` was not copied into this worktree. |

## Defects found during integration (not fixed here; owner-side)

- `contracts/payments/test/preflight.test.mjs` builds its path with
  `new URL(...).pathname`, which becomes `C:\C:\…` on Windows; use
  `fileURLToPath`. (Codex-owned; left unchanged.)
- Frontend room reducer laxer than the core reducer (finding 2). (Claude-owned;
  left unchanged to keep this an integration-only change.)

## Decisions

- **Offline GO**: the merged tree installs frozen, typechecks, lints, builds
  (Turbopack and webpack) and passes every JS/TS suite that can run here, with
  no regressions and no conflicts. Conditional on the Rust checks below
  passing on a machine with the pinned toolchain before any merge upward.
- **Real Testnet G2: NO-GO.** Blockers: candidate sandbox/runtime acceptance and
  security review; approved separate deployment and hash; production auth with
  real NEP-413 wallet evidence; rollback-fresh auth/room storage; HTTPS/cookie/
  ACL/key/recovery acceptance; frontend wiring of the candidate reader/config/
  room reducer; real two-device funding/payout/callback and independent receipt
  proof.

## Unresolved risks

- Default contract bytes not re-verified against the approved pilot hash in
  this integration (source-level gating reviewed only).
- Candidate contract never executed in a sandbox anywhere.
- Two room reducers with different strictness.
- Rollback-vulnerable production store; no external freshness provider.
- Old receipts on FastNEAR read as transient verifier failures.
- No physical-device run in Phase 7G.

## Exact next steps

1. On a machine with Rust 1.95.0 + `wasm32-unknown-unknown` (and raised NOFILE
   limits for sandbox), in this worktree:
   ```sh
   cd contracts/payments
   cargo test --locked --lib
   cargo test --locked --lib --features merchant-bound-v1
   cargo fmt --check && cargo clippy --locked -- -D warnings
   cargo clippy --locked --features merchant-bound-v1 -- -D warnings
   cargo build --locked --target wasm32-unknown-unknown --release   # compare SHA-256 with a13d932f…
   bash scripts/build-merchant.sh                                   # twice; hashes must match 6af31a17…
   node --test test/preflight.test.mjs                              # after fixing the Windows path, or on POSIX
   ```
   plus the sandbox suites. Record exact outputs.
2. Owner review of this branch; only then decide on pushing
   `feature/phase7g-integration` and a draft PR into `feature/phase7-integration`.
3. Frontend follow-up: replace `applyRoomSync` with near-client
   `applyRoomCatchUp`; wire `MerchantContractConfigSchema` and the merchant
   reader only behind the closed gates.
4. Core follow-up: fix the preflight path; review the verifier transport
   finding.
5. Keep every live gate closed until the G2 blockers above have evidence.
