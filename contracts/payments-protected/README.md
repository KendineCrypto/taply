# Taply Protected Pay contract — G3 CANDIDATE (not reviewed, not deployed)

> **Status: UNREVIEWED CANDIDATE. Not deployed anywhere. Not for real funds.**
> The deployed G1 contract (`contracts/payments`, `taply-pay-pilot-1.testnet`)
> is frozen and untouched. This crate is a separate copy of that source with
> Protected Pay (escrow) added, so the G3 gate in `docs/MILESTONES.md` can be
> reviewed and later proven on Testnet without risking the G1 release.

Deployment needs, in order (freeze section 10): human review of escrow
custody, measured gas/storage on a sandbox node, a fresh Testnet account
(never the G1 pilot), and real Testnet refund **and** release transactions
recorded in `docs/EVIDENCE.md`. Until then `get_config` reports
`protected.reviewStatus = "UNREVIEWED_NOT_FOR_REAL_FUNDS"` and the web app's
near-client refuses the config (`UNREVIEWED_CAPABILITY`).

## What changed versus G1

Everything in G1 is kept byte-for-byte in behaviour for `mode = "instant"`
(all 15 G1 unit tests run unchanged against this crate). Additions:

| Method | Who | Deposit | Rule |
| --- | --- | --- | --- |
| `fund_protected_native({id, expectedTermsHash, acceptedCancelDurationNs, consentVersion})` | payer (direct wallet call) | exact principal | `OPEN → LOCKED`. Echoed duration must equal the signed `cancelDurationNs`; `consentVersion = "taply.protected-consent.v1"`. Records `fundedAtNs = block_timestamp` and `cancelUntilNs = fundedAtNs + cancelDurationNs` (checked). No outgoing transfer. |
| `cancel_protected({id, expectedTermsHash})` | recorded payer only | 1 yoctoNEAR | Only when `block_timestamp < cancelUntilNs`. Commits the PAYER branch, then `LOCKED → REFUND_IN_FLIGHT` and a transfer to the recorded payer. |
| `release_protected({id})` | anyone (direct wallet call) | 1 yoctoNEAR | Only when `block_timestamp >= cancelUntilNs`. Commits the RECIPIENT branch, then `LOCKED → RELEASE_IN_FLIGHT` and a transfer to the creator. |
| `retry_native_transfer({id, expectedOperationNonce})` | beneficiary of the committed branch | 1 yoctoNEAR | Only after a recorded failure (`*_FAILED_RECOVERABLE`). Same branch, same destination, fresh nonce. Payer for refunds, recipient for releases and instant payouts. |
| `on_native_transfer_complete({id, operationNonce, kind})` | contract only | 0 | Kind must match the committed branch (`PROTECTED_REFUND`, `PROTECTED_RELEASE`, `INSTANT_PAYOUT`); nonce must match the in-flight operation. Success → `CANCELLED_REFUNDED` / `FINAL_PAID`; recorded failure → `REFUND_FAILED_RECOVERABLE` / `RELEASE_FAILED_RECOVERABLE`. Missing/unknown promise result panics and leaves the operation in flight. |

`pay_instant_native` rejects protected requests (`WRONG_MODE`) and
`fund_protected_native` rejects instant ones. `quote_create_request` /
`create_request` accept `mode = "protected"` with `cancelDurationNs` in
60–3600 s (`INVALID_CANCEL_DURATION` otherwise). Assets other than
`near:native`, merchant/session binding and Milestone stay disabled.

Read shapes (`get_request`, `get_receipt`) are exactly the frozen
`ContractRequestSchema` in `packages/shared`. `get_receipt` now also returns
terminal facts for `CANCELLED_REFUNDED` with `payoutConfirmed = false`.
`get_accounting` adds `lockedPrincipalYocto` and `refundedPrincipalYocto`.

Events: `request_locked`, `refund_started`, `refund_succeeded`,
`refund_failed` in addition to the G1 events.

## Invariants enforced (docs/PAYMENT_STATE_MACHINE.md)

- `received = confirmedPaid + refunded + locked + inFlight + failedHeld`,
  checked on every state change (`CONSERVATION_FAILURE` panics).
- The liquidity guard counts locked escrow: no funding or settlement may spend
  storage, another locked obligation or another failed obligation.
- Branch (PAYER vs RECIPIENT) is chosen once, before any promise, and never
  changes. A failed refund cannot become a release and vice versa.
- At the exact cutoff cancellation loses and release wins. Deadline passage
  alone moves nothing.
- At most one outgoing transfer per obligation; callbacks are private and
  bound to request id + monotonically increasing operation nonce + kind.
- Funding happens once; LOCKED is never shown as paid (`get_receipt` returns
  nothing for LOCKED).

## Known open security gates (DO NOT mark approved)

1. **Transfer-success + callback-failure** stays in flight forever (same
   fail-closed policy as G1). No admin override exists; this may strand an
   obligation. Needs an agreed reconciliation design.
2. Gas (`SETTLE_GAS` 50 Tgas, `FUND_PROTECTED_GAS` 20 Tgas, callback 15 Tgas)
   and the storage size are copied/estimated, **not measured** on a sandbox
   node for this crate yet.
3. Release is permissionless after the cutoff (freeze section 4). A griefer
   can only trigger the payout the recipient was owed anyway, but pays gas.
4. The contract account must not hold a FullAccess key in any real
   deployment of escrow (the G1 pilot does; the verifier detects key changes).
5. No external audit.

## Commands

```sh
cd contracts/payments-protected
cargo fmt --all --check
cargo test --locked --lib -- --test-threads=1   # 24 tests (15 G1 + 9 Protected)
cargo clippy --locked --all-targets -- -D warnings
bash scripts/build.sh                            # wasm32 release build + sha256
pnpm --filter @taply/shared build && node scripts/check-wire.mjs   # from repo root
```

CI: `.github/workflows/protected-pay-candidate.yml`.
