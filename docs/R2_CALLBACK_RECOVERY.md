# R-2: transfer outcome vs. failed callback — analysis and candidate

Issue: [#30](https://github.com/KendineCrypto/taply/issues/30) · Finding: R-2 in
[SECURITY_REVIEW_2026-11-09.md](SECURITY_REVIEW_2026-11-09.md) · Updated
2026-11-11 after review of PR #31 · Author: AI agent (Claude Code). **Not a
human or external review.**

## Verdict

**R-2 is NOT FIXED and stays OPEN. The candidate `contracts/payments-r2` is
EXPERIMENTAL: hardening and observability only, not a fix.**

- **Taply's meaning of "paid" is kept.** `FINAL_PAID` / `CANCELLED_REFUNDED`
  appear only after the contract's own callback confirmed the transfer ("Not
  just sent. Verified.").
- **Under that meaning R-2 cannot be mitigated on chain.** When the callback
  never completes, the contract cannot know whether the money arrived (§3). The
  only honest state is "in flight", which is what the deployed contracts already
  show.
- **The first version of PR #31 is withdrawn.** It "mitigated" R-2 by setting
  `FINAL_PAID` before the callback confirmed delivery. Review showed that is a
  **false paid**: a real sandbox run where the transfer failed and the callback
  failed returned `FINAL_PAID`, and the web app rendered it as "Paid per
  contract" with money "to recipient". Evidence:
  [`v1-rejected-settle-first/`](evidence/r2-sandbox-2026-11-11/v1-rejected-settle-first/).
- **What the candidate now guarantees, with evidence (§6):** no false
  `FINAL_PAID`, no false Verified Paid, and no double payout or refund. That
  includes the case "transfer failed and callback failed".
- **The deployed contracts are unchanged and keep R-2:** the Instant Pay pilot
  `taply-pay-pilot-1.testnet` and the escrow `taply-e2e-ce38a238.testnet`.

### Trade-off, stated plainly

| | Request status when the callback never completes | Stuck forever? | False paid possible? |
| --- | --- | --- | --- |
| Deployed contracts | `PAYOUT_IN_FLIGHT` | yes | no |
| PR #31 v1 (withdrawn) | `FINAL_PAID` | no | **yes** (failed transfer + failed callback) |
| Candidate now | `PAYOUT_IN_FLIGHT` + delivery `PENDING_UNCONFIRMED` | yes | no |

Fixing "stuck" without a false paid needs knowledge the contract cannot obtain
(§3). We chose correctness over liveness.

## 1. Root cause

Every payout, release and refund is two receipts:

```text
contract (settling call) ──Transfer / ft_transfer──▶ beneficiary
          └──────────── then ─────────────▶ contract.on_native_transfer_complete
```

NEAR runtime facts (checked on a real node, §2):

1. The transfer and the callback execute in **separate receipts**. A failed
   callback does not undo the transfer.
2. A callback's state changes are reverted if it panics or runs out of gas.
3. A contract learns the transfer's outcome **only** through `promise_result`
   inside that callback. It cannot look up an earlier receipt later. No host
   function exposes past outcomes, block hashes or Merkle roots.
4. A native `Transfer` fails only when the receiver account does not exist. The
   runtime then refunds the deposit to the contract in a plain refund receipt,
   which runs no contract code.
5. A failed NEP-141 `ft_transfer` panics in the token, which reverts its state.
6. The `promise_result` host call returns 1 (receipt succeeded), 2 (receipt
   failed), or anything else, in which case the SDK aborts the callback.
   `TooLong` is a *successful* receipt whose return value exceeds the caller's
   limit.

If the callback fails, nothing on chain can ever record the outcome.

## 2. Reproduction on a real NEAR node

`near-workspaces` sandbox (nearcore 2.14.0); the fault builds are separate WASM
files compiled with test-only cargo features. The "legacy" WASM is built from
the unmodified `contracts/payments-protected` source; built with
`CARGO_HOME=/root/.cargo`, its code hash equals the deployed `963iSEB8…`
(reproduced locally and on GitHub,
[run](https://github.com/KendineCrypto/taply/actions/runs/42988750148)).

| Case | Deployed escrow source | Candidate |
| --- | --- | --- |
| Transfer succeeds, callback **panics** | `PAYOUT_IN_FLIGHT`, no receipt, retry refused; recipient got exactly 1 NEAR | same, plus delivery `PENDING_UNCONFIRMED`, `received: false` |
| Transfer succeeds, callback **out of gas** (1 Tgas build) | (not built, so the legacy source stays untouched) | same as the panic row |
| Transfer **fails** (recipient deleted), callback **panics** — recipient received nothing | `PAYOUT_IN_FLIGHT`, no receipt, retry refused, 1 NEAR stuck in the contract | same; 1 NEAR in "sending"; `received: false` |
| Transfer fails, callback works | `PAYOUT_FAILED_RECOVERABLE`, recipient-only retry | same, plus `RETURNED_RESENDABLE`; payer and stranger refused, wrong nonce and replay refused; after the resend: `FINAL_PAID`, `received: true` |
| Contract key calls the callback directly | refused `UNKNOWN_PROMISE_RESULT` | same |
| Two cancels + one release in one block | — | exactly one settles; the recipient gets nothing |

The G1 sandbox suite (`contracts/payments/sandbox`, 10/10) reproduces the same
two R-2 cases on the Instant Pay pilot source.

Outputs: [`evidence/r2-sandbox-2026-11-11/`](evidence/r2-sandbox-2026-11-11/).
The callback measured ~2.2 Tgas against a 15 Tgas reserve.

## 3. Why there is no fix under these semantics

| Option | Why not |
| --- | --- |
| Mark final when settlement is committed (PR #31 v1) | False paid when the transfer fails and the callback fails; proven with a real run |
| Verify a light-client proof of the transfer receipt on chain | Needs a trusted block Merkle root; contracts cannot read block hashes or roots. Whoever supplies the root could forge "it failed" and get a second payout |
| Accept a tx hash, RPC response or screenshot | Off-chain claims; forgeable (issue #30) |
| Contract balance delta | Balances are fungible; refunds and gas rewards mix in |
| More callback gas, timeouts, retry after N blocks | Lowers the chance of a failure but proves nothing; a timed retry pays twice when the first transfer arrived |
| Admin or beneficiary attestation | A trusted claim that moves money or status; a false claim causes a double payout or a false paid |
| Two callbacks on the same promise | Same code, same gas: the failures are correlated |

## 4. What the experimental candidate changes

`contracts/payments-r2` is a copy of the escrow contract (instant, protected,
NEP-141). It keeps:
- the deployed request semantics;
- the callback name and arguments (`on_native_transfer_complete({id, operationNonce, kind})`),
  so the existing receipt verifier applies unchanged;
- the error codes.

Changes:

1. **Settlement and delivery tracked separately.** Pay, release or cancel
   commits the branch and the owed amount in one receipt, then delivers. The
   request becomes `*_IN_FLIGHT`. Only the callback's confirmation makes it
   `FINAL_PAID` / `CANCELLED_REFUNDED`.

   New view `get_delivery`:
   - `settlement`: `NONE` or `COMMITTED`;
   - `delivery`: `NOT_STARTED`, `PENDING_UNCONFIRMED`, `CONFIRMED` or
     `RETURNED_RESENDABLE`;
   - `received`: true only for `CONFIRMED`;
   - plus the resend rule and a plain-language note.

   Accounting buckets: `owed`, `sending`, `delivered`, and settled totals per
   branch.
2. **Debit first.** The amount moves `owed → sending` before the transfer is
   scheduled.
3. **Conservative result classification:**
   - `Ok` (a native result is empty; a token result is at most 256 bytes) →
     `CONFIRMED`.
   - `Err(Failed)` → `RETURNED` (`*_FAILED_RECOVERABLE`).
   - `Err(TooLong)`, and any future error variant (`PromiseError` is
     non-exhaustive) → **no state change**; the request stays in flight. A
     native Transfer cannot return bytes, and NEP-141 `ft_transfer` returns
     nothing, so such a result is unsupported and never counted as delivered.
4. **Inert stale and duplicate callbacks.** A wrong nonce (exact canonical
   string), wrong kind, unknown id, or a request that isn't in flight returns
   `false` with no change. (The deployed code panics, which has the same
   effect.)
5. **Checks before any state change:** unspent gas covers the transfer, the
   callback and a margin; the account keeps storage + locked + owed.
6. **Resend** only from `RETURNED_RESENDABLE`, by the beneficiary, to the same
   destination, with the latest nonce.

Conservation, per asset:

```text
received == locked + owed + sending + delivered_paid + delivered_refunded
settled_paid + settled_refunded == owed + sending + delivered_paid + delivered_refunded
```

## 5. Arguments

**No false paid.** Every client-visible "paid" signal is produced in exactly
one place: the callback branch for an `Ok` promise result of the current
attempt. Those signals are the request status `FINAL_PAID` /
`CANCELLED_REFUNDED`, terminal facts (`get_receipt`), `payoutConfirmed` and
`received`. By §1.6 that branch runs only when the transfer receipt succeeded.
No other method sets a final status.

**No false Verified Paid.** The web app shows Verified Paid only for
`FINAL_PAID` read at a final block **and** a receipt verification. That
verification itself requires `FINAL_PAID`, a successful transfer receipt, and a
callback named `on_native_transfer_complete` that returned `true`. In flight
there is no `FINAL_PAID` and no successful callback.

**No double payout or refund.** For request `R` with amount `A` and fixed
destination `D`:
- money leaves only in `deliver`, which debits `A` from `owed[R]` in the same
  receipt that schedules the single transfer;
- `owed[R]` becomes `A` once at settlement (status guards; one account's
  receipts execute sequentially);
- after that, it grows only on an explicit `Failed` result for the current
  attempt, which by §1.4–1.5 means the transfer was not applied;
- the callback is private, needs exactly one promise result, and is bound to
  `R`'s id, nonce and kind.

Hence at most one applied transfer to `D` per request. The branch is chosen
once, so a refund and a release cannot both happen.

## 6. Evidence

| Property | Unit (`src/r2_tests.rs` + 30 adapted escrow tests) | Real node (`sandbox/tests/r2.rs`) | Web (`apps/web/.../r2-no-false-paid.test.ts`) |
| --- | --- | --- | --- |
| No false paid when the callback never completes (transfer arrived **or** failed) | `a_callback_that_never_completes_never_shows_paid_and_never_resends`, `protected_settlements_are_not_final_until_confirmed` | cases 1, 2, 3 (deployed source and candidate): status in flight, `get_receipt` = null, `received: false` | the real views of cases 1–3 parse; with a fresh final read, a claimed verified receipt and every role: no ribbon, not "paid per contract", no success tone, money not "to recipient"; the funding locator refuses |
| Conservative result classification | `promise_results_are_classified_conservatively` (native empty → confirmed, bytes → no change; token ≤ 256 → confirmed, 257 → no change; Failed → returned) | — | — |
| Final only after confirmation (invariant) | `randomized_interleavings_never_pay_twice_and_never_show_false_paid`: 600 steps × 24 requests; final status ⇔ receipt ⇔ received ⇔ confirmed delivery | case 4: failed → recoverable → resend → `FINAL_PAID` | — |
| No double payout or refund | same randomized test (sends = failures (+1)) | cases 1, 3, 4 (balances) | — |
| Stale, duplicate and forged callbacks | `stale_duplicate_and_mismatched_callbacks_are_inert`, `forged_callbacks_are_refused_and_change_nothing` | self-signed callback refused | — |
| Resend rules; cross-request | `resend_is_beneficiary_only_once_per_failure_and_never_cross_request` | payer and stranger refused; nonce mismatch; replay refused | — |
| Cancel/release race; reserved funds; gas | `cancel_and_release_cannot_both_settle`, `owed_and_locked_funds_are_never_spent_on_another_obligation`, `delivery_requires_gas_for_transfer_and_callback` | concurrent cancel + release | — |

**Mutation check.** Each deliberate bug is caught by at least one test:

| Deliberate bug | Tests failing |
| --- | --- |
| `TooLong` counted as delivered | 2 |
| `FINAL_PAID` set before confirmation (v1) | 15 |
| Resend of an unconfirmed delivery | 3 |
| `Failed` counted as delivered | 12 |

**Counter-check.** The web test logic applied to the v1 view (failed transfer +
failed callback) reports `contractReportsPaid: true`, money "to recipient":
the false paid the review identified.

## 7. Reproduce

```sh
cd contracts/payments-r2
cargo test --locked --lib -- --test-threads=1          # 40 passed
cargo fmt --all --check && cargo clippy --locked --all-targets -- -D warnings
bash scripts/build.sh && bash scripts/sandbox.sh       # real node: 3 + 6 + 4 passed
pnpm --filter @taply/shared build
for m in unit sandbox token sandbox-token; do node scripts/check-wire.mjs $m; done
pnpm --filter @taply/web exec vitest run src/lib/payments/__tests__/r2-no-false-paid.test.ts
```

CI: `.github/workflows/r2-candidate.yml` (contract) and `workspace-check`
(web, including the test above). The local sandbox needed an `LD_PRELOAD` shim
for this container's open-file limit; GitHub runners don't.

## 8. Residual R-2 cases (open)

1. **Transfer arrived, callback failed** (panic, out of gas, or an unsupported
   result). The money is with the beneficiary, but the request stays
   `*_IN_FLIGHT` forever:
   - never shown as paid;
   - never retried;
   - its amount stays in "sending".

   The app should explain this state; see the recommendation below.
2. **Transfer failed, callback failed.** The beneficiary got nothing. The amount
   is back in the contract but attributed to "sending", not resendable, with no
   on-chain recovery. No false paid, no double payout. It requires the
   beneficiary account to be missing at execution, plus a callback failure.
3. **Both cases are indistinguishable on chain.** Only off-chain receipt
   inspection can tell them apart.
4. **Unaudited, AI-written.** NEP-141 tokens are trusted per the standard (R-4).
   The deployed contracts keep R-2 permanently.

**Recommendation (issue #30, item 6; app only, not in this PR).** Detect a
request that has been in flight for a long time. Off-chain, locate its transfer
and callback receipts and show "Transfer receipt found, contract record
incomplete (R-2). Do not pay again." Never show Verified Paid or offer a retry
for it.

## 9. Migration plan (only if a human review accepts the experimental candidate)

The candidate does not remove R-2, so migrating to it is optional. It would
bring the hardening and the `get_delivery` view.

1. Human review.
2. Fresh Testnet account: deploy, call `new`, delete all keys, verify the code
   hash.
3. Scripted Testnet proof, including a failed transfer followed by a resend.
4. Web app: pin the new contract by flag and code hash, and read `get_delivery`
   for the in-flight explanation. Request semantics and the verifier are
   unchanged.
5. New requests only; old requests stay on the old contracts.

Nothing in this PR is deployed, and no production setting changes.
