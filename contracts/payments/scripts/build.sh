#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then echo "CARGO_TARGET_DIR override is forbidden" >&2; exit 1; fi
mkdir -p artifacts
cargo build --locked --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/taply_payments.wasm artifacts/payments.wasm
cargo build --locked --target wasm32-unknown-unknown --release --features sandbox-fail-callback
cp target/wasm32-unknown-unknown/release/taply_payments.wasm artifacts/payments.callback-fault.wasm
# Restore the default target artifact too, so it cannot silently remain a fault build.
cargo build --locked --target wasm32-unknown-unknown --release
sha256sum artifacts/*.wasm | tee artifacts/wasm.sha256
