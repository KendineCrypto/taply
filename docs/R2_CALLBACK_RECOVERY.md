# R-2: transfer outcome vs. failed callback — analysis and candidate

Issue: [#30](https://github.com/KendineCrypto/taply/issues/30) · Finding: R-2 in
[SECURITY_REVIEW_2026-11-09.md](SECURITY_REVIEW_2026-11-09.md) · Date: 2026-11-11 ·
Author: AI agent (Claude Code). **Not a human or external review.**

## Verdict

**PARTIALLY MITIGATED in a new candidate. R-2 stays OPEN.**

- The **deployed contracts are unchanged and keep R-2**: the Instant Pay pilot
  `taply-pay-pilot-1.testnet` and the Protected Pay escrow
  `taply-e2e-ce38a238.testnet` (zero access keys, cannot be upgraded).
- The candidate `contracts/payments-r2` removes the reported failure. When the
  transfer **succeeds** and the callback fails (panic or out of gas), the
  request is no longer stuck "in flight": it is settled, and nothing can be sent
  twice.
- **Residual risk (not fixed):** the transfer **fails** (the beneficiary account
  does not exist when it executes) **and** the callback also fails. The amount
  then stays in the contract, marked `SENT_UNCONFIRMED`, and nobody can resend
  it. Nothing is paid twice and nothing is wrongly refunded, but the
  beneficiary cannot recover it on chain.
- A complete fix needs an on-chain way to learn a past receipt's outcome.
  NEAR contracts have none that is trust-minimized (see "Why not a receipt
  proof"). This document does not claim otherwise.

## 1. Root cause

Every payout, release and refund is two receipts:

```text
contract (settling call) ──Transfer / ft_transfer──▶ beneficiary
          └──────────── then ─────────────▶ contract.on_*_complete (callback)
```

NEAR receipt semantics that matter here:

1. The transfer and the callback execute in **separate receipts**, possibly in
   different blocks. A failed callback does not undo the transfer.
2. A callback's state changes are reverted if it panics or runs out of gas.
3. A contract can learn the transfer's outcome **only** through
   `promise_result` inside that one callback receipt. It cannot look up an
   earlier receipt later. No host function exposes past outcomes, block hashes
   or Merkle roots.
4. A native `Transfer` fails only when the receiver account does not exist when
   it executes. The runtime then refunds the deposit to the sender (the
   contract) in a plain refund receipt, which runs no contract code.
5. An NEP-141 `ft_transfer` that fails panics in the token contract, which
   reverts the token's state.

In the deployed contracts the callback is the *only* code that moves a request
out of `*_IN_FLIGHT`. If it fails, the request stays in flight forever, and
retrying is correctly forbidden: the contract cannot tell "paid" from "came
back".

## 2. Reproduction on a real NEAR node

`near-workspaces` sandbox (nearcore 2.14.0), fault builds compiled with
test-only cargo features. The fault-injection code exists only in those
separate WASM files; there is no fault API in the contract.

| Case | Deployed code (G1 pilot / G3 escrow source) | Candidate |
| --- | --- | --- |
| Transfer succeeds, callback **panics** | `PAYOUT_IN_FLIGHT` forever; recipient got exactly 1 NEAR; retry refused `NO_RECORDED_TRANSFER_FAILURE` | `FINAL_PAID`, delivery `SENT_UNCONFIRMED`; recipient got exactly 1 NEAR; resend refused `NO_RETURNED_DELIVERY` |
| Transfer succeeds, callback **out of gas** (1 Tgas build) | (same as a panic; not built for legacy so its source stays untouched) | Same as the panic row; the failure text shows gas exceeded |
| Transfer **fails** (recipient deleted), callback **panics** | `PAYOUT_IN_FLIGHT`; 1 NEAR back in the contract; no retry even after the account is recreated | `FINAL_PAID`, `SENT_UNCONFIRMED`, 1 NEAR in "sending"; no resend. **This is the residual risk** |
| Transfer fails, callback works | `PAYOUT_FAILED_RECOVERABLE`, recipient-only retry | `RETURNED_RESENDABLE`; payer and stranger refused; wrong nonce refused; one resend delivers; replay refused |
| Contract key calls the callback directly | refused `UNKNOWN_PROMISE_RESULT` | refused `UNKNOWN_PROMISE_RESULT`; state unchanged |
| Two cancels + one release in the same block | — | exactly one settles; the recipient gets nothing |

Sources:
- G1: `contracts/payments/sandbox/tests/instant.rs`, 10/10 passed today,
  including `actual_successful_transfer_with_panicking_callback_never_retries`
  and `failed_transfer_and_failed_callback_also_stays_unresolved`.
- G3 vs candidate: `contracts/payments-r2/sandbox/tests/r2.rs`, 6/6 passed.
  The legacy WASM is built from the unmodified `contracts/payments-protected`
  source. Its code hash equals the deployed `963iSEB8…` when built with
  `CARGO_HOME=/root/.cargo`, because the WASM embeds dependency source paths.
  The deployed build used that path; GitHub's default path gives a different
  hash. CI rebuilds it with that path and reports the result as information
  only.
- Recorded outputs: [`evidence/r2-sandbox-2026-11-11/`](evidence/r2-sandbox-2026-11-11/).

Measured gas (real node): the candidate's delivery callback burns about
**2.2 Tgas** on both the delivered and the returned path, against a 15 Tgas
reserve.

## 3. Why not a receipt proof (rejected options)

| Option | Why it is not a fix |
| --- | --- |
| Verify a light-client proof of the transfer receipt on chain | Needs a trusted block Merkle root inside the contract. NEAR contracts cannot read block hashes or roots, so someone would have to supply the root. That person becomes a trusted party able to forge "it failed" and get a second payment |
| Accept a tx hash / RPC response / screenshot | Off-chain claims; forgeable; issue #30 rules them out |
| Contract balance delta | Balances are fungible: anyone can send NEAR to the contract, and refunds and gas rewards mix in |
| More callback gas, timeouts, retries after N blocks | Gas lowers the chance but proves nothing (protocol fees change, bugs). A timeout-based retry pays twice whenever the first transfer actually arrived |
| Admin or beneficiary "it failed" attestation | Turns a trusted assertion into money; a false claim pays twice |
| Two callbacks on the same promise | Both run the same code with the same gas, so failures are correlated |

Conclusion: under current NEAR host functions a contract cannot independently
establish a past transfer's outcome. The candidate therefore removes the
dependency where it can (the success path) and fails closed where it cannot
(failure path plus failed callback).

## 4. Candidate architecture (`contracts/payments-r2`)

A copy of the escrow contract (instant + protected + NEP-141), with three
changes:

**a) Settle first, in one receipt.** `pay_instant_native`, `release_protected`,
`cancel_protected` and `ft_on_transfer(pay_instant)` commit the outcome
synchronously:
- status → `FINAL_PAID` / `CANCELLED_REFUNDED` (the branch is fixed forever);
- the amount → `owed` to the fixed destination (creator, or the recorded payer).

The shared wire schema is unchanged. The request view's `latestOperation` now
describes this settlement, which always succeeds in that receipt.

**b) Debit first, then deliver.** Before scheduling the transfer, the amount
moves `owed → sending` and the delivery becomes `SENT_UNCONFIRMED`. A
successful transfer therefore never needs the callback.

