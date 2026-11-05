#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Separate output directory: never overwrite the approved pilot artifacts.
mkdir -p artifacts/merchant-v1
cargo build --locked --target wasm32-unknown-unknown --release --features merchant-bound-v1
cp target/wasm32-unknown-unknown/release/taply_payments.wasm artifacts/merchant-v1/payments.wasm
cargo build --locked --target wasm32-unknown-unknown --release --features merchant-bound-v1,sandbox-fail-callback
cp target/wasm32-unknown-unknown/release/taply_payments.wasm artifacts/merchant-v1/payments.callback-fault.wasm
cargo build --locked --target wasm32-unknown-unknown --release --features merchant-bound-v1
sha256sum artifacts/merchant-v1/*.wasm | tee artifacts/merchant-v1/wasm.sha256
