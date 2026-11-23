# Taply Mainnet Swap (`/m/swap`)

Status 2026-11-23: implemented on branch `claude/mainnet-swap`. Unit, integration and real-browser
tested against a synthetic RPC. Read-only live quotes verified on NEAR Mainnet. **No funded swap has
been executed yet** (see "Real funded test plan").

## 1. What ships

Pool swaps (Rhea pool 4512):

| Pair | Delivered |
|---|---|
| NEAR → USDC | USDC |
| USDC → NEAR | native NEAR (the pool pays wNEAR; Taply then unwraps exactly the verified swap output) |
| wNEAR → USDC | USDC |
| USDC → wNEAR | wNEAR (labelled wNEAR, never "NEAR") |

Wrap/unwrap, **not swaps** (no pool, no price, 1:1 on `wrap.near`):

| Conversion | Transaction |
|---|---|
| NEAR → wNEAR | `near_deposit` (after a one-time wNEAR registration if missing) |
| wNEAR → NEAR | `near_withdraw` of the amount the person typed |

Cross-chain pairs (Base, Solana, EVM…) are **hidden** (§3).

### Real step list (every step is its own transaction and signature)

Registrations are read from `storage_balance_of(account)` at the quote block. Each missing
registration costs `storage_balance_bounds.min` of that token: **0.00125 NEAR each** at block
225841011 (wNEAR and USDC alike). This is a refundable deposit, not a fee.

| Pair | wNEAR registered? | USDC registered? | Steps | Refundable storage |
|---|---|---|---|---|
| NEAR → USDC | no | no | register wNEAR, register USDC, wrap, swap = **4** | 0.0025 NEAR |
| NEAR → USDC | no | yes | register wNEAR, wrap, swap = **3** | 0.00125 NEAR |
| NEAR → USDC | yes | no | register USDC, wrap, swap = **3** | 0.00125 NEAR |
| NEAR → USDC | yes | yes | wrap, swap = **2** | 0 |
| USDC → NEAR | no | (yes: holds USDC) | register wNEAR, swap, unwrap = **3** | 0.00125 NEAR |
| USDC → NEAR | yes | (yes) | swap, unwrap = **2** | 0 |

The review screen always shows the step list computed for the connected account. The
"4 transactions" in the browser QA is the first row: a fresh account with neither registration.

The unwrap after USDC → NEAR uses **only the wNEAR amount proven delivered by that swap's receipts**.
wNEAR the account held before is never included. The refund-recovery "Unwrap to NEAR" button pre-fills
exactly the amount this swap wrapped.

## 2. Provider: Rhea (Ref v2) pinned pool, on-chain quotes, no SDK

Verified on Mainnet on 2026-11-23 (`docs/evidence/mainnet-swap-2026-11-23/`):

