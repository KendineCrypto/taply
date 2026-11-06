# Phase 2E — pre-pilot review (verifier, redirect recovery, artifact, preflight, key policy)

**Status: preparation only.** No account was created, nothing was deployed, signed
or funded, signing stays off, nothing touched Mainnet, nothing was merged to
`main`. No Taply payment exists on Testnet, so **nothing here is Testnet payment
evidence.** The pilot procedure is in `TESTNET_PILOT_RUNBOOK.md`.

## 1. Receipt verifier review (`src/lib/verify/instant-receipt.ts`)

### What was checked against real RPC output

Two **genuine** public Testnet `EXPERIMENTAL_tx_status` responses (protocol 88,
captured read-only; unrelated to Taply) are now test fixtures
(`src/lib/verify/__tests__/fixtures/testnet/`, suite `testnet-compat.test.ts`, 13 tests):

| Assumption in the verifier | Real Testnet observation | Result |
|---|---|---|
| Top-level fields `final_execution_status`, `status`, `transaction`, `transaction_outcome`, `receipts_outcome`, `receipts` | present exactly | parses |
| `FunctionCall` = `{method_name, args (base64), gas (number), deposit (string)}` | yes | parses |
| `Transfer` = `{deposit: string}`; simple actions may be plain strings (`"CreateAccount"`) | yes (`"CreateAccount"` seen) | strings parse as `other` and are refused for contract receipts |
| Receipt payload `receipt.Action.{signer_id, actions, output_data_receivers, input_data_ids}` | yes (+ `gas_price`, `is_promise_yield`, `priority`, ignored) | parses |
| First receipt listed in `receipts` | 68 of 69 sampled transactions listed it, 1 did not | handled: derived from the signed transaction when absent (tested by removing it from the real fixture) |
| Gas refunds are `system` → signer `Transfer` receipts | yes, under the contract receipt, the outgoing receipt and the callback | classified as refunds, never as a payout |
| Promise callback wiring via `data_id` | yes: outgoing receipt `output_data_receivers[0].data_id` = callback `input_data_ids[0]` | `promiseResultProducer` finds exactly the outgoing receipt |
| Contract receipt returns `SuccessReceiptId(callback)`; callback `SuccessValue("dHJ1ZQ==")` | yes (linkdrop `create_account` → `on_account_created`) | matches the Instant Pay pattern |
| Non-Action (Data) receipts | none in 70 sampled transactions | skipped if they appear; a needed receipt missing as Action → `EVIDENCE_INCOMPLETE` |

The linkdrop transaction has the **same topology** as an Instant Pay payout. The
Taply-specific checks are still exercised only on synthetic graphs, so one real
Taply payment remains required (gate G-V1).

### Code changes from the review

- Graph parsing split into exported, protocol-agnostic steps (`parseTxStatus`,
  `buildTxGraph`, `promiseResultProducer`) so real responses can be tested
  without contract state.
- **Stricter:** the callback's input data id must have exactly one producer in
  the whole graph and it must be the payout transfer (a second receipt claiming
  that data id → `CALLBACK_MISMATCH`).

### Authorization and code-hash checks (re-reviewed, unchanged)

