# Taply payments — R-2 EXPERIMENTAL candidate (not reviewed, not deployed)

> **Status: EXPERIMENTAL, UNREVIEWED. Not deployed anywhere. Not for real funds.
> R-2 is NOT fixed.** The deployed Instant Pay pilot (`contracts/payments`) and
> Protected Pay escrow (`contracts/payments-protected`) are untouched and keep R-2.

A copy of the escrow contract (instant, protected, NEP-141) with the **same
request semantics as the deployed contracts**: `FINAL_PAID` /
`CANCELLED_REFUNDED` only after the contract's own callback confirmed the
transfer. It adds hardening and observability:

- **Settlement and delivery tracked separately.** `get_delivery` reports
  `settlement: COMMITTED`, `delivery: PENDING_UNCONFIRMED | CONFIRMED |
  RETURNED_RESENDABLE`, and `received: true` only when confirmed. Accounting has
  `owed / sending / delivered` and settled totals per branch.
- **Debit first** (`owed → sending`) before the transfer is scheduled.
- **Conservative callback:**
  - `Ok` confirms;
  - only `Failed` returns the amount;
  - `TooLong` or any unknown result changes nothing;
  - stale or duplicate calls are inert.
- **Gas and liquidity checked before any state change.**
- **Same callback name and arguments** (`on_native_transfer_complete`) and the
  same error codes, so the existing receipt verifier applies.

When the callback never completes, the request stays `*_IN_FLIGHT`, exactly as
in production. It is never shown as paid and never retried. A first version
that set `FINAL_PAID` earlier was withdrawn: it produced a false paid.

Full analysis, evidence and the residual cases:
[docs/R2_CALLBACK_RECOVERY.md](../../docs/R2_CALLBACK_RECOVERY.md).

## Build and test

```sh
cargo test --locked --lib -- --test-threads=1    # 40 unit tests
bash scripts/build.sh                            # candidate, 2 fault builds, legacy escrow source, test token
bash scripts/sandbox.sh                          # real local NEAR node: 3 protected + 6 R-2 + 4 token tests
```

The fault builds (`sandbox-fail-callback`, `sandbox-tiny-callback-gas`) exist
only for the local sandbox. Never deploy them.
