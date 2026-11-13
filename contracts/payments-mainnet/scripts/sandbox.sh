#!/usr/bin/env bash
# Inherited reference suite has not been ported to fixed mainnet identities.
# Refuse to misrepresent Testnet fixtures as mainnet sandbox proof.
echo 'BLOCKED: mainnet sandbox migration and gas-envelope proof are not implemented' >&2
exit 1
set -euo pipefail
cd "$(dirname "$0")/../sandbox"
mkdir -p ../artifacts
cargo test --locked -- --test-threads=1 --nocapture 2>&1 | tee ../artifacts/sandbox-tests.log
