# Mainnet functional parity: protocol handoff

Base: `8ca50598ad5ad8bc7dbe86239f0df98ed58a0709`. Development branch:
`codex/mainnet-parity-protocol`. This document specifies implementation boundaries;
it is not evidence of deployment, successful tests or release approval.

## Stable boundaries

The deployed Testnet crates and `payments-mainnet` instant ABI remain unchanged.
New escrow and Gift candidates live in independent crates. Their distinct versions,
network, immutable constructor configuration and code hashes must be checked before
building calls. An account address alone is never deployment identity.

Mainnet wallet records use separate storage and authenticated `near-mainnet`
metadata. Testnet encrypted backups and sessions are rejected, including when
copied into Mainnet storage. Explicit phrase restoration derives the standard NEAR
key; it does not prove account activation. Local creation is not chain creation.
Activation requires final Mainnet account and FullAccess key evidence. There is no
faucet, named-account sponsor, key-deletion helper or automatic activation transfer.

Signing remains unavailable in the shipped application. Implementations must retain
password unlock, exact transaction review, signer/key/network/nonce binding and
fresh final balance checks. No general raw-message wallet signer is exported.
External wallet handoff is a potentially submitted transaction before its response
arrives; cancellation, timeout or absent hash is not evidence of non-payment.

Durable attempt storage must atomically reserve an operation before handoff and
serialize account/key nonce use. Unknown outcomes survive reload and block another
potential payment. A time limit or expired block hash alone cannot prove that an
earlier transaction failed. Only independent final evidence permits resolution.
Storage failure blocks signing; failure after handoff remains uncertain.

## Gift candidate

No Mainnet Gift account, fee or amount limits have been approved. Constructor inputs
must explicitly bind `network`, `contract_id`, `min_amount`, `max_amount` and `fee`;
there are no Mainnet defaults copied from Testnet. Sandbox values are test data.
The separate Gift account must not equal payment, recovery or staging accounts.
The production profile remains unconfigured until owner approval.

Preserve 32-hex Gift IDs, one-use fragment link keys, contract-bound beneficiary
signatures, first-claim reservation, creator-only expiry refund and beneficiary-only
known-failure retry. Mainnet claim signatures use a distinct domain to prevent
cross-network reuse. Unknown payout callbacks remain pending with no retry or
administrative settlement override.

## Escrow candidate and R-2

Use an independent Mainnet escrow crate with a distinct version and explicit
contract identity. Preserve immutable consent/cutoff, exact deposits, storage bond,
operation nonce, private callbacks and per-asset conservation. Router delivery is
not supported by escrow; the instant contract retains all router/unclaimed handling.
The escrow account must never be used as a 1Click recipient.

`LOCKED` is not paid. `*_IN_FLIGHT` is unresolved even if a transfer may have
succeeded. Only a successful, matching callback records settlement; only a recorded
transfer failure allows retry of the same beneficiary and obligation. R-2 is
contained by refusing retry after unknown outcomes, not eliminated. Mainnet escrow
release requires separate security acceptance.

## Integration and release

Claude must import the new explicit Mainnet exports rather than adapt Testnet
schemas using casts. Merchant/Handshake bindings must be committed into exact
on-chain terms; authenticated session identity and websocket status never settle a
payment. Independent receipts must establish transaction/receipt ancestry, exact
beneficiary and amount, finality, deployment identity and callback outcome. Contract
state alone is labelled Payment Recorded, not independently Verified Paid.

Keep `MAINNET_SIGNING_RELEASE_APPROVED`,
`ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED`,
`MAINNET_INDEPENDENT_VERIFIER_AVAILABLE` and `intentsRouter` false.
No deployment, funding, production merge or account-key action is authorized.
## Implemented interfaces and remaining gaps

This is a protocol implementation candidate, not release acceptance. In addition
to the application gates, `MAINNET_PROTOCOL_SIGNING_RELEASED` is immutable false.

### Wallet

`EncryptedMainnetVault` uses `taply.mainnet-vault.v1`, authenticated Mainnet
metadata, twelve BIP39 words, the existing NEAR derivation path, password unlock,
PBKDF2/AES-GCM and session expiration. It never activates an account. Explicit
phrase import is deliberate; relabeling a Testnet encrypted backup is rejected.
The existing Testnet vault and its storage are untouched.

