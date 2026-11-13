# Phase 4 protocol decision record

Base: `4d2e4865577924289a1947b1967797112ea23725`. Isolated branch:
`codex/mainnet-phase4-protocol`. No release gate is opened by this work.

## Transaction reconciliation boundary

Finalized transaction execution and payment settlement are separate facts. The
wallet may retire its nonce reservation only after independently reading a FINAL,
complete causal outcome graph matching the reserved account, public key, nonce,
receiver and exact actions. A failed callback does not establish failed delivery.
Retiring a reservation never authorizes repeating its business operation: permanent
operation tombstones remain, including after failed execution. No timeout, key
nonce advancement, missing transaction, wallet rejection or absent response proves
non-submission. An external-wallet hash is a lookup hint, never proof.

Cross-device signing requires one account-global, durable CAS authority. An
IndexedDB-only journal cannot satisfy that requirement. Device ownership has no
TTL or automatic takeover; another device may reconcile but cannot submit. Loss
of the authority or an acknowledgement blocks handoff. Production authentication,
durability/no-eviction and rollback protection remain release requirements.

## Signing policy

Only one reviewed Transfer or FunctionCall per transaction. No AddKey, DeleteKey,
DeleteAccount, DeployContract, delegate action, arbitrary batching or raw message
signer. Calls must be reconstructed from fresh anchored request/config/storage
evidence with existing typed builders, never accepted from caller JSON alone.
Internal signatures bind nonce and reference block. NEAR Connect 0.12 exposes
signAndSendTransaction with network/signer/receiver/actions but no nonce argument:
the wallet chooses its nonce; reconciliation must bind the returned on-chain
transaction to the reserved action and a nonce strictly above the preflight floor.
Wallet exceptions remain uncertain, including user rejection.

## Settlement and authority

Independent payment proofs require full causal receipt graphs, pinned payment and
token code, exact amounts, data dependencies and operation nonces. Refunds remain
refunds. Retry proofs must bind a recorded failed predecessor operation; they do
not manufacture success from current state. Router funding proves NEAR delivery
only, never the customer's Base debit/refund or upstream quote attribution.

Merchant/Handshake bindings must be immutable hashed terms signed by the merchant;
session presence and backend assertions have no payment authority. R-2 cannot be
resolved on chain from a missing callback without a separately reviewed proof
mechanism. No admin override or blind retry is introduced.

## Implemented interfaces (development only)

All client exports below are from `@taply/near-client`; generated declarations
are authoritative. No HTTP route or release gate is enabled.

| Export | Integration contract |
| --- | --- |
| `createMainnetOperationPlanner(profiles).prepare(operation, snapshot)` | Reconstructs exactly one native/USDC/instant/escrow/Gift action from anchored state. Profiles pin deployment and USDC code hashes. Gift claims verify the link-key signature; Gift retry operation hashes include the recorded failed payout nonce. |
| `createMainnetWalletBackend({profiles, deviceId, signer, authority})` | `prepare(operation)` returns an immutable, expiring review. `submit(review.id, confirm)` remains disabled before any confirmation/signing call. Internal vault and external NEAR Connect use the same policies. |
| `MainnetWalletAuthority` | Semantic `read`, `reserve`, `handoff`, `uncertain`, `reconcile`. A production browser adapter must call an authenticated service, never expose Redis or raw CAS. |
| `createMainnetTransactionCoordinator` | Permanent account ledger v2, unique attempt IDs, CAS revisions, owner-device restriction, permanent operation tombstones. `reconcile(accountId, hashHint?)` verifies the chain itself. |
| `verifyMainnetTransactionExecution` | Exact signer/key/nonce/receiver/action and complete FINAL graph. Returns `FINAL_EXECUTION` with `settlement: NOT_ESTABLISHED`, or null. |
| `verifyMainnetSettlement({kind, profile}, reference)` | Native/USDC instant or Protected Pay settlement, including failed predecessor operations and NEAR-side router deliveries. Token code pin required. |
| `verifyMainnetGiftSettlement(profile, {giftId, operations})` | Claim/refund payout history, link-key authorization, every failed transfer and false callback before the successful retry. |
| `bindMainnetCommerceTerms` / `verifyMainnetCommerceBinding` | Merchant/session commitment in existing immutable memo and deterministic creation nonce; unchanged ABI. |