**c) The callback can only confirm or return.** `on_delivery_complete(id, deliveryNonce)`:
- private; requires exactly one promise result;
- bound to the request id and the *current* attempt's exact canonical nonce;
- stale, duplicate or unknown calls return `false` and change nothing (no panic);
- **only an explicit `Failed` result** moves `sending → owed` (`RETURNED_RESENDABLE`);
- any other result (`Ok`, or a success too long to read) moves
  `sending → delivered` (`DELIVERED`).

Resend (`retry_native_transfer`, same ABI) is allowed **only** when:
- the delivery is `RETURNED_RESENDABLE`;
- the caller is the beneficiary of the committed branch;
- the nonce is the latest one.

The destination is always the fixed one. A `SENT_UNCONFIRMED` delivery can
never be resent by anyone.

Guards, checked **before any state change**:
- **Gas:** the unspent gas must cover the transfer, the callback and a margin
  (`INSUFFICIENT_GAS_FOR_DELIVERY`).
- **Liquidity:** the account must keep storage + `locked` + `owed`, including
  any new instant amount (`INSUFFICIENT_OPERATIONAL_LIQUIDITY`). `sending` is
  excluded, because it may already have left.

Accounting, per asset, after every transition:

```text
received == locked + owed + sending + delivered_paid + delivered_refunded
settled_paid + settled_refunded == owed + sending + delivered_paid + delivered_refunded
```

