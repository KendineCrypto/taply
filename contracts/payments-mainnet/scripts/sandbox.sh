#!/usr/bin/env bash
# Real local sandbox only; fixed identities are injected into its isolated state.
set -euo pipefail
cd "$(dirname "$0")/../sandbox"
mkdir -p ../artifacts
cargo test --locked --test mainnet -- --test-threads=1 --nocapture 2>&1 | tee ../artifacts/sandbox-tests.log