| Item | Value |
|---|---|
| Exchange | `v2.ref-finance.near`, metadata version 1.9.22, code hash `txLoEFi4RvYZ7wFNrqV61ggDdmrgHmatBkpXwtGN1FD` (pinned) |
| wNEAR | `wrap.near`, 24 decimals, code hash `DL2f5xmZ44cQRP6vBMt94rvseH5d5KKnAGis2WkTAsh1` (pinned) |
| USDC | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`, 6 decimals, code hash from `NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH` (`DVJx7F3d…NX8q`) |
| Pool | 4512, `SIMPLE_POOL` [USDC, wrap.near], total fee 30 bps. It is the deepest simple pool for this pair: about 880k USDC and 293k NEAR (all 29 USDC/wNEAR pools were scanned) |
| Quote | Constant-product exact-input math in `bigint`. It must equal the exchange's own `get_return` view at the same final block, or the quote is refused (`SWAP_MATH_MISMATCH`) |

Contract behaviour. The `ref-finance/ref-contracts` repository no longer resolves publicly. These
behaviours were therefore verified from the **deployed WASM** (strings in
`ref-wasm-strings.txt`, sha256 `0d4f3226…e4d0`) and from **real Mainnet receipts** (`real-receipts.txt`):

- An instant swap is `ft_transfer_call(receiver_id=v2.ref-finance.near, msg={"actions":[...]})` on the input token. The sender needs no exchange registration (observed: `tx-bench.near` has no exchange storage).
- The output is sent with `ft_transfer`. If the receiver is not registered on the output token, the exchange keeps it in a *lostfound* account. The policy therefore requires the output registration first.
- If `min_amount_out` fails, the exchange panics and the input token refunds the whole input. The transaction still ends `SuccessValue "0"` (observed: `AR2hxHrF…`). A top-level success is therefore never treated as a swap.
- `skip_unwrap_near` exists. Taply always sends `true`, so the swap pays wNEAR and native NEAR is a separate `near_withdraw` step that is proven separately.

Why not the Rhea SDK / smart router:

- The SDK builds transactions that Taply would have to sign blindly or re-parse.
- It adds an unreviewed dependency to the lockfile.
- Its smart-router host is an off-chain service that is not needed for one pinned pool.

Taply instead reads the same contract the SDK targets, reconstructs every call inside the planner, and
claims neither "best price" nor "all routes".

## 3. Cross-chain decision

Cross-chain swap is **not exposed** in this change.

- The existing NEAR Intents / 1Click integration (PR #45) is unmerged and has never had a funded test. It is built for *payments*: EXACT_OUTPUT to the Taply contract, keyed by request id.
- A swap needs its own attempt ledger, a recipient that is the user's own account, deposit-flow UX for non-NEAR origins, and destination-delivery proof.
- Rhea's aggregation API would add a second quote provider for the same job and an off-chain dependency.

Recommendation: when 1Click is merged and funded-tested, add cross-chain as a *labelled deposit flow*
on the existing 1Click provider, with a `jobType: 'swap'` attempt that is separate from the payment ledger. The swap
journal (`taply.mainnet.swap.v1:<account>`) is already independent of payment records.

## 4. Signing policy (`packages/near-client/src/mainnet-swap.ts`)

The planner (`createMainnetOperationPlanner`) accepts four new operation kinds. Each produces exactly one
call, re-derived at the snapshot block, and nothing else:

| Operation | Receiver | Method | Deposit | Gas | Re-checked at the block |
|---|---|---|---|---|---|
| `swapRegister{token}` | wrap.near or USDC | `storage_deposit{account_id: self, registration_only: true}` | `storage_balance_bounds.min` (≤ 0.01 NEAR) | 30 Tgas | not already registered |
| `swapWrap{amount}` | wrap.near | `near_deposit{}` | amount | 20 Tgas | wNEAR registered (no silent fee deduction), amount ≤ 25 NEAR |
| `swapExact{in,out,amountIn,minOut}` | token in | `ft_transfer_call{receiver_id: v2.ref-finance.near, amount, msg}` | 1 yocto | 150 Tgas | pins; pool 4512 kind, tokens and fee; `get_return` equals the math; price impact ≤ 3 %; **expected × 0.95 ≤ minOut ≤ expected** (never 0, never stale); balance; registrations of in, out and the exchange |
| `swapUnwrap{amount}` | wrap.near | `near_withdraw{amount}` | 1 yocto | 30 Tgas | amount ≤ wNEAR balance |

- `msg` is generated by the policy (`{"actions":[{pool_id:4512,...}],"skip_unwrap_near":true}`). Callers cannot pass a receiver, method, msg, pool or calldata.
- The native NEAR budget (`mainnetSpendingBudget`: storage + 2 × 300 Tgas) applies to every step.
- The operation hash includes a per-swap `swapId`, so a successful step can never be signed twice (`OPERATION_ALREADY_CONSUMED`).
- Limits are separate from payment caps: 25 NEAR / 75 USDC per swap, max slippage 5 %, high-impact confirmation above 1 %, refusal above 3 %.

## 5. Quote, review and execution lifecycle (`apps/web/src/lib/mainnet/swap/`)

- **Quote.** Debounced 400 ms. Sequence-numbered, so a slower old response is dropped. TTL 30 s, then at most 3 automatic refreshes while the tab is visible, then a manual "Refresh quote". Any change to amount, token, account or slippage closes the review.
- **Review.** Exact pay, estimate, minimum, price impact (separate from slippage), pool fee, network fee upper bound, the refundable storage deposit (not a fee) and "Taply fee: none". Every step is listed.
- **Execution** (`runner.ts`). For each step: Codex planner → device-ledger reservation → wallet → one FINAL read → `verifyMainnetSwapStep` proves the step from receipts:
  - SWAPPED: used = input, an exchange `Swapped` log, and a successful output transfer to the account of at least the minimum.
  - REFUNDED: used "0".
  - OUTPUT_NOT_DELIVERED: lostfound, or no transfer.
  - WRAPPED: wrap.near deposit log.
  - UNWRAPPED: a Transfer receipt from wrap.near to the account.
- **Not proven → `unknown`.** The job blocks. "Check outcome" re-reads the ledger and the chain. A step goes back to *pending* only if the ledger shows it was never reserved.
- **Resume.** The job lives in localStorage. A refresh shows the same job, and a second tab shows it too. One open job per account, plus a Web Lock per account.
- **Result.** The amounts come from receipts (the unwrap amount for NEAR), with nearblocks links, "Done" and "View activity". The Activity page lists swaps with their own statuses.

## 6. Recovery runbook

| Situation | What the user holds | What Taply shows / does |
|---|---|---|
| Registration done, later step fails | the registration (refundable via `storage_unregister` on the token) | the job is "Needs attention"; the done step is not repeated |
| Wrap done, swap refunded (slippage) | wNEAR | "Unwrap to NEAR" (wNEAR → NEAR job prefilled with the wrapped amount) or "Try again with a new quote" (wNEAR → USDC) |
| Wrap done, swap pending, price moved | wNEAR | the planner refuses the stale minimum (`SWAP_QUOTE_MOVED`); "Try again with a new quote" starts from wNEAR |
| Swap done (wNEAR received), unwrap failed | wNEAR (verified amount) | "Unwrap to NEAR" with the verified swap output |
| OUTPUT_NOT_DELIVERED (lostfound) | the output, held by the exchange for the account | "Do not swap again". The output can be claimed with the exchange's `claim_lostfound` (not automated in Taply; owner support) |
| Unknown outcome | not known | job and device ledger both blocked; "Check outcome" only; nothing is re-sent |

## 7. Configuration

No new environment variables. Swap needs a mainnet build with `NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH`.
Signing additionally needs `NEXT_PUBLIC_TAPLY_MAINNET_SIGNING=on` and `NEXT_PUBLIC_TAPLY_MAINNET_LEDGER=device`
(existing release mode). There is no API key, no paid service and no server route. Quotes are browser
reads of the configured RPC.

## 8. Tests

- `packages/near-client/test/mainnet-swap.test.mjs` (10 tests):
  - math against the real reserves;
  - every policy refusal (min 0, low or stale min, other pool/fee/kind/token, code-pin change, `get_return` disagreement, caps, impact, registrations, balances, storage bounds, no USDC pin);
  - the native gas reserve;
  - receipt verification (swapped, refunded, lostfound, wrap, unwrap, not final, RPC down).
- `apps/web/src/lib/mainnet/swap/__tests__/` (19 tests):
  - parsing in TR/EN and paste; negative, zero, precision, huge and ambiguous inputs;
  - Max reserve;
  - step plans; storage vs gas;
  - journal (one open job, corrupt fails closed);
  - runner (pre-reservation refusal keeps the step pending; unresolved blocks; resolve paths; refund → partial);
  - quote lifecycle (debounce, out-of-order, stale key, bounded refresh);
  - EN/TR key parity.
- `apps/web/scripts/mainnet-swap-qa.mjs`: real Chromium, real vault and IndexedDB ledger, really signed transactions, synthetic RPC with the real pool reserves and real receipt shapes. 54 checks:
  - nav;
  - every form state;
  - token sheet and settings;
  - NEAR→USDC on a fresh account (neither registration: 4 steps);
  - USDC→NEAR with unwrap;
  - wrap OK + swap refunded → recovery;
  - lost response + RPC down → unknown → refresh resume → second tab → check resolves without a resend;
  - activity;
  - 360/390/430/1280 overflow, CTA above the nav, ≥44 px targets, 440–480 px desktop column;
  - TR;
  - keyboard.

Not covered here: VoiceOver/TalkBack manual pass, iOS Safari safe-area on a device.

## 9. Real funded test plan

The amounts are generated right before the test, never taken from an old quote:

```bash
node apps/web/scripts/mainnet-swap-test-plan.mjs <yourAccountId> 0.03 50
```

The planner is read-only. It reads one final block and prints:
- the steps for the account's real registrations;
- the refundable storage;
- the prepaid gas upper bound;
- the NEAR reserve the app keeps;
- the expected and minimum outputs for both legs.

The app re-quotes again at review time and the policy refuses a stale minimum. The concrete,
current numbers for the owner's test are in the PR conversation and the final report. The owner
signs every transaction in their own wallet. Taply never asks for a seed, private key or password.
