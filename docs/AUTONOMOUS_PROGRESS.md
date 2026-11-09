# Autonomous progress log

Newest first. Each entry: what changed, exact commands, real outcomes, open items.
Plan: [AUTONOMOUS_MASTER_PLAN.md](AUTONOMOUS_MASTER_PLAN.md).

## How to resume on any machine

```sh
git fetch origin && git checkout claude/kind-cerf-c4n261
# Node 24.22.2 and pnpm 11.5.0 are required (engines are strict).
pnpm install --frozen-lockfile
pnpm check                                   # whole workspace
cd contracts/payments-protected && cargo test --locked --lib -- --test-threads=1
```

## 2026-11-09 — cloud session 1

### Starting point (inspected, not assumed)

- `main` = `release/taplyapp` = `22765d7` (nightly report). Production unchanged since `b67b278`.
- PR #11 merged; PRs #1–#10 still open against old phase branches (all their heads are ancestors of `main`).
- `docs/AUTONOMOUS_MASTER_PLAN.md`, `AUTONOMOUS_PROGRESS.md`, `PRODUCT_COMPLETION_MATRIX.md`
  did **not** exist on any branch: no work from a previous "autonomous completion sprint"
  was pushed beyond what is on `main`. Old `feature/frontend`, `feature/wallet-*`,
  `feature/pilot-core`, `feature/ux-reliability` are superseded by `main`.
- Baseline `pnpm check` on `22765d7` (Node 24.22.2): **exit 0** — shared 92/92,
  near-client 207/207, web 1,112 passed + 1 skipped (73 files).

### Increment 2 — Protected Pay web flow (flag off) + NEP-141 change request

New / changed (all behind `protectedPay`, default OFF; production sets no Protected variables):

- `packages/near-client/src/protected.ts`: `createProtectedReader` (candidate
  `get_config` read anchored to one final block after the code-hash check;
  refuses the G1 pilot). 2 more tests (9 total in `protected.test.mjs`).
- `apps/web/src/lib/protected/`: `buildProtectedView` (cancel window, release
  eligibility and retry derived from chain time of a fresh final read, validated
  by the frozen `PaymentIntentResponseSchema`), `resolveProtectedSetup` +
  `protectedSigningGate` (flag + separate contract + code hash; the
  UNREVIEWED_CANDIDATE problem is waivable only with `NEXT_PUBLIC_TAPLY_PROTECTED_QA=on`),
  `buildProtectedTerms`, data hooks. Countdown helpers in `lib/format/countdown.ts`
  (indicative only; never gates an action).
- Journal: `fund_protected_native`, `cancel_protected`, `release_protected`.
  `reconcile()` explains them from finalized reads (a cancel still LOCKED at/after
  the cutoff can never execute; release is explained only by a committed branch;
  retry covers refund/release failures). Wallet-return matching: release matches on id alone.
- Screens: `/protected/[id]` (consent with the signed window, LOCKED - NOT PAID
  banner, on-chain cutoff, approximate countdown, payer-only cancel, release
  after cutoff, beneficiary retry, refunded vs released wording, no Verified
  claim) and `/protected/new` (amount, window 60 s / 5 min / 15 min / 1 h,
  optional payer). EN + TR copy (`protected-en.ts`, `protected-tr.ts`).
  `/request/new` links to it only when the Protected setup is complete.
- Env (documented in `env.d.ts`, `.env.example`): `NEXT_PUBLIC_TAPLY_PROTECTED_CONTRACT_ID`,
  `NEXT_PUBLIC_TAPLY_PROTECTED_CODE_HASH`, `NEXT_PUBLIC_TAPLY_PROTECTED_QA`.
- `docs/NEP141_CHANGE_REQUEST.md`: token wire format and contract design for
  lead approval. No token code: freeze v1 keeps `near:native` only.

Results:

| Command | Result |
| --- | --- |
| `npx vitest run src/lib/protected src/components/protected` | 13 + 14 tests pass (view, reconcile, gate, countdown, screen, create) |
| `npx vitest run src/lib/payments/__tests__/wallet-return.test.ts` | 33/33 (incl. new protected matching test) |
| `pnpm --filter @taply/web test` | 76 files, **1,140 passed**, 1 skipped (was 1,112) |
| `npx eslint .` / `npx tsc --noEmit` (apps/web) | clean |
| `pnpm check` (whole workspace, Node 24.22.2) | **exit 0**: shared 92/92, near-client 216/216, web 1,140 passed + 1 skipped; Next build lists `/protected/[id]` and `/protected/new` |

### Increment 1 — Protected Pay G3 candidate (contract + near-client)

New, additive only:

- `contracts/payments-protected/` — copy of the frozen G1 source plus
  `fund_protected_native` (explicit consent echo), `cancel_protected` (payer,
  before chain cutoff), `release_protected` (anyone, at/after cutoff),
  branch-aware `retry_native_transfer` and callback, `locked`/`refunded`
  accounting in the conservation check and liquidity guard. README lists ABI,
  invariants and open security gates.
- `packages/near-client/src/protected.ts` — config schema for the candidate
  (always reports `UNREVIEWED_CANDIDATE`; refuses the G1 pilot account), and
  builders for create / fund / cancel / release / retry that mirror contract guards.
- `.github/workflows/protected-pay-candidate.yml` — fmt, tests, clippy, WASM, wire check, G1 isolation check.

Results observed in this session:

| Command | Result |
| --- | --- |
| `cargo test --locked --lib -- --test-threads=1` (payments-protected, Rust 1.95.0) | **24 passed** (15 inherited G1 + 9 Protected) |
| Mutation: allow cancel at exact cutoff | caught (1 test fails) |
| Mutation: don't count locked principal | caught (8 tests fail) |
| `cargo clippy --locked --all-targets -- -D warnings` | clean |
| `bash scripts/build.sh` | WASM 385,149 bytes, sha256 `244f5d66…2df5` (candidate, not approved) |
| `node contracts/payments-protected/scripts/check-wire.mjs` | 8 records, states OPEN, LOCKED, REFUND_IN_FLIGHT, REFUND_FAILED_RECOVERABLE, CANCELLED_REFUNDED, RELEASE_IN_FLIGHT, RELEASE_FAILED_RECOVERABLE, FINAL_PAID — all parse with the **unchanged** shared schema |
| `node contracts/payments/scripts/check-isolation.mjs` | frozen G1 inputs unchanged |
| `node --test test/protected.test.mjs` (near-client) | 7/7 |

Not done / open:

- No sandbox (near-workspaces) run for the candidate yet: gas and storage are not measured.
- Not deployed anywhere. Needs Codex/lead review (files outside `apps/web`) and human escrow review.
