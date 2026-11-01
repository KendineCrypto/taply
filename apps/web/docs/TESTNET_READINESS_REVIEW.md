# Instant Pay — Testnet deployment readiness review (Phase 2C)

Prepared on `feature/frontend` for the human lead. **This is a review, not an
approval.** Nothing has been deployed, signed or funded. Contract decisions are
recorded in `contracts/payments/ADR-001.md`; this document checks the current
code and evidence against it and lists what a deployment would need.

**Verdict: NOT READY for a Testnet deployment decision yet.** The code and the
local evidence are complete for native Instant Pay. Five items need human
decisions or real-wallet evidence first (section 7).

## Phase 2D update (2026-11-01)

Still **NOT READY / NOT AUTHORIZED**. Nothing was deployed, signed or funded.
Changes since this review was written:

| Item | Status now | Where |
|---|---|---|
| Independent receipt verifier | **Implemented** (read-only, fail-closed). Verified Paid is reachable only from its result. Validated against synthetic receipt graphs shaped like the sandbox pay graph; **not yet against a real Testnet transaction** | `src/lib/verify/`, `/receipt/[id]` |
| Wallet redirect hash recovery | **Implemented**: `?transactionHashes=` / `?errorCode=` captured, stripped, bound to the journal only after an on-chain match; never resubmits. **Untested with real redirect wallets** | `src/lib/payments/wallet-return.ts` |
| Key policy | **Changed by the lead:** the pilot retains one FullAccess key. Section 5's `DeleteKey` step is superseded | `docs/TESTNET_DEPLOYMENT_DRY_RUN.md` |
| Deployment procedure | Reviewed dry run + read-only preflight script; not executed | `docs/TESTNET_DEPLOYMENT_DRY_RUN.md`, `scripts/deploy-preflight.mjs` |
| `contracts/payments/VALIDATION.md` | Added (documentation only) | `contracts/payments/VALIDATION.md` |

The rest of this document is the Phase 2C review, unchanged except where a row
below says otherwise.

## 1. Evidence on this branch

| Check | Result | Where |
|---|---|---|
| Contract unit tests | 15/15 | CI `instant-pay-sandbox` |
| near-workspaces sandbox (nearcore 2.14.0) | 9/9, incl. exact retry payout accounting | CI `instant-pay-sandbox` |
| Production WASM exports exactly the 12 ABI methods | pass | `scripts/check-exports.mjs` |
| Real sandbox records parse with the frozen shared schema | 17 records, all 5 Instant states | `scripts/check-wire.mjs` |
| Frozen install + `pnpm check` (brand, build, typecheck, lint, tests) | shared 92, near-client 104, web 196; lint 0 warnings | CI `workspace-check` |
| Reproducible WASM | identical SHA-256 in CI runs 41236806667 and 41241339494 | build log |
| QR encoder vs standard implementations | 118 + 260 encodings identical to `qrcode@1.5.4`, decoded by `jsqr@1.4.0` and `@zxing/library@0.21.3` | local audit (not in repo) |
| Deterministic UI preview | 84 screenshots: 14 screens × 360/390 px/desktop × EN/TR, no horizontal overflow, signing flag off | local only |

Sandbox and preview evidence is **not Testnet evidence** (proof hierarchy, freeze section 10).

## 2. Exact artifact to approve

| Item | Value |
|---|---|
| Production WASM | `contracts/payments/artifacts/payments.wasm`, 345,541 bytes |
| SHA-256 (hex) | `a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2` |
| NEAR code hash (base58 of the same SHA-256) | `BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B` |
| Toolchain | Rust 1.95.0, `wasm32-unknown-unknown`, `target-cpu=mvp`, `--cfg near`, near-sdk 5.30.0 |
| Must NEVER be deployed | `payments.callback-fault.wasm` (`989596a8…b6153f6be`, reports `testFaultBuild: true`) |

Every WASM built before commit `2afbc1c` lacked `--cfg near` and must not be
reviewed or deployed: on chain its panics are bare traps without error codes.
The frontend refuses any contract whose code hash differs from the configured
pin, and any contract that reports `testFaultBuild: true`.

## 3. Required configuration

