#!/usr/bin/env bash
# Real local NEAR node (near-workspaces). Needs `FAULT=1 scripts/build.sh` first
# (the fault artifact is TEST-ONLY and proves "unknown outcome is never re-paid").
set -euo pipefail
cd "$(dirname "$0")/../sandbox"
mkdir -p ../artifacts
cargo test --locked -- --test-threads=1 --nocapture 2>&1 | tee ../artifacts/sandbox-tests.log
