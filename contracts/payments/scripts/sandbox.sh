#!/usr/bin/env bash
set -euo pipefail
if [[ "${TAPLY_SANDBOX_MERCHANT_V1:-}" == "1" ]]; then
  exec bash "$(dirname "$0")/../../payments-merchant/scripts/sandbox.sh" "$@"
fi
if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then echo "CARGO_TARGET_DIR override is forbidden" >&2; exit 1; fi
cd "$(dirname "$0")/../sandbox"
mkdir -p ../artifacts
cargo test --locked -- --test-threads=1 --nocapture 2>&1 | tee ../artifacts/sandbox-tests.log
