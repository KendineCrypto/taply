#!/usr/bin/env bash
# Taply Gift build. Release WASM + sha256 (and the base58 code hash NEAR reports).
# Optional: FAULT=1 builds the test-only sandbox-fail-callback artifact (never deploy).
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then echo "CARGO_TARGET_DIR override is forbidden" >&2; exit 1; fi
mkdir -p artifacts
cargo build --locked --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/taply_gift_mainnet.wasm artifacts/taply-gift.wasm
if [[ "${FAULT:-0}" == "1" ]]; then
  cargo build --locked --target wasm32-unknown-unknown --release --features sandbox-fail-callback --target-dir target/fault
  cp target/fault/wasm32-unknown-unknown/release/taply_gift_mainnet.wasm artifacts/taply-gift-FAULT-TEST-ONLY.wasm
fi
sha256sum artifacts/*.wasm | tee artifacts/wasm.sha256
node -e '
const fs=require("fs"),c=require("crypto");
const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b=c.createHash("sha256").update(fs.readFileSync("artifacts/taply-gift.wasm")).digest();
let n=BigInt("0x"+b.toString("hex")),s="";while(n>0n){s=A[Number(n%58n)]+s;n/=58n}
for(const x of b){if(x===0)s="1"+s;else break}
console.log("NEAR code hash (base58):",s);fs.writeFileSync("artifacts/code-hash.txt",s+"\n")'
