# Phase 7G future separate Testnet deployment preparation

Preparation only. No account has been selected, created, funded, signed or
deployed. Existing `taply-pay-pilot-1.testnet` must not be upgraded or reused.
The operator must propose a **new dedicated Testnet contract account**, an
independently controlled merchant receiver and customer, and review the exact
public IDs/upgrade authority. No private keys belong in this repository/backend.

## Reproduction and byte preflight

Use Rust 1.95.0, wasm32-unknown-unknown, near-sdk 5.30.0, near-workspaces 0.24.0,
nearcore sandbox 2.14.0, Node 24.22.2, pnpm 11.5.0 and committed lockfiles.
The root lockfile is unchanged. Tool installation/caches belong outside source.

```sh
pnpm install --frozen-lockfile
pnpm --filter @taply/shared build
cd contracts/payments
cargo fmt --all --check
cargo fmt --manifest-path sandbox/Cargo.toml --all --check
cargo test --locked --lib
cargo test --locked --lib --features merchant-bound-v1
cargo clippy --locked --all-targets --features merchant-bound-v1 -- -D warnings
bash scripts/build-merchant.sh
node --test test/preflight.test.mjs
TAPLY_SANDBOX_MERCHANT_V1=1 bash scripts/sandbox.sh
```

Build `scripts/build-merchant.sh` a second time and compare SHA-256 of both
production candidate outputs. Never overwrite the approved pilot artifacts or
promote `payments.callback-fault.wasm`. `abi.merchant-v1.json` is the versioned
candidate ABI; `MERCHANT_V1.md` documents all compatibility/validation differences.

`preflight-merchant.mjs` takes four positional values: candidate WASM path,
operator-selected new account, independently reviewed SHA-256, independently
reviewed NEAR base58 code hash. It checks both hashes, exactly 12 method exports
and refusal to reuse the existing pilot. Example with operator-supplied shell
variables, **offline only**:

```sh
node scripts/preflight-merchant.mjs "$TAPLY_CANDIDATE_WASM" "$TAPLY_NEW_CONTRACT_ID" "$TAPLY_REVIEWED_SHA256" "$TAPLY_REVIEWED_CODE_HASH"
```

A hash supplied on the command line is not approval. Code hash is base58 of
SHA-256 of the exact WASM. Record compiler/target/flags, source commit, Cargo.lock
hash, byte length and both hashes in the review. SDK NEP-330 package metadata
retains the base package version; candidate identity is the reviewed artifact
hash plus `get_config.contractVersion == 0.5.0-merchant.1`, not metadata alone.

Current cloud candidate build SHA-256:
`6af31a17a3c425d9a825084e2961a4bf30e22b82dc30e6fce190890871845a5c`.
This is an **unapproved candidate**, not deployed code. Reproduction is required
on the review host. The pre-existing local default artifact in this cloud snapshot
is also unapproved (SHA-256 `245068f8871d419971b598fd30e0346e935b173bdab9dd547124dc470455a12c`),
not the historical approved pilot bytes. Both pre-existing default artifact files
were preserved. The historical deployed pin remains SHA-256
`a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2`,
code hash `BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`.
No fresh deployed-code observation was made.

## Required pre-deployment review

- Obtain a **passing candidate sandbox run**, including storage delta, failed
  transfer, successful-transfer/failed-callback, double funding and replay cases.
  Cloud currently cannot start nearcore: hard NOFILE 16384 < required 65535.
  Set that host resource limit through approved environment configuration; do
  not patch the node, disable certificate verification or skip failure cases.
- Current safe gas floors: creation 30 Tgas; funding/retry 50; cancel 15;
  callback 15. Runtime measures remain a gate, not a claimed new measurement.
- Exact creation storage: 33-byte key + Borsh record + 40 protocol overhead;
  bound requests add a permanent 105-byte sale tombstone. Quote each exact request
  at a fresh final block. Deposit must equal quoted bytes * runtime byte cost.
  Do not substitute a constant bond. No bond withdrawal/cleanup is implemented.