`MainnetOperation` supports `nativeSend`, `usdcSend`, `registerUsdc`,
`instantCreate/Pay/Cancel/Retry`, `escrowCreate/Fund/Cancel/Release/Retry`,
`giftCreate/Claim/Refund/Retry`. Direct sends require an explicit 64-hex
`businessId`, stable across crash/reload/review of the same user operation.
Never mint another business ID automatically to bypass an uncertain payment.

The server implementation is `apps/api/src/mainnet-wallet-authority.mts`:
`createMainnetWalletAuthority({principal, profiles, store})`. Its principal
contains authenticated `accountId`, `publicKey`, `deviceId`; these must not be
taken from an untrusted request body. It independently reconstructs the proposed
operation and checks the current FullAccess key, nonce and review anchor before
reservation. It never signs and never accepts a caller-provided terminal proof.
`mainnet-wallet-store.mts` supplies the account-scoped Redis CAS adapter with no
TTL. Real Redis concurrency/reconnect tests are separate from browser tests.

### Exact receipt inputs and labels

```ts
type MainnetSettlementTransaction = {
  transactionHash: string;
  signerAccountId: string;
};
type MainnetSettlementReference = {
  id: string;
  funding: MainnetSettlementTransaction;
  operations: MainnetSettlementTransaction[]; // complete nonce 1..N, ordered
  usdcCodeHash?: string; // mandatory for USDC
};
```

For instant checkout `operations[0]` is the funding transaction. Protected Pay
starts its operation list with cancel/release, followed by beneficiary-authorized
retries. Do not omit a failed predecessor. Unknown/missing/pruned evidence returns
`NOT_VERIFIED`; it never authorizes another payment. Positive results distinguish
`PAID` from `REFUNDED` and are scoped to `NEAR_SETTLEMENT_ONLY`.
`routerSurplusBaseUnits` is the delivery-minus-principal difference, **not proof
of customer refund or withdrawal**. Gift returns `VERIFIED_GIFT_SETTLEMENT` with
`CLAIMED` or `REFUNDED`; Personal Gift continues to use the direct transfer reader.

The public receipt gate remains false. Keep the existing **Payment Recorded**
label and its limitations. These verifiers independently read RPC evidence rather
than trusting wallet/server status; their trust model is `configured-rpc`, not a
validator-signature/light-client proof. Code and access-key checks span the
observed history, but do not certify that a provider is honest.

### Merchant / Handshake requirements for Claude

1. Create one public `MainnetCommerceSession` per sale: version
   `taply.commerce.v1`, network, exact contract and merchant account, 64-hex
   `sessionId` and `sessionNonce`, and `expiresAtNs`. Keep bearer/join tokens out
   of it. The authenticated session service must freeze this identity once.
2. Call `bindMainnetCommerceTerms('instant' | 'escrow', draft, session)` before
   storage quoting or request creation. It embeds the metadata commitment in
   the memo, derives an immutable request ID, and returns the exact terms hash.
   The combined memo must still fit the existing contract byte limit.
3. Creator must equal the merchant. Contract `create_request` authenticates that
   creator; payout destination is derived from the same immutable terms. Funding
   expiry cannot exceed session expiry. Changing amount/expiry/memo for the same
   session identity changes the terms hash but cannot generate a fresh request ID.
4. Payer explicitly reviews and stores that exact hash. Before funding, read the
   pinned FINAL request and verify the session commitment and reviewed hash.
   Then use the existing exact funding builder. Presence/SSE/Redis status never
   establish funding, identity ownership or settlement.
5. Existing `merchantAccountId`, `sessionBinding`, `sessionCommitment` remain
   null; native contract Handshake/merchant-registry capabilities remain disabled.
   This is a signed immutable sale commitment, not a deployed merchant registry.

### Wallet integration and migration requirements

- Keep Mainnet vault namespaces and existing mnemonic/password protections.
  Do not migrate a Testnet vault, v1 attempt, unresolved local journal or server
  ledger automatically. Legacy/corrupt records fail closed.
- Wire the new backend through the authenticated semantic authority. Current UI
  still uses the previous disabled native backend; this protocol branch does not
  modify `apps/web`. Replacing that adapter and reviewing user confirmations is
  explicit Claude integration work, not evidence already delivered here.
- Store the last review, attempt ID, business ID and hash hint. A hash returned
  by NEAR Connect is only a lookup hint. SDK 0.12 wallets that cannot report their
  account public key are unsupported; do not guess it or remove that check.
- No device takeover, automatic retry, time-based clearing or ledger reset. A
  second device is read/reconciliation-only. More than 256 tombstones or the
  bounded record size requires reviewed archival; never prune replay history.