`createMainnetWalletChain(profile).snapshot(accountId, publicKey)` verifies genesis,
final account/key/nonce and storage/gas budgets. `prepareMainnetNativeTransfer`
and `prepareMainnetUsdcTransfer` build exact unsigned calls; USDC evidence binds
both registrations, balance, accounts and the final block.

`createMainnetNativeWalletBackend({profile,store,signer})` exposes
`prepare(receiverId,amountNear)`, `submit(reviewId,confirm)` and `readAttempt()`.
Immutable 60-second reviews bind recipient, exact amount, signer/key, nonce,
block and reserves. Submission rejects before confirmation, reservation or signing
while the gate is false. External signing is an adapter interface, not tested
physical-wallet integration. Contract/token signing is not accepted by this engine.

`openMainnetAttemptStore()` uses strict-durability IndexedDB transactions.
`createMainnetAttemptJournal()` reserves unique attempts with atomic CAS before
handoff. RESERVED, HANDOFF and UNCERTAIN block replacement, including after lost
write acknowledgements. No TTL, eviction, clear or override exists. **Terminal
reconciliation is not implemented**, so subsequent transactions remain blocked.
Browser deletion/rollback and multiple-device policy also remain release gaps.

### Gift

Crate `contracts/gift-mainnet`, version `0.2.0-mainnet`. Private constructor JSON:
`{network:"near-mainnet",contract_id,min_amount,max_amount,fee}`. U128 amounts are
decimal strings. Account, minimum, maximum and fee require separate owner approval;
sandbox values are not production defaults.

Methods: `create_gift`, `claim_gift`, `refund_gift`, `retry_payout`, `get_gift`,
`get_config`, `get_accounting`; `on_payout(gift_id,nonce)` is private. Creation
attaches principal plus configured fee. Claim/refund/retry attach zero deposit.
Missing callbacks remain PENDING with no retry. Exact ABI lives in
`contracts/gift-mainnet/src/lib.rs`; frontend code should use typed builders.

Client exports: `MainnetGiftConfigSchema`, `MainnetGiftProfileSchema`,
`createMainnetGiftReader`, `prepareMainnetCreateGift`,
`prepareMainnetGiftSettlement`, `signMainnetGiftClaim`. The last signs with the
one-use link key, not a wallet key. Domain `taply-gift-claim:near-mainnet:v1`
also binds contract, Gift ID and claimant; Rust/TypeScript share a frozen vector.
The existing envelope UI still needs explicit integration with this new backend.

### Protected Pay

Crate `contracts/payments-protected-mainnet`, version `0.7.0-mainnet`. Private
constructor JSON: `{network:"near-mainnet",contractId,tokens}`. Tokens may be
empty or the exact approved Mainnet USDC identity/metadata. Caps: 1 NEAR/25 USDC.
The separate escrow account is not configured or approved for deployment.

Methods: `quote_create_request`, `create_request`, `get_request`, `get_receipt`,
`cancel_unfunded`, `pay_instant_native`, `fund_protected_native`, `cancel_protected`,
`release_protected`, `retry_native_transfer`, `ft_on_transfer`, `get_config`,
`get_accounting`. Transfer callbacks are private. Contract `get_receipt` is state,
not independent proof.

Shared exports: `MainnetEscrowRequestSchema`, `calculateMainnetEscrowTermsHash`.
Near-client exports: `MainnetEscrowConfigSchema`, `MainnetEscrowProfileSchema`,
`createMainnetEscrowReader`, `prepareMainnetCreateProtectedRequest`,
`prepareMainnetFundProtectedNative`, `prepareMainnetCancelProtected`,
`prepareMainnetReleaseProtected`, `prepareMainnetRetryProtectedTransfer`,
`prepareMainnetProtectedTokenFunding`. These check consent, exact principal,
cutoff, immutable terms, configuration, gas and recorded failure. TypeScript
tests parse Rust-emitted states and independently recalculate their hashes.