- Account reserve must cover actual runtime storage plus all failed-held
  obligations and each outgoing principal. Contract checks liquidity before
  transfer. Operational storage/init reserves depend on the selected account and
  measured runtime; no invented funding amount is provided.
- Review direct authorization, recipient identity, session uniqueness, canonical
  v1 fixtures, input bounds, code hash policy and upgrade authority. No backend
  payout, arbitrary admin payout, refund or in-flight timeout reset exists.
- Approve new account creation, funding, deploy/init **individually**. Use a
  reviewed operator CLI and exact bytes; no commands in this preparation sign.

## Init and post-deployment checks

Require a genuinely new/uninitialized account. `new {}` must execute privately
once from the contract account; foreign initialization and reinitialization
must fail. Deploy/init should be one reviewed atomic action sequence so no
uninitialized public window exists. Do not use existing state or a live migration.

Before any funding approval, independently read exact Testnet genesis/network,
final block, account code hash and `get_config` at that same block. Verify:
contractId is the selected dedicated account; version 0.5.0-merchant.1;
intent v1/event 0.4.0/quote 1; instantNative and handshake true; all other
capabilities false; testFaultBuild false; gas/storage/callback policies exact.
The old 0.4.0 config adapter intentionally refuses this candidate version. A
reviewed config/signing/receipt integration is still required before live G2.

Verify empty initial accounting, no existing request, exact quote and storage
costs. An on-chain config response cannot approve itself. Any hash/version/block
inconsistency stops the exercise. Archive only public identities, byte hashes,
block provenance and sanitized test results.

## Two-device acceptance (separate signature/transaction approvals)

1. Record OS/browser/wallet versions and trusted same-origin HTTPS on both devices.
2. Prove each selected wallet's NEP-413 capability with exact challenge/callback
   behavior, fresh finalized FullAccess association, decline/wrong-account/replay/
   revoked-key/outage failures. No signature prompt is automatic.
3. Review secure host/ACL/key/recovery configuration and external freshness
   provider; integrate async fencing into all auth and room decisions. Do not
   activate the current synchronous store based on the controlled model tests.
4. Merchant explicitly creates a draft and signs one new bound request after
   reviewing exact receiver, amount, asset, funding/session expiry and storage.
5. Both independently read the approved deployment, exact canonical request and
   immutable session, compare independently calculated code, and explicitly
   review exact terms. A room event can prompt reads, never authorize payment.
6. Customer explicitly approves exact funding. Verify payout and private callback,
   finalized chain state and **independent receipt graph** on each device.
7. Reject forged merchant/recipient/hash/session, duplicate sale/funding, stale
   evidence, wrong payer/account, logout during awaits and malicious room claims.
8. Repeat a separate sale, visibility/reconnect/expiry/restart/outage flows; archive
   public transaction/receipt evidence only when actually observed.

## Incident and rollback

Keep auth/live G2 gates closed until all checks have actual evidence. On mismatch,
unknown outcome or callback stall: stop new signing, preserve journals/public
transaction IDs, independently reconcile chain state. **Never retry or refund an
in-flight transfer**. Closing a room does not cancel an on-chain obligation.

Disable affected coordination/signing entry points through a separately reviewed
operator change. Preserve DB/WAL/SHM/backups and external authority evidence. Never
restore an auth snapshot as current authority, reset a freshness head, reuse an
epoch, clear consumed records or rotate encryption keys in place. Uncertain
cross-system commit requires quarantined recovery and invalidation of old auth/
join authority; it changes no on-chain funds. No automatic recovery is supplied.

Never upgrade/overwrite the approved pilot or a candidate with outstanding
obligations to make tests pass. Contract rollback/upgrade is a new transaction
requiring security review of all in-flight operations and explicit approval.
Prefer a separately approved new deployment/account and preserve historical
receipt verifiability. No deployment or rollback transaction is authorized here.
