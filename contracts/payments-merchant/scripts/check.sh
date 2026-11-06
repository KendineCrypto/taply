#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then echo "CARGO_TARGET_DIR override is forbidden" >&2; exit 1; fi
export TAPLY_SANDBOX_MERCHANT_V1=1
mkdir -p artifacts
cargo fmt --all --check
cargo fmt --manifest-path sandbox/Cargo.toml --all --check
cargo test --locked --lib
cargo test --locked --lib --features merchant-bound-v1 2>&1 | tee artifacts/unit-tests.log
cargo clippy --locked --all-targets --features merchant-bound-v1 -- -D warnings
bash scripts/build.sh
cd sandbox
cargo clippy --locked --all-targets -- -D warnings
# One real node at a time fits modest developer machines and keeps measurements clear.
cargo test --locked -- --test-threads=1 --nocapture 2>&1 | tee ../artifacts/sandbox-tests.log
