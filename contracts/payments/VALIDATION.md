# Native Instant Pay contract — validation record

Evidence for the contract as of commit `3bc590b` (contract sources, `Cargo.toml`
and `Cargo.lock` unchanged since `2afbc1c`). **This is local and CI sandbox
evidence, not a security audit and not Testnet evidence.** No Testnet account,
deployment, signature or fund movement exists. Proof hierarchy (lead freeze
section 10): docs < sandbox tests < live Testnet receipts < reproducible demo.

Added in Phase 2D at the human lead's request, because `README.md` linked this
file before it existed. Documentation only: no contract code, manifest, lockfile
or script was changed. Source of every number: GitHub Actions workflow
`instant-pay-sandbox`, run
[41244144449](https://github.com/KendineCrypto/taply/actions/runs/41244144449)
(head `3bc590b`, 2026-10-31, success), artifact `instant-pay-validation-logs`.

## 1. Toolchain

Rust 1.95.0, `wasm32-unknown-unknown`, `target-cpu=mvp`, `--cfg near`, opt-level
`z`, LTO, one codegen unit, overflow checks, panic abort. near-sdk 5.30.0,
near-workspaces 0.24.0, near-sandbox 0.4.0, nearcore sandbox 2.14.0. `--locked`
everywhere. Docker equivalent: `rust:1.95.0-bookworm@sha256:6258907a…d4a1`
(see README).

## 2. Results

| Check | Result | Log |
|---|---|---|
| `cargo fmt --check` (contract + sandbox) | pass | workflow step |
| Unit tests | **15/15** | `unit-tests.log` |
| Clippy, `-D warnings` (contract and sandbox runner) | pass, 0 warnings | `clippy.log`, `clippy-sandbox.log` |
| Production + callback-fault WASM build | pass | `build.log` |
| Export check: production WASM exports exactly the 12 `abi.json` methods | pass | `scripts/check-exports.mjs` step |
| near-workspaces sandbox suite, sequential | **9/9** | `sandbox-tests.log`, `sandbox-summary.txt` |
| Wire check: real sandbox read records parse with the unchanged shared schema | 17 records, states OPEN, FINAL_PAID, PAYOUT_IN_FLIGHT, PAYOUT_FAILED_RECOVERABLE, CANCELLED_UNFUNDED | `wire-check.log` |

Unit tests (`src/tests.rs`): `frozen_jcs_fixtures_match_both_languages`,
`successful_payout_is_only_final_after_runtime_callback`,
`failed_payout_same_beneficiary_retry_new_nonce_only`,
`unknown_and_forged_callbacks_leave_in_flight`,
`duplicate_nonce_and_changed_terms_rejected`,
`amount_terms_payer_expiry_and_cancellation_guards`,
`exact_storage_bond_and_no_growth_at_maximum_sizes`,
`strict_wire_rejects_unknown_duplicate_missing_and_noncanonical_terms`,
`disabled_modes_and_invalid_terms_cannot_be_quoted`,
`aggregate_conservation_across_interleaved_requests`,
`forwarding_low_gas_and_counter_overflow_fail_closed`,
`funded_request_cannot_cancel_refund_or_fund_twice`,
`new_funding_cannot_spend_storage_or_another_failed_obligation`,
`quote_version_authorization_deposits_and_self_recipient`,
`runtime_wire_input_and_invalid_reads_are_rejected`.

Sandbox tests (`sandbox/tests/instant.rs`, real promise execution on a local
nearcore node): `actual_transfer_callback_receipts_and_conservation`,
`actual_successful_transfer_with_panicking_callback_never_retries` (fault build),
`failed_transfer_and_failed_callback_also_stays_unresolved` (fault build),
`transfer_failure_refund_then_recipient_retry_succeeds`,
`retry_pays_exactly_once_and_cannot_be_replayed`,
`self_signed_callback_without_promise_result_is_rejected`,
`competing_funders_and_other_held_obligations_conserve_principal`,
`expired_or_unpermitted_funding_is_refunded_and_cancel_still_works`,
`rejected_deposits_are_refunded_and_invalid_wire_fails_closed`.

## 3. Artifacts

| File | SHA-256 |
|---|---|
| `artifacts/payments.wasm` (production, 345,541 bytes) | `a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2` |
| `artifacts/payments.callback-fault.wasm` (**never deploy**) | `989596a8b2d8b3fa814c749951946ad0396f7725e8cb5b924715493b6153f6be` |

NEAR code hash of the production build (base58 of its SHA-256):
`BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`, asserted by
`apps/web/src/lib/deploy/__tests__/preflight.test.ts`.

**Reproducibility:** the production SHA-256 is identical in runs 41236806667
(head `fbadf5a`), 41241339494 (`a6163a5`) and 41244144449 (`3bc590b`). Every WASM
built before `2afbc1c` lacked `--cfg near` and must not be reviewed or deployed.

## 4. Gas measured in the sandbox (burnt, run 41244144449)

| Operation | Prepaid floor enforced by the contract | Burnt |
|---|---|---|
| `create_request` (12 runs) | 30 Tgas | 3.05–3.17 Tgas |
| `pay_instant_native` incl. transfer and callback | 50 Tgas | 5.88 Tgas |
| `retry_native_transfer` | 50 Tgas | 5.84 Tgas |
| `cancel_unfunded` | 15 Tgas | 2.65 Tgas |
| `on_native_transfer_complete` | 15 Tgas allocated | 2.09 Tgas in the measured success path |

Storage bonds quoted and charged: 557, 586, 633 and 842 bytes (0.00557–0.00842
NEAR at 10^19 yoctoNEAR/byte). Sandbox values; repeat on Testnet.

## 5. Observed receipt graph (successful `pay_instant_native`, sandbox)

From the `MEASURE pay` line in `sandbox-gas-measurements.log`: the contract
receipt returns `SuccessReceiptId(<callback>)` and spawns exactly a native
Transfer to the recipient, the `on_native_transfer_complete` callback and a gas
refund to the signer; the transfer returns `SuccessValue('')` (plus a refund
receipt); the callback returns `SuccessValue('true')` and logs
`payout_succeeded`. The independent receipt verifier in
`apps/web/src/lib/verify/instant-receipt.ts` checks this topology. That log is
the near-workspaces view of outcomes, not RPC JSON: the verifier's parsing of
`EXPERIMENTAL_tx_status` still needs a real Testnet transaction.

## 6. Reproduce

Linux, from `contracts/payments`: `bash scripts/check.sh`. Windows: Docker
Desktop + `scripts/check-docker.ps1`. From the repository root after building
`@taply/shared`: `node contracts/payments/scripts/check-exports.mjs` and
`node contracts/payments/scripts/check-wire.mjs`. To check a built artifact:
`node apps/web/scripts/deploy-preflight.mjs wasm contracts/payments/artifacts/payments.wasm`.

## 7. Not validated here

- Any Testnet behaviour: deployment, real wallets, real gas, RPC outcome formats.
- Successful transfer followed by a failed or missing callback stays
  PAYOUT_IN_FLIGHT permanently by design (no timeout, refund or admin path);
  accepted only as a known limitation pending human review.
- Upgrade authority: with a retained FullAccess key (pilot policy) the account
  holder can replace code or delete the account. See
  `apps/web/docs/TESTNET_DEPLOYMENT_DRY_RUN.md` section 3.
- No security audit has been performed.
