# Unapproved G2 merchant candidate

Independent Cargo workspace copied from 352a7cfd9efeda314634a81905f459b290f947ec. Rust source, manifests, lockfiles, toolchain and both ABIs are preserved byte for byte. No deployment approval, signing or activation is provided. Do not use this context for the G1 pilot.

From this directory:

```sh
cargo test --locked --lib
cargo test --locked --lib --features merchant-bound-v1
bash scripts/check.sh
node scripts/check-exports.mjs
# After root pnpm install and shared/near-client builds:
node --test test/*.test.mjs
node scripts/check-wire.mjs
```

Build only: bash scripts/build-merchant.sh (or build.sh). Sandbox only: bash scripts/sandbox.sh. Direct sandbox cargo invocation requires TAPLY_SANDBOX_MERCHANT_V1=1. Targets stay under this workspace; WASM stays under artifacts/merchant-v1. CARGO_TARGET_DIR overrides are rejected by scripts. The legacy payments/scripts/build-merchant.sh and merchant sandbox command forward here.

See MERCHANT_V1.md for the preserved protocol rationale; its old cd contracts/payments instructions now mean cd contracts/payments-merchant. The candidate's relocated build hash is unproven until normal CI. Never replace the approved G1 hash with it.