New view `get_delivery(id)`: `NOT_STARTED | SENT_UNCONFIRMED | DELIVERED |
RETURNED_RESENDABLE`, the nonce, the destination, and whether a resend is
allowed. `get_receipt.payoutConfirmed` is true only for `DELIVERED`.

## 5. No-double-payment argument

Fix one request `R` with amount `A` and fixed destination `D`.

1. Money for `R` leaves the contract only in `deliver`. Each call debits
   exactly `A` from `owed[R]` in the same receipt that schedules the single
   transfer of `A` to `D`. `deliver` runs only from settlement (status `OPEN`
   or `LOCKED`, which the same receipt then makes terminal) or from a resend
   (requires `RETURNED_RESENDABLE`).
2. `owed[R]` becomes `A` exactly once at settlement. Status checks make
   settlement non-repeatable: `NOT_OPEN` / `NOT_LOCKED`. NEAR executes one
   account's receipts sequentially, so two settlements cannot interleave (the
   concurrent sandbox test shows it).
3. After that, `owed[R]` grows only in the callback, and only when the runtime
   reports **`Failed` for the current attempt**. By runtime semantics (§1.4,
   §1.5), `Failed` means that attempt's transfer was not applied. Native NEAR
   is refunded to the contract; for tokens no tokens move.
4. The callback cannot be invoked by anyone else (private, exactly one promise
   result). It cannot apply to an older attempt (exact nonce) or to another
   request (keyed by id).

So for every attempt that may have been applied, no further attempt is
scheduled unless the runtime itself said it was not applied. Applied transfers
to `D` for `R` therefore number at most 1. A refund and a release cannot both
happen, because the branch is chosen once (2). No other request's reserved
funds can be spent, because of the liquidity guard.

## 6. Adversarial evidence

| Property | Unit test (`src/r2_tests.rs` + adapted suites) | Real node (`sandbox/tests/r2.rs`) |
| --- | --- | --- |
| No double payment / refund | `randomized_interleavings_never_pay_twice` (600 random steps, 24 requests: success / failure / no callback / stale / resend) | success+panic, success+OOG, failure+panic |
| No incorrect `FINAL_PAID` | settlement status only from settle; delivery only from callback | all cases |
| No unverified recovery | `callback_that_never_completes_leaves_a_settled_request_and_no_resend`, `a_settled_request_admits_no_other_transition` | resend refused in all fault cases |
| No replay / stale / forged callback | `stale_duplicate_and_mismatched_callbacks_are_inert` (incl. nonce `"01"`), `forged_callbacks_are_refused_and_change_nothing` | `self_signed_callback_is_refused_and_changes_nothing` |
| Only explicit Failed re-credits | `only_an_explicit_failed_result_returns_the_amount` | `transfer_fails_callback_records_it…` |
| No unauthorized / cross-request resend | `resend_is_beneficiary_only_once_per_failure_and_never_cross_request` | payer and stranger refused, wrong nonce refused, replay refused |
| Cancel / release race | `cancel_and_release_cannot_both_settle` | `concurrent_cancel_and_release_settle_exactly_once` |
| Reserved funds not spent elsewhere | `owed_and_locked_funds_are_never_spent_on_another_obligation` | — |
| Gas reserve | `delivery_requires_gas_for_transfer_and_callback` | callback measured at ~2.2 Tgas |
| Cross-token substitution | adapted `token_tests.rs` (fake token, wrong asset) | `token.rs` (4 tests) |