Never direct 1Click to escrow: NEP-141 rejection can refund the router rather
than the customer. `intentsRouter:false` remains unchanged. The separate instant
crate retains existing unclaimed accounting; these additions prove no upstream
router gas guarantee or recovery attribution.

### Verification evidence

`verifyMainnetDirectTransfer` checks a plain native transfer for Personal Gift.
`verifyMainnetNativePayment` and `verifyMainnetGiftReceipt` inspect final receipt
ancestry, exact payout, callback dependencies, pinned code and authority continuity.
Gift also verifies the claim signature/refund identity. This trusts configured
RPC, not a light client. Contract verifiers currently support first-attempt native
settlement only. USDC/router, retries and independent Protected Pay receipts are
not implemented. Adversarial RPC fixtures are synthetic; they do not prove live
Mainnet settlement or every sandbox receipt graph. Keep the public verifier gate
false and do not promote these results to public Verified Paid yet.

Run `pnpm check`. Workspace CI retains 88 checkout and 98 product browser checks;
the additional IndexedDB browser test checks cross-tab CAS, stale fencing, renderer
crash and browser restart. Fixture screens prove UI behavior only.
`mainnet-protocol-parity.yml` runs Rust 1.95 locked unit tests, clippy, WASM builds
and real local NEAR sandbox tests for both new crates. Fault-only WASMs lose
callbacks deliberately and must never be deployed. Development CI caught a Gift
worst-case storage fixture mismatch and delayed gas refunds in a balance test;
failed runs are not certification. Consult the exact final commit's CI result.

Still required: terminal attempt reconciliation; cross-device/rollback policy;
physical-wallet acceptance and contract/token signing policies; Gift envelope/UI
wiring; owner-approved account/cap configuration; actual authorized activation and
signed end-to-end evidence; token/router/retry/escrow receipts; immutable merchant
and Handshake contract bindings; upstream router gas and production ledger review.
R-2 is contained by refusing uncertain retries, not eliminated.

**NO-GO for funds and for claiming complete functional parity.** This branch is
a substantial protocol review candidate, not a working Mainnet release. No
deployment, Mainnet signing, funding or key deletion occurred.

## Observed development evidence

Implementation commit `c6c0846023c535eceaedb399117dd373b96d38b7`:

- [Protocol CI passed](https://github.com/KendineCrypto/taply/actions/runs/43457230378):
  Gift 25 unit / 5 sandbox tests; escrow 30 unit / 8 sandbox tests, including
  unknown native refund/release callbacks with exact beneficiary balance checks.
- [Workspace CI passed](https://github.com/KendineCrypto/taply/actions/runs/43457360386):
  complete workspace/API checks, real Redis tests, production and Mainnet preview
  builds, 88 checkout + 98 product + 4 IndexedDB browser checks.
- Local `pnpm check` exited 0: shared 93, near-client 290, web 1,457 passed / 14
  skipped. Local Rust is unavailable; the contract evidence is Linux CI evidence.
- [Public read-only evidence](evidence/mainnet-protocol-live-read-2026-11-13.json)
  observes verified Mainnet genesis, staging account balance zero, empty code hash,
  and a final FullAccess key/nonce/storage/gas snapshot. Reproduce with
  `node packages/near-client/test/mainnet-protocol-readonly.mjs` after building.
  No secret keys are read. This proves neither ownership nor a candidate deployment.

Observed non-fault WASM builds (the contract source is unchanged by the later
test-only callback-measurement fix):

| Candidate | Bytes | SHA-256 as NEAR base58 | Code-only storage floor |
|---|---:|---|---:|
| Gift | 271017 | `grGcaxEy9XSaSXx4ZQQLBiBXvjD1ZwWJSCdB6z698Lk` | 2.71017 NEAR |
| Protected Pay | 434829 | `6BP6KnkHBTCZQDc7eUhLpf8WTGxgFNVZLFJbZFUCuwLC` | 4.34829 NEAR |

The floor uses the observed protocol price of 10^19 yoctoNEAR per byte. It excludes
account/key bytes, constructor state, request storage and transaction gas. It is
not a funding instruction or a complete deployment budget. Fault-only artifacts
are excluded. Pin the final reviewed artifact again before any authorized release.
