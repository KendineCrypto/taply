#!/usr/bin/env bash
# Real local NEAR node (near-workspaces). Needs scripts/build.sh first.
set -euo pipefail
cd "$(dirname "$0")/../sandbox"
mkdir -p ../artifacts
cargo test --locked -- --test-threads=1 --nocapture 2>&1 | tee ../artifacts/sandbox-tests.log
