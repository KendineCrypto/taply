#!/usr/bin/env bash
# R-2 candidate build. NOT an approved deployment artifact (see README.md).
# Builds, into this crate's own target directories only:
#   payments-r2.wasm                     the candidate
#   payments-r2.callback-fault.wasm      candidate whose delivery callback always panics
#   payments-r2.callback-oog.wasm        candidate whose delivery callback gets 1 Tgas (runs out of gas)
#   legacy-g3.wasm / legacy-g3.callback-fault.wasm
#                                        the CURRENT escrow source (contracts/payments-protected),
#                                        unmodified, for side-by-side reproduction of R-2
#   taply_test_token.wasm                TEST-ONLY NEP-141 token (no value)
# Fault builds exist only for the local sandbox; there is no fault API in the contract.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then echo "CARGO_TARGET_DIR override is forbidden" >&2; exit 1; fi
mkdir -p artifacts
W=wasm32-unknown-unknown
cargo build --locked --target $W --release --features sandbox-fail-callback
cp target/$W/release/taply_payments_r2.wasm artifacts/payments-r2.callback-fault.wasm
cargo build --locked --target $W --release --features sandbox-tiny-callback-gas
cp target/$W/release/taply_payments_r2.wasm artifacts/payments-r2.callback-oog.wasm
# Last, so the default target artifact can never silently remain a fault build.
cargo build --locked --target $W --release
cp target/$W/release/taply_payments_r2.wasm artifacts/payments-r2.wasm
# Legacy G3 source, read-only: built with its own config into target-legacy/.
(cd ../payments-protected && cargo build --locked --target $W --release --features sandbox-fail-callback \
  --target-dir ../payments-r2/target-legacy)
cp target-legacy/$W/release/taply_payments_protected.wasm artifacts/legacy-g3.callback-fault.wasm
(cd ../payments-protected && cargo build --locked --target $W --release --target-dir ../payments-r2/target-legacy)
cp target-legacy/$W/release/taply_payments_protected.wasm artifacts/legacy-g3.wasm
(cd ../test-token && cargo build --locked --target $W --release)
cp ../test-token/target/$W/release/taply_test_token.wasm artifacts/taply_test_token.wasm
sha256sum artifacts/*.wasm | tee artifacts/wasm.sha256