- Funding: tx signer = recorded payer = first-receipt predecessor (direct call;
  if the first receipt is unlisted, NEAR's conversion makes predecessor = signer);
  exactly one `pay_instant_native` action; deposit = principal exactly; arguments
  bind this ID and terms hash (strict JSON, duplicate keys refused); payer
  restriction honoured. Function-call access keys cannot attach deposits, so a
  deposit-bearing funding transaction was signed with a full-access key.
- Retries: recipient-signed, one yoctoNEAR, previous nonce.
- Code hash equals the pin at the state block and at every block where contract
  code ran; contract access keys and nonces identical from the block before
  funding to the state block (detects any use of the retained key).

### Residual risks (accepted for the pilot, documented)

| ID | Risk | Mitigation / gate |
|---|---|---|
| R1 | Trust model is one configured RPC provider | Pilot: re-run the verification link against a second provider (runbook E7) |
| R2 | Non-archival RPCs prune history (~5 epochs); old receipts → `HISTORY_UNAVAILABLE` | Verify during the pilot; use an archival endpoint for later audits |
| R3 | More than one retry needs every retry hash; a device keeps only its latest | Shown as "missing reference", never as verified |
| R4 | Browser verification needs RPC CORS for `EXPERIMENTAL_tx_status` | Checked in runbook E5 |
| R5 | No real Taply payment has been verified | Gate G-V1 |

## 2. Wallet redirect recovery: never resubmits

New screen tests (`redirect-recovery.test.tsx`) cover three lost-reference
returns on a request that is still OPEN and fundable: a wallet error code, a hash
the chain does not know yet, and no return parameters at all. In each case the
earlier attempt stays blocked, no enabled approve control exists, clicking every
enabled button makes **no** wallet request, and the journal entry is never moved
to `USER_REJECTED` or `RESOLVED`. A static guard pins `wallet-return.ts` imports to
`zod`, the journal and read-only RPC types (no signing API reachable). Existing
unit tests cover success, decline, timeout, duplicate callback, stale return,
wrong-call hash and reload. Real redirect wallets remain untested (gate G-W1).

## 3. Production WASM and reproducibility

| Run | Head | `payments.wasm` SHA-256 |
|---|---|---|
| 41236806667 | `fbadf5a` | `a13d932f…acb0d2` |
| 41241339494 | `a6163a5` | `a13d932f…acb0d2` |
| 41244144449 | `3bc590b` | `a13d932f…acb0d2` |
| 41302515005 | `82a70f8` | `a13d932f…acb0d2` |
| 41304495007 | `1b5b3ef` | `a13d932f…acb0d2`, and the new pinned-artifact step: 5/5 PASS |

Full SHA-256 `a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2`,
NEAR code hash `BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B` (derivation
unit-tested). New CI step **"Pinned approved artifact"** runs
`deploy-preflight.mjs wasm` on every fresh build: SHA-256, code hash, size, exact
12 ABI exports, not the fault build. Not reproduced on this workstation (no
Docker/Rust); the operator rebuilds locally before deploying (runbook D1).

## 4. Deployment preflight audit (`scripts/deploy-preflight.mjs`)

| Finding | Fix |
|---|---|
| JSON-RPC response id not checked | checked; redirects refused |
| Query results not tied to the requested block | every `query` result must carry the requested `block_hash` |
| Node sync state not checked | refuses a syncing node |
| Any account name accepted | named `<name>.testnet` only (no implicit, no `.near`) |
| Fixed 0.5 NEAR margin, deploy gas ignored | minimum = storage after deploy + **all gas bought up front** (refunds come after the storage check), from live `EXPERIMENTAL_protocol_config` + `gas_price`; `--buffer-near` (default 0.03) |
| "No requests" check broke later monitoring | only with `post --fresh` |
| Retained key use not detectable | `post --expect-key <pk>:<nonce>` fails on any nonce or key change |

Live read-only values (2026-11-01, protocol 88): 10^19 yoctoNEAR/byte, gas price
10^8 yoctoNEAR/gas, deploy+init gas upper bound **56.23 Tgas**, account-creation
charge 0.007 NEAR (paid by the creator). **Minimum funding 3.4659 NEAR; fund 3.5 NEAR.**
33 deterministic tests including a vector from the live protocol-88 costs.

Remaining limits: single RPC trust; it checks resulting state, not the deploy
transaction's action list (the runbook adds a manual `tx_status` check, D6).

## 5. Retained FullAccess-key policy audit

The policy (`TESTNET_DEPLOYMENT_DRY_RUN.md` section 3) is sound for a Testnet
pilot **if** these hold, all now in the runbook:

1. Key generated on the operator's machine, preferably a hardware wallet; never
   exported, never in CI, repo, frontend, chat or screenshots.
2. Dedicated contract account; the funding account is a separate account.
3. Baseline `<public key>:<nonce>` recorded right after deployment; monitoring
   with `post --expect-key` (hourly during the pilot). Any change = incident.
4. The key signs exactly one transaction (deploy + init) and nothing else.
5. Exit decision after the pilot (lock, multisig or retire) before any public use.

The verifier independently refuses to verify payments whose window contains any
contract-account transaction, so silent key use cannot produce Verified Paid.
