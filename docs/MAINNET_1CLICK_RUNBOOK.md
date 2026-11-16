# 1Click (Base USDC → Taply) runbook

Design: `docs/MAINNET_1CLICK_INTEGRATION.md`. Evidence:
`docs/evidence/mainnet-1click-2026-11-16/`. Nothing here asks for or stores a
seed phrase or private key; every signature below is the owner's, in their own
wallet.

## 1. Configuration

| Setting | Scope | Notes |
| --- | --- | --- |
| `ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED` (`apps/web/src/lib/mainnet/release-gates.ts`) | code, `staging/mainnet` only | `false` on this branch. Flipping it is a reviewed one-line commit. |
| `TAPLY_ONECLICK_MODE` | taply-mainnet Vercel env (server) | `off` → `funded` for the test. `scripts/check-mainnet-env.mjs` refuses `funded` while the code gate is closed, on Production, and without the Redis store. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | server | the mainnet project's own Upstash database (already used by Live Handshake). |
| `TAPLY_ONECLICK_API_KEY` | server, optional | sent only as `Authorization: Bearer`. |
| `NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH` | public | `DVJx7F3dHEHJYwpYPwXHu8K9Uo7h4kXFcALucY5oNX8q` (observed 2026-11-16). Without it a USDC receipt stays "Payment received" (never "Verified"). |

Contract: `taply-pay.kendinecrypto.near`, code `9VpaiMp3Hoq8pVVvCW6oSZrvzBdZoNNgUmLCXrm32wX6`,
router `intents.near`, recovery `kendinecrypto.near`, USDC cap 25 USDC. Unchanged.

## 2. Go-live (only after the owner's written approval)

1. Commit on `staging/mainnet` (no force push): `ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED = true as const`.
2. taply-mainnet **Preview** env: `TAPLY_ONECLICK_MODE=funded`, the USDC code pin; redeploy.
3. Read-only checks on the Preview: `GET /api/mainnet/oneclick/origins` → `{"origins":[{"chain":"base",…}],"funding":true}`;
   a USDC request page shows "Pay from Base".
4. Production / `taplyapp.xyz` / DNS: unchanged (the guard refuses `funded` there).

Rollback: `TAPLY_ONECLICK_MODE=off` + redeploy hides the Base option immediately.
An already-issued deposit address stays valid at 1Click until its deadline
(≤ 20 min); a deposit made to it is still delivered and processed by the
contract, and both phones still reach the receipt from contract state (the 1Click
progress hint goes quiet). Prefer rolling back when no attempt is open
(Redis `taply:mainnet:1click:ledger:v2:*`, state `READY`, deadline in the future).

## 3. Following one payment

| Question | Where |
| --- | --- |
| What did the payer get? | Redis ledger `taply:mainnet:1click:ledger:v2:<requestId>`: attempts with state, owner hash, signed 1Click response (`signedResponse`: deposit address, amounts, deadline, refund address, correlation id). |
| What does 1Click say? | `GET https://1click.chaindefuser.com/v0/status?depositAddress=<addr>` → status, `originChainTxHashes`, `nearTxHashes`, `refundedAmount`. |
| Did it reach NEAR? | The `nearTxHashes` entry: a transaction signed by `intents.near` (`execute_intents`) → `USDC.ft_transfer_call` → `taply-pay.ft_on_transfer`. |
| Did Taply pay out? | `taply-pay.get_request({"id":…})` at final: `FINAL_PAID`, payer `intents.near`, `latestOperation` SUCCEEDED; merchant `ft_transfer` receipt with memo `Taply settlement`. |
| Was anything held? | Event `router_unclaimed {id, reason, amount}` in the `ft_on_transfer` logs; `get_accounting().tokens[0].unclaimedHeld`. |

The app shows the same with `docs/PAYMENT_STATE_MACHINE.md` rules: only the
contract can say "recorded"; only the independent verifier can say "Verified".

## 4. Failure, refund and uncertain cases