Frontend (all public, compiled into the bundle, no secrets):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_TAPLY_NETWORK` | `near-testnet` |
| `NEXT_PUBLIC_TAPLY_CONTRACT_ID` | the deployed account (not chosen yet) |
| `NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH` | `BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B` |
| `NEXT_PUBLIC_TAPLY_RPC_URL` / `_RPC_PROVIDER_ID` | HTTPS, CORS-enabled Testnet RPC; the public endpoint is slow and rate-limited, so a reviewed provider is recommended |
| `NEXT_PUBLIC_TAPLY_EXPLORER_BASE_URL` | `https://testnet.nearblocks.io` |
| `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY` | `off` until the human approval in section 7, then `on` |
| `NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY`, `_HANDSHAKE`, `_MERCHANT` | `off` |

Even with the flag on, signing additionally requires a `get_config` read at a
finalized block where the code hash matches and `contractConfigProblems()` is
empty (no fault build, only `instantNative`, quote version 1, gas at or above
the ABI floors).

## 4. Funding and gas

**Contract account minimum balance (computed, verify after deploy).** The
contract refuses every outgoing transfer unless
`balance >= storage cost of all its state + failed-held principal + the transfer`
(`check_liquidity`). Callers prepay all gas and each creator pays an exact
permanent storage bond, so the operator only funds code and base state:

- code: 345,541 bytes; base state, account and access-key records: roughly 300 bytes;
- at the standard 10^19 yoctoNEAR per byte, that is about **3.46 NEAR**;
- recommend **4 NEAR** (about 0.5 NEAR margin). Confirm immediately after
  deployment with `get_accounting`: `runtimeAccountBalanceYocto` must be at least
  `runtimeStorageCostYocto`. `get_config.storageByteCostYocto` reports the live price.

Per-request storage bond paid by the creator: 557–633 bytes, so 0.00557–0.00633
NEAR at the same price (exact value comes from `quote_create_request`).

**Gas (prepaid limits enforced by the contract vs measured burn in the sandbox):**

| Method | Prepaid limit | Measured burn |
|---|---|---|
| `create_request` | 30 Tgas | 3.05–3.17 Tgas (12 runs) |
| `pay_instant_native` (incl. transfer + 15 Tgas callback allocation) | 50 Tgas | 5.88 Tgas |
| `retry_native_transfer` | 50 Tgas | 5.84 Tgas |
| failed payout path | 50 Tgas | 6.08 Tgas |
| `cancel_unfunded` | 15 Tgas | not separately measured |
| `on_native_transfer_complete` (callback) | 15 Tgas allocated | ≤ 2.77 Tgas per receipt |

Unused prepaid gas is refunded by NEAR. Measurements are sandbox values; repeat
them on Testnet as part of the first-payment evidence.

## 5. Account permissions and deployment procedure (SUPERSEDED in Phase 2D — see `TESTNET_DEPLOYMENT_DRY_RUN.md`; the pilot keeps the FullAccess key)

`new()` is `#[private]` and checks `predecessor == current account`, so it must
be called by the contract account itself. A batch transaction signed by a parent
account would fail with `PRIVATE_INIT`. Proposed procedure:

1. Create a fresh, dedicated Testnet account with one full-access key held by the
   human operator only. Never reuse a personal account; never put the key in CI,
   the repo or the frontend.
2. Fund it with 4 NEAR (section 4).
3. In **one** transaction signed by that account: `DeployContract(payments.wasm)`,
   `FunctionCall new({})`, `DeleteKey(<the full-access key>)`. All actions apply
   together or not at all.
4. Verify read-only: `view_account.code_hash == BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`,
   `view_access_key_list` is empty, `get_config.testFaultBuild == false`,
   `get_accounting` balance covers storage.
5. Record the account, transaction hash and these reads in `docs/EVIDENCE.md`.

Deleting the last key makes the code immutable, which closes ADR-001's open point
that "a contract account full-access key could still replace code". It also means
**no upgrade and no recovery**: a bug can only be handled by deploying a new
contract at a new account. Whether to lock is a human decision. If the key is
kept, the frontend's code-hash pin still detects a code change on every read, but
a swap between the last read and a signed call cannot be excluded.

## 6. Rollback and incident procedures

- **Kill switch:** redeploy the frontend with `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=off`.
  Signing disappears and reads continue. Removing the contract variables stops
  reads too. The contract itself has no pause method.
- **Automatic fail-closed:** a different code hash, a fault build or any
  unreviewed capability disables payments without human action.
- **Contract bug:** there is no admin method, upgrade, refund or settlement path.
  Stop new requests via the kill switch, deploy a fixed contract at a new account,
  and point the frontend at it. Existing obligations on the old contract stay
  there: recipients can still retry recorded failures by calling it directly.
