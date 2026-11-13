#!/usr/bin/env bash
# Mainnet candidate build. NOT approval for any live deployment.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then echo "CARGO_TARGET_DIR override is forbidden" >&2; exit 1; fi
mkdir -p artifacts
cargo build --locked --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/taply_payments_mainnet.wasm artifacts/payments-mainnet.wasm
# Distinct test-only artifact reproduces the unknown callback outcome (R-2).
cargo build --locked --target wasm32-unknown-unknown --release --features sandbox-fail-callback
cp target/wasm32-unknown-unknown/release/taply_payments_mainnet.wasm artifacts/payments-mainnet-callback-fault.wasm
cargo build --locked --target wasm32-unknown-unknown --release
cmp artifacts/payments-mainnet.wasm target/wasm32-unknown-unknown/release/taply_payments_mainnet.wasm
# TEST-ONLY NEP-141 token used by the sandbox suite and Testnet evidence (no value).
(cd ../test-token && cargo build --locked --target wasm32-unknown-unknown --release)
cp ../test-token/target/wasm32-unknown-unknown/release/taply_test_token.wasm artifacts/taply_test_token.wasm
sha256sum artifacts/*.wasm | tee artifacts/wasm.sha256
