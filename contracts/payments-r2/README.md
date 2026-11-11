# Taply payments — R-2 callback-recovery CANDIDATE (not reviewed, not deployed)

> **Status: UNREVIEWED CANDIDATE. Not deployed anywhere. Not for real funds.**
> It does not change the deployed contracts: the Instant Pay pilot
> (`contracts/payments`, `taply-pay-pilot-1.testnet`) and the Protected Pay
> escrow (`contracts/payments-protected`, `taply-e2e-ce38a238.testnet`) are
> untouched and keep finding R-2.

This crate is a copy of the escrow contract (instant, protected, NEP-141) with
one change: how an outgoing transfer is recorded. The goal is that a failed
callback can no longer leave a payment stuck "in flight".

- **Settle first:** pay / release / cancel commit `FINAL_PAID` /
  `CANCELLED_REFUNDED` in the same receipt.
- **Debit first:** the amount leaves `owed` before the transfer is scheduled,
  so a successful transfer never depends on the callback.
- **Re-credit only on an explicit `Failed` result:** the beneficiary alone can
  resend, to the same account, once per failure. A delivery whose outcome was
  never recorded (`SENT_UNCONFIRMED`) is never resent.

Verdict: **PARTIALLY MITIGATED**. The remaining case (transfer fails *and* the
callback fails) is documented as open. Full analysis, proof sketch, evidence
and migration plan: [docs/R2_CALLBACK_RECOVERY.md](../../docs/R2_CALLBACK_RECOVERY.md).

## New or changed methods

| Method | Change |
| --- | --- |
| `pay_instant_native`, `release_protected`, `cancel_protected`, `ft_on_transfer(pay_instant)` | Settle in this receipt, then deliver. Gas and liquidity are checked before any state change |
| `on_delivery_complete({id, deliveryNonce})` | Replaces `on_native_transfer_complete`. Private; exactly one promise result; exact current nonce; stale or duplicate calls return `false` with no change; only `Failed` re-credits |
| `retry_native_transfer({id, expectedOperationNonce})` | Same ABI; now resends a `RETURNED_RESENDABLE` delivery, beneficiary only |
| `get_delivery({id})` | New view: `NOT_STARTED / SENT_UNCONFIRMED / DELIVERED / RETURNED_RESENDABLE` |
| `get_accounting` | Buckets `locked, owed, sending, deliveredPaid, deliveredRefunded, settledPaid, settledRefunded` |

`get_request` keeps the unchanged shared wire schema (`scripts/check-wire.mjs`).

## Build and test

```sh
cargo test --locked --lib -- --test-threads=1    # 40 unit tests
bash scripts/build.sh                            # candidate, 2 fault builds, legacy escrow (= deployed hash), test token
bash scripts/sandbox.sh                          # real local NEAR node: 3 protected + 6 R-2 + 4 token tests
```

The fault builds (`sandbox-fail-callback`, `sandbox-tiny-callback-gas`) exist
only for the local sandbox. Never deploy them.