- Production authentication, durable Redis/no eviction, rollback detection and
  account enrollment recovery remain unresolved deployment requirements. The
  semantic service is implemented and tested, but no authenticated HTTP adapter
  is exposed. Redis availability alone does not prove these guarantees.

## Security decision and remaining functional gaps

**NO-GO for real funds or a claim of complete functional Mainnet parity.**

R-2 remains possible: successful transfer followed by failed/unknown callback
leaves contract state IN_FLIGHT/PENDING. Wallet execution reconciliation may
retire a nonce reservation but cannot repair contract state or authorize repayment.
The new settlement verifier requires the successful contract callback and refuses
to label those R-2 cases settled. No owner override or contract retry is added.

Router gas remains unproven against the actual USDC/1Click path. Existing local
standard-token tests exercise 40 TGas held-unclaimed and 50+ TGas payout, with
15 TGas transfer/callback allocations. Receiver failure can still return funds to
`intents.near` instead of the origin customer. Current accounting retains valid
receiver executions, but cannot persist anything after a receiver rollback.
No inference from local gas margins closes this blocker. `intentsRouter:false`,
signing, funded quote and public independent-verification gates remain false.

Still absent: owner-approved deployment/configuration, physical NEAR Connect
acceptance with these policies, authenticated durable authority integration,
Mainnet end-to-end payment/Gift/Protected evidence, complete upstream cross-chain
refund attribution, UI migration and receipt wiring, historical index, and a
safe R-2 on-chain recovery mechanism. Solana/Tron route discovery remains in the
existing inventory; this work provides no new verified live route evidence.

## Reproducible verification and evidence boundaries

- `pnpm check` runs all workspace builds/types/lint/tests. A local Windows run
  passed shared/near-client tests but hit two existing 5-second web test timeouts;
  the same two files passed all 74 tests with `vitest run ... --maxWorkers=1`
  without changing timeouts. The complete rerun with `VITEST_MAX_WORKERS=2 pnpm
  check` exited 0: shared 93, near-client 322, web 1,502 passed / 14 skipped.
  This only bounds worker parallelism; no test, assertion or timeout was changed.
  Final Linux CI remains required.
- `node --test packages/near-client/test/mainnet-reconciliation.test.mjs`
  tests finalized execution, unknown outcomes, CAS races, lost acknowledgements,
  exact calls, stale nonces, cross-device restrictions and permanent tombstones.
- `mainnet-operation-policy.test.mjs`, `mainnet-settlement-receipts.test.mjs`,
  `mainnet-payout-receipt.test.mjs`, `mainnet-commerce-binding.test.mjs` exercise
  adversarial synthetic RPC evidence. They are not live Mainnet evidence.
- `node --test apps/api/test/mainnet-wallet-authority.test.mts` checks independent
  server reconstruction; `redis-store.test.mts` uses real Redis when available,
  including an AOF/always-fsync/no-eviction process-kill/restart test. This test
  configuration is not evidence that production Redis meets those guarantees.
- The existing Chromium IndexedDB harness additionally tests the v2 coordinator
  across tabs, renderer crash, restart and another device. Its v2 shared authority
  is a test-only HTTP CAS simulation; it does not certify production durability.
- `mainnet-core-candidate` builds Rust 1.95 and runs a real local NEAR sandbox.
  The new Node bridge checks actual receipts with **only a test genesis adapter**;
  raw responses are exported as artifacts. The RPC request ID remains exact.
  Local Rust is unavailable on this Windows host; Rust evidence comes from CI.

Subsystem `ee38e8af08264b7c7cef0f749e896718d85cb02e` passed
[Workspace CI](https://github.com/KendineCrypto/taply/actions/runs/43474371217).
Subsystem `2e1d262340418082bf8450e34337e1ccac51aab8` passed
[Core CI including actual native and USDC receipt verification](https://github.com/KendineCrypto/taply/actions/runs/43478762655).
The updated Chromium harness passed all 7 checks locally (four existing
IndexedDB checks plus three v2 global-authority/crash/device checks). Its initial
CI failure came from registering a test-only POST handler after Vite's terminal
middleware; the handler is now registered through `configureServer`. No wallet
policy or assertion was loosened to resolve it.
Subsequent sandbox development runs caught a formatting error and a test bridge
RPC-ID mismatch; these failures were fixed, not bypassed. Final seven-workflow
results must be checked against the exact delivered SHA; earlier green commits
do not certify later changes. No live transaction was signed or sent.