- **Unresolved transfer (`PAYOUT_IN_FLIGHT` for more than 5 minutes of chain
  time):** the app shows "Transfer unresolved" and offers no action. Collect the
  funding transaction hash, the receipt outcomes (`tx_status` with
  `wait_until: FINAL`), `get_request` and `get_accounting`
  (`inFlightMayAlreadyHaveTransferred: true`). Check whether the transfer receipt
  to the recipient succeeded. Do not pay again and do not ask the payer to retry.
  There is no on-chain remedy (section 8).
- **Unknown wallet outcome in the app:** the journal blocks a second attempt until
  a finalized read explains the first. The contract independently rejects a second
  funding, a reused creation nonce and a stale retry nonce.

## 7. ADR-001 review gates

| ADR-001 item | Status |
|---|---|
| Frozen terms, IDs and hashes; reused nonces rejected | **met**: unit + sandbox + wire check |
| Direct signer only; exact principal; payer restriction | **met**: sandbox `rejected_deposits…`, `expired_or_unpermitted…` |
| Operation reserved before transfer; private, nonce-checked callback | **met**: sandbox `self_signed_callback…`, `actual_transfer_callback…` |
| Recorded failure → recipient-only same-destination retry; no replay | **met**: sandbox, exact accounting |
| Unknown result / callback panic never retries | **met** as designed: sandbox `…panicking_callback_never_retries`, `failed_transfer_and_failed_callback…` |
| Exact storage bond; fixed-size records; conservation; liquidity | **met**: contract checks + sandbox `competing_funders…` |
| Gas measured | **met in sandbox**; repeat on Testnet |
| Protected, Handshake, tokens, upgrades absent | **met**: export check (12 methods), `get_config` capabilities |
| **Callback-stall limitation accepted** | **OPEN — human decision** (section 8) |
| **External receipt verifier** | **IMPLEMENTED (Phase 2D), validation OPEN**: needs one real Testnet payment to confirm the RPC receipt format |
| **Wallet integration on real Testnet wallets** (`signAndSendTransaction` with a deposit, redirect wallets) | **OPEN**: built and tested only against a recording fake wallet; redirect recovery implemented (Phase 2D) but untested on real wallets |
| **Deployment authority / key policy** (section 5) | **DECIDED for the pilot: retain one FullAccess key**; risks documented in `TESTNET_DEPLOYMENT_DRY_RUN.md` section 3, acceptance to be recorded at approval |
| **Explicit approval of deployment, signing and fund movement** | **OPEN** |

Additional findings from this review:

- ~~`contracts/payments/README.md` links a `VALIDATION.md` that does not exist.~~ Added in Phase 2D.
- ~~After a mobile wallet *redirect*, the app does not read the transaction hash
  from the return URL.~~ Fixed in Phase 2D (`wallet-return.ts`).
- The unknown-attempt hold (2 minutes) compares the browser's clock with chain
  time. A device clock that is ahead only lengthens the hold. One that is far
  behind shortens it, but re-attempting still needs a deliberate human action,
  and the contract rejects a duplicate funding.

## 8. Known limitations that must be accepted or fixed

**Callback failure after a successful transfer.** If the native transfer succeeds
but the callback fails, runs out of gas or never runs, the request stays
`PAYOUT_IN_FLIGHT` permanently. By design, the contract has no timeout, retry,
payer refund or admin settlement for this case, because any automatic path could
pay twice. The principal is accounted as in flight
(`inFlightMayAlreadyHaveTransferred: true`), and the recipient may already have
it. The frontend reports this as unresolved after 5 minutes of chain time and
offers nothing. A safe, general on-chain reconciliation has not been designed
(freeze section 10, gate 1). Fail-closed avoids duplicate money movement at the
cost of possibly stuck records.

**Independent receipt verification.** `get_receipt` returns
`CONTRACT_FACTS_NOT_FINALITY_PROOF`. A "Verified Paid" receipt (shared
`VerifiedReceipt`) additionally requires an RPC verifier that checks: the approved
code hash at the state block; the funding transaction signed by the payer with
exactly the principal attached; the transfer receipt executed by the recipient
with exactly that amount; and the successful callback receipt, all at FINAL. Its
trust model is the configured RPC.

*Phase 2D:* implemented in `src/lib/verify/instant-receipt.ts` with its own
read-only RPC transport (near-client drops action payloads). It also checks the
code hash at every block where contract code ran and that the contract account's
access keys did not change during the payment, because the pilot retains a
FullAccess key. `settlementProof: 'verified_receipt'` is produced only from its
`verified` result. Validation against a real Testnet transaction is still open.
