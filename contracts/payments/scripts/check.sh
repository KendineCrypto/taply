#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p artifacts
cargo fmt --all --check
cargo fmt --manifest-path sandbox/Cargo.toml --all --check
cargo test --locked --lib 2>&1 | tee artifacts/unit-tests.log
cargo clippy --locked --all-targets -- -D warnings
bash scripts/build.sh
cd sandbox
cargo clippy --locked --all-targets -- -D warnings
# One real node at a time fits modest developer machines and keeps measurements clear.
cargo test --locked -- --test-threads=1 --nocapture 2>&1 | tee ../artifacts/sandbox-tests.log