| Case | What happens | Action |
| --- | --- | --- |
| Quote request timed out (`ATTEMPT_UNCERTAIN`) | A quote may exist at 1Click, but its address was never shown, so nobody can fund it. The request is blocked for cross-chain until that quote's deadline + 60 min. | None. The payer can use a NEAR wallet, or the requester can create a new request. |
| Payer sent less than `minAmountIn` (`INCOMPLETE_DEPOSIT`) | 1Click refunds to the refund address after the deadline unless the rest arrives in time. | None; never "paid". |
| Deposit after the deadline | 1Click refunds it to the refund address. | None. |
| Sent more than `amountIn` | Swap runs for the exact output; the excess is refunded to the refund address. | None. |
| 1Click `REFUNDED` / `FAILED` | Refund on Base to the refund address (1Click's process). After the deadline Taply releases the attempt and a new quote is possible. | Check the Base refund tx in the status. |
| Delivered but not paid out (`router_unclaimed`: `NOT_OPEN`, `WRONG_HASH`, `UNDERPAYMENT`, `LOW_GAS`, `LOW_LIQUIDITY`, `UNKNOWN_REQUEST`, `SURPLUS`…) | USDC is held in the contract (`unclaimed_held`). The request stays OPEN (or expired/cancelled). App: "needs investigation", "do not pay again". | Manual recovery below. |
| `PAYOUT_FAILED_RECOVERABLE` | The contract holds the principal. | Merchant presses "Retry the failed payout" (existing). |
| `PAYOUT_IN_FLIGHT` > 10 min | Unknown callback outcome (R-2). | Do not pay again; investigate the payout receipts. |
| 1Click unreachable | Nothing changes; contract state stays authoritative; no attempt is released. | Wait. |

### Recovering held (`unclaimed_held`) USDC — owner-signed, manual

Never automatic; never from this app. Use the attempt record to find the payer's
refund address and the delivered amount, and the `router_unclaimed` event for the
held amount.

1. Read-only: confirm `get_accounting().tokens[0].unclaimedHeld ≥ amount` and no
   recovery in flight (`recovery.inFlight == false`).
2. Recovery account signs (1 yoctoNEAR, ≥ 50 Tgas):
   `taply-pay.kendinecrypto.near.withdraw_unclaimed({"token":"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","amount":"<held>","receiver":"<owner NEAR account registered on USDC>"})`.
   The callback `on_unclaimed_transfer_complete` restores the bucket if the
   transfer fails; an unknown outcome is never retried automatically.
3. Return to the payer on Base: from that NEAR account, request a 1Click quote
   NEAR USDC → Base USDC with `recipient` = the payer's original refund address,
   `refundTo` = the owner's NEAR account, and send. Record all hashes.
4. Verify both legs on chain; note them in the incident log.

## 5. Owner decisions before the first real payment

1. Approve flipping `ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED` on `staging/mainnet` (Preview only).
2. Approve the Preview env change (`TAPLY_ONECLICK_MODE=funded`, USDC code pin).
3. Approve the spending budget in §6 (separate from the earlier NEAR test budget).

## 6. First real test: 0.50 USDC from Base (plan, not yet run)

**Where:** the taply-mainnet Preview built from `staging/mainnet` after §2.
Two devices: phone A = requester, phone B = payer.

**Accounts and funds (owner-controlled):**

| Item | Amount | Notes |
| --- | --- | --- |
| Base wallet (any EVM wallet on Base, chain id 8453) | ≥ 0.52 USDC (Base, `0x8335…2913`) + ETH on Base for gas | One USDC transfer on Base costs well under 0.0001 ETH today. |
| Requester NEAR account | registered on NEAR USDC; ~0.01 NEAR | Creating the request pays the contract's per-request storage bond (≈ 0.006 NEAR observed) + gas. If it is not registered on USDC: `storage_deposit` 0.00125 NEAR. |
| Principal | 0.50 USDC (Taply minimum) | Dry quote 2026-11-16: send `0.505155`, minimum `0.500103`. |

**Expected cost cap:** ≤ 0.02 USDC route cost (the 1 % slippage buffer above
`minAmountIn` is refunded on Base), Base gas < 0.0001 ETH, ≤ 0.01 NEAR for the
request. The 0.50 USDC principal goes to the requester's own NEAR account.
**Hard stop:** total ≤ 0.55 USDC sent from Base, one deposit only.

**Steps:**

1. Phone A: Taply Wallet (Mainnet) → Request → USDC 0.50 → create (requester signs on NEAR) → QR.
2. Phone B: scan → "Pay from Base" → enter own Base address as refund address → "Get quote".
   Check: "Merchant receives 0.50 USDC", amount to send, deadline, refund address.
3. **The single manual signature:** in the Base wallet, send exactly the shown
   amount of **USDC on Base** to the shown deposit address (copy or QR; the QR
   holds the address only). Once. Do not resend on any doubt.
4. Watch both phones: deposit seen → processing → payout → receipt. Phone A
   must leave the QR by itself.
5. Verification (by Claude, read-only): Base tx and amount (basescan), 1Click
   status + correlation id, the `intents.near` `execute_intents` tx, `ft_on_transfer`
   gas and result `0`, `get_request` FINAL_PAID with payer `intents.near`,
   merchant USDC balance +0.500000, buffer refund on Base, "Verified" on both
   phones (NEAR-side scope), actual fees.
6. If anything differs: stop, do not resend, follow §4.
