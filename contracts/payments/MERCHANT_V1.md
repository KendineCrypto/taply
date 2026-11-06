# Source isolation notice

Candidate source and validation now live in `../payments-merchant/`. In the commands below use `cd contracts/payments-merchant`. G1 no longer defines the merchant feature. Legacy build/sandbox scripts forward explicitly; outputs are in the candidate directory.

# Candidate merchant contract 0.5.0-merchant.1

This is an isolated opt-in build (`--features merchant-bound-v1`), not an upgrade
of `taply-pay-pilot-1.testnet`. Default 0.4.0 still refuses merchant/session terms.
No deployment or actual Testnet transaction is authorized or performed.

`abi.merchant-v1.json` enumerates the same methods/JSON arguments as `abi.json`.
`get_config.contractVersion` is `0.5.0-merchant.1`; `capabilities.handshake` is
true for contract binding support only. It does not certify live G2/auth/identity.
Frozen `taply.intent.v1`, config envelope v1, event `0.4.0`, hash domains, exact
amounts, direct signer authorization, private callback and retry ABI are unchanged.
The old near-client config schema deliberately refuses this new contract version.
An independently reviewed candidate deployment/config adapter is required.

Binding rules: both merchantAccountId/sessionBinding null preserves ordinary
Instant Pay. Otherwise both must be present; merchant equals creator/receiver.
Creation checks signer == predecessor == creator, with no backend/delegated
creation. Session ID is frozen lowercase UUIDv4; nonce is lowercase 32-byte hex;
expiry must be after creation, within 120 seconds, and <= funding expiry.
The canonical commitment is SHA256("taply.session.v1\n" + termsHash ASCII).
No mutation method exists. Funding requires the exact original termsHash and
principal, with on-chain funding expiry. Session expiry ends coordination only;
it never refunds or changes an already created payment's funding rules.

Permanent creator-scoped session-ID tombstones prevent another request for the
same sale with a different creation nonce/session nonce. Creation nonce reuse is
still prevented by the permanent deterministic request record. Cancellation does
not release either tombstone. There is no administration/withdrawal/refund method.

Storage: quote is exact `(33 + Borsh record bytes + 40)` bytes, plus **105 bytes**
for a bound sale's permanent key/value/record overhead (33 + 32 + 40).
Deposit is exact bytes * runtime storage byte cost; creation verifies actual
storage delta and rejects protocol changes. No fixed bond or storage refund.
All later transitions have fixed storage size. Maximum memo is 256 UTF-8 bytes;
ABI input limit is 8192 bytes, UUID 36 bytes, nonces/hashes 64 hex characters,
accounts at most 64 bytes, amounts u128 and times u64 canonical decimal strings.
Gas floors remain create 30 Tgas, fund/retry 50, cancel 15, callback allocation 15.
These floors and actual storage/gas behavior require a passing candidate sandbox
run before deployment; current Cloud node startup is blocked by hard NOFILE 16384
versus required 65535. No sandbox success is claimed for this candidate.

Build with pinned Rust 1.95.0/near-sdk 5.30.0/Cargo.lock and the checked-in
.cargo/config.toml (`target-cpu=mvp`, `--cfg near`):

```sh
cd contracts/payments
cargo test --locked --lib
cargo test --locked --lib --features merchant-bound-v1
cargo clippy --locked --all-targets --features merchant-bound-v1 -- -D warnings
bash scripts/build-merchant.sh
# Set NEAR_SANDBOX_BIN_PATH only to the pinned nearcore 2.14.0 binary if needed.
TAPLY_SANDBOX_MERCHANT_V1=1 bash scripts/sandbox.sh
```

Candidate artifacts go only to `artifacts/merchant-v1/`. The fault build is for
sandbox failure injection and must never be deployed. Do not overwrite the
operator's approved pilot artifact. SHA-256/base58 hashes identify bytes, not
approval. Rebuild twice and compare before proposing deployment.

Missing/failed callback remains PAYOUT_IN_FLIGHT with no retry, refund, timeout
reset or admin override. Recorded transfer failure permits only recipient retry
to the original receiver with matching operation nonce. This known availability
limitation is preserved to prevent duplicate payouts.