Mutation check: four deliberate bugs, each caught by at least one test:
- re-credit on any non-OK result;
- ignore the delivery nonce;
- allow resending an unconfirmed delivery;
- drop the liquidity check before a resend.

One real issue was found and fixed while writing the tests: the callback first
parsed the nonce with Rust's integer parser, which accepts `"01"` as `1`. It
now requires the exact canonical string. (This was not exploitable, since only
the contract's own promise can call the callback.)

## 7. Reproduce

```sh
cd contracts/payments-r2
cargo test --locked --lib -- --test-threads=1          # 40 passed
cargo fmt --all --check && cargo clippy --locked --all-targets -- -D warnings
bash scripts/build.sh                                  # 5 WASMs + test token (legacy-g3.wasm = deployed hash if CARGO_HOME=/root/.cargo)
bash scripts/sandbox.sh                                # 3 + 6 + 4 passed on a local NEAR node
pnpm --filter @taply/shared build
node scripts/check-wire.mjs && node scripts/check-wire.mjs sandbox \
  && node scripts/check-wire.mjs token && node scripts/check-wire.mjs sandbox-token
```

CI: `.github/workflows/r2-candidate.yml` runs all of the above.

Container note: `near-sandbox` aborts if it cannot raise the open-file limit
to 65,535. One cloud container used for this work capped it at 20,000, so the
local runs used a small `LD_PRELOAD` shim that clamps that one `setrlimit`
call. GitHub's runners don't need it.

## 8. Remaining risks

1. **Residual R-2** (High for real funds, open): a failed transfer plus a failed
   callback leaves the amount in `sending`, unattributed and not resendable.
   - It needs the beneficiary's account to be missing at execution time, plus
     a callback failure. The callback has no reachable panic and a ~7× gas
     margin, so that takes a bug or a protocol fee change.
   - It is visible on chain (`get_delivery`, `sendingPrincipalYocto`).
   - Recovering it would require trusting an off-chain claim; deliberately not
     offered.
2. **Meaning of `FINAL_PAID`:** it now means "settled and sent"; delivery is
   reported separately. "Verified Paid" in the app must keep checking the
   transfer receipt off-chain, and the UI must show `SENT_UNCONFIRMED`
   honestly. The web app and verifier are **not** changed in this PR.
3. **No review:** unaudited, AI-written, not reviewed by a human. NEP-141 tokens
   are trusted to behave per the standard (R-4).
4. **Deployed contracts keep R-2.** They are immutable; this candidate only
   helps new requests on a new deployment.
5. Build reproducibility depends on paths embedded in the WASM. The G3 escrow
   reproduces its deployed hash with `CARGO_HOME=/root/.cargo`; G1's local WASM
   does not currently reproduce its deployed hash (known drift, see the old
   PR #8).

## 9. Migration plan (requires separate human approval)

1. Human review of `contracts/payments-r2` and of this argument.
2. Fresh Testnet account → deploy `payments-r2.wasm` → `new` → delete every
   access key → verify the code hash and the zero keys.
3. Re-run the scripted Testnet proof against it: refund, release, the
   adversarial calls, and a failed transfer to a deleted account followed by a
   resend.
4. Web app, behind a flag and pinned by code hash:
   - read `get_delivery`;
   - show "Paid — delivery unconfirmed" for `SENT_UNCONFIRMED`;
   - offer resend only for `RETURNED_RESENDABLE`, to the beneficiary;
   - make the verifier check the transfer receipt (no callback receipt in the
     success proof).
5. New requests go to the new contract. Old requests stay readable and settle
   on the old contracts. No funds are migrated.
6. Keep R-2 disclosed for the old contracts permanently.
