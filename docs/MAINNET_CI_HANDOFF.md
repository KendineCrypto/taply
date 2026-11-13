# Mainnet core CI and Claude integration handoff

2026-11-13. **NO-GO for Mainnet funds.** Branch `codex/mainnet-core` is
pushed to `KendineCrypto/taply`; no merge, deployment, signing, funding, account
creation, key deletion, DNS or hosting action is included in this workflow.

## Verification record

**Passing executable revision:** `1df9405fde79ddc355b9ee37685ec44c88340655`.
[Successful CI run](https://github.com/KendineCrypto/taply/actions/runs/43417716603).
The follow-up handoff commit adds checked-in rustfmt output, a formatting gate
and documentation; it does not change contract logic. GitHub Actions installs Rust 1.95.0 with rustfmt,
Clippy and wasm32-unknown-unknown; the contract and sandbox use locked Cargo
dependencies. The sandbox runs a real local NEAR node with a standard test token
at the configured USDC identity. It does not execute live USDC or Intents code.

| Check | Observed result |
| --- | --- |
| Contract unit tests | 10 passed, 0 failed, 0 ignored |
| Clippy, all contract targets, warnings denied | Passed |
| Production and separate fault WASM builds | Passed; default rebuild matches original production artifact |
| Real NEAR sandbox / adversarial router suite | 7 passed, 0 failed, 0 ignored |
| Shared TypeScript wire integration | 16 actual sandbox records validated across OPEN, PAYOUT_IN_FLIGHT, PAYOUT_FAILED_RECOVERABLE, FINAL_PAID |
| Deployment planner | 5 passed, 0 failed |
| Frozen existing contract input check | Passed |

Sandbox coverage includes exact native/USDC merchant balances, direct amount
mismatches/refunds, overpayment, duplicate/concurrent attempts, malformed and
oversized messages, wrong hash/asset/mode/payer, cancelled/unknown/expired
requests, underpayment, low gas, failed payout and explicit retry, unauthorized
or excessive recovery, failed/successful recovery, token conservation, and both
payout/recovery unknown callbacks. Unit tests additionally cover request caps,
cross-network terms, self recipient, wrong token, private/stale callbacks and
hostile message fuzzing. No test is a substitute for live token/router evidence.

Artifact: `mainnet-core-verification-1df9405fde79ddc355b9ee37685ec44c88340655`
on the linked run (14-day Actions retention). Production WASM:

- Size: **457,001 bytes**.
- SHA-256 hex: `8d8edfff8cdc24f290e6ed9e97dc3d60ad52965b0cd118a0c2dd5a3461e6ea14`.
- NEAR code hash: `AXaqzkMuA8fgX2ywEGUxr44ASnVe2otBiefutxVrJaE7`.
- Code storage alone at 10^19 yoctoNEAR/byte: **4.57001 NEAR**.
  Excludes account/state storage, token registration, gas and operating reserve;
  this is not a complete funding requirement or a request to fund anything.
  The read-only deployment planner calculates those components from fresh RPC
  data and refuses an existing-code replacement. No live deployment was run.
- Observed fixture request bond: 585 bytes / 0.00585 NEAR for USDC requests.
  Always use the exact quote for each request, not this fixture value.

The original Windows environment still has no Cargo and no working Docker
backend. CI has removed that compilation blocker: 10 unit tests, Clippy and
WASM compilation passed in run 43416707397. Its sandbox run failed on strict
empty view arguments and an incorrect test expectation that 50 TGas would hold
rather than settle. Both test-harness issues were corrected without changing
contract guards. The first compile error (ambiguous `.into()` for method names)
and the Clippy host-feature configuration error were also corrected.

Existing Protected Pay CI passed its unit tests, Clippy, WASM, seven sandbox
tests and wire checks at `657db77f824fa5fff35b5aa069cfcd190841a8db`:
https://github.com/KendineCrypto/taply/actions/runs/43415570019
The existing deployed contract sources remain unchanged from `6776cdd`.

## Security reassessment

**Router gas:** the candidate only reserves a payout when at least 40 TGas
remains after request validation. It attaches 15 TGas to token payout and 15 to
the callback. Semantic rejects and low payout gas are retained in a fixed-size
ledger when the receiver has enough gas to complete. This does not guarantee
successful execution of deserialization, accounting and logging at arbitrary
gas/message sizes. State rolls back on receiver failure; token resolution can
return funds to `intents.near` without crediting the origin customer.

Measured standard-token outer `ft_transfer_call` gas sweep:

| Attached gas | Outcome | Total receipt gas burned |
| --- | --- | --- |
| 40 TGas | OPEN, full delivery unclaimed, LOW_GAS | 6.851 TGas |
| 50 TGas | Exact merchant payout, FINAL_PAID | 12.511 TGas |
| 60 / 80 / 100 / 150 / 300 TGas | Exact merchant payout, FINAL_PAID | approximately 12.51 TGas |

At 50 TGas, receiver execution burned 3.142 TGas, token payout 1.830 TGas,
and payout callback 2.282 TGas of its attached 15 TGas. These measured margins
apply to this sandbox and standard token only. They do not prove the live USDC
implementation's forwarding costs or the 1Click solver's gas allocation.

The [Intents API documentation](https://near.github.io/intents/defuse_core/intents/tokens/struct.FtWithdraw.html)
lists a 30 TGas minimum and 50 TGas default minimum for the outer FT transfer
call, with surplus gas shared among generated calls. That is not a contractual
guarantee of Taply receiver gas. The [withdrawal documentation](https://docs.agentsonintents.com/integration/verifier-contract/deposits-and-withdrawals/withdrawals)
explicitly excludes withdrawals with a message from automatic refund protection.
Keep `intentsRouter:false` and quote/signing UI disabled until an accepted,
bounded upstream execution envelope and actual USDC/1Click evidence exist.

**Unclaimed balances:** received tokens must equal confirmed paid, refunded,
locked, failed held, payout in flight, unclaimed held, unclaimed in flight and
unclaimed withdrawn combined. Actual contract token balance must cover held
obligations; in-flight balances may already have transferred. Recovery is a
direct call by `kendinecrypto.near`, reserves before transfer, cannot take request
principal, and allows one operation at a time. Known transfer failure restores
held funds. Attribution to the origin customer remains a manual, trusted owner
decision; events and aggregate totals are not cryptographic customer claims.
Plain `ft_transfer` donations are outside the ledger. Lifetime arithmetic
overflow fails closed and is another limit on an unconditional non-panic claim.

**R-2:** payout or recovery transfer can succeed while its callback fails.
The request/recovery then stays in flight. No retry, timeout-based retry,
administrative finalization or re-payment is allowed. A separate fault-injection
WASM tests this behavior; it is not the production candidate. The issue is
contained against double payout and false finality, not eliminated. See
[R2_REACHABILITY.md](R2_REACHABILITY.md) for the original analysis; its Testnet
gas observations do not constitute measurements of this new Mainnet candidate.

## Claude integration contract

Normative ABI: [MAINNET.md](MAINNET.md), with errors and reason codes in
[ABI.md](../contracts/payments-mainnet/ABI.md). Constructor, caps and message
format are unchanged from interface commit
`197af1e08a573e8bab0285cb0fd80284fe993448`.

`@taply/shared` exports:

- `MainnetIntentTermsSchema`, `MainnetRequestSchema`, `MainnetAccountSchema`,
  `MainnetContractIdSchema`;
- `calculateMainnetRequestId`, `calculateMainnetTermsHash`,
  `buildInstantRecipientMessage`;
- `MAINNET_USDC`, `MAINNET_USDC_ASSET`, `MAINNET_NATIVE_CAP`, `MAINNET_USDC_CAP`.

`@taply/near-client` exports:

- `MainnetProfileSchema`, `MainnetContractConfigSchema`,
  `mainnetConfigProblems`, `createMainnetReader`;
- `prepareMainnetCreateRequest`, `prepareMainnetPayment`,
  `prepareMainnetTokenStorageDeposit`, `prepareMainnetCancelUnfunded`,
  `prepareMainnetRetryPayout`;
- `MAINNET_GENESIS_HASH`, `MAINNET_RPC_URLS`, `MAINNET_EXPLORER`,
  `MAINNET_VAULT_STORAGE_KEY`.

Select `near-testnet` or `near-mainnet` at build time in Claude-owned frontend
configuration. No runtime selector or cross-network fallback. Mainnet internal
vault opening is disabled; never pass a Testnet mnemonic vault to Mainnet.
Use an external wallet only after separate owner approval enables signing.
The CI candidate hash is not an approved deployed hash. Require the exact
account and code hash at a final block, genesis validation, constructor config,
request terms/hash/status/expiry and USDC registration before wallet review.
`prepareMainnetPayment` chooses exact native deposit or exact USDC transfer-call;
builders produce unsigned candidates, not fresh chain evidence.

Both direct USDC funding and 1Click use:

```ts
buildInstantRecipientMessage(request.terms.id, request.termsHash)
// {"id":"...","expectedTermsHash":"...","action":"pay_instant"}
```

For later 1Click integration, require EXACT_OUTPUT, the configured USDC asset,
the pinned contract recipient and that identical customRecipientMsg. Validate
the authoritative quote and its recipient/asset/amount/message before explicit
customer payment. Quote signature format/verification, Base-origin execution,
live USDC transfer behavior and independent receipt verification remain
integration work, not proven by the sandbox.

`OPEN`, `PAYOUT_IN_FLIGHT`, `PAYOUT_FAILED_RECOVERABLE`, `FINAL_PAID` and
`CANCELLED_UNFUNDED` are the instant request states. Only final-block
`FINAL_PAID` can support **Payment Recorded**, with the contract-state-only
limitation. Never show **Verified Paid** from a deposit, 1Click SUCCESS, an event,
elapsed time or an ambiguous callback. That label needs the independently
implemented and tested merchant receipt/transfer/callback verification path.
Protected Pay and optional features remain disabled.
