#!/usr/bin/env bash
# G3 candidate build. NOT an approved deployment artifact (see README.md).
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then echo "CARGO_TARGET_DIR override is forbidden" >&2; exit 1; fi
mkdir -p artifacts
cargo build --locked --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/taply_payments_protected_mainnet.wasm artifacts/payments-protected.wasm
cargo build --locked --target wasm32-unknown-unknown --release --features sandbox-fail-callback --target-dir target/fault
cp target/fault/wasm32-unknown-unknown/release/taply_payments_protected_mainnet.wasm artifacts/payments-protected-FAULT-TEST-ONLY.wasm
# TEST-ONLY NEP-141 token used by the sandbox suite and Testnet evidence (no value).
(cd ../test-token && cargo build --locked --target wasm32-unknown-unknown --release)
cp ../test-token/target/wasm32-unknown-unknown/release/taply_test_token.wasm artifacts/taply_test_token.wasm
sha256sum artifacts/*.wasm | tee artifacts/wasm.sha256
