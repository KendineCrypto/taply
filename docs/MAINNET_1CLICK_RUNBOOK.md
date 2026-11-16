# 1Click (Base USDC → Taply) runbook

Design: `docs/MAINNET_1CLICK_INTEGRATION.md`. Evidence:
`docs/evidence/mainnet-1click-2026-11-16/`. Nothing here asks for or stores a
seed phrase or private key; every signature below is the owner's, in their own
wallet.

## 1. Configuration

| Setting | Scope | Notes |
| --- | --- | --- |
| `ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED` (`apps/web/src/lib/mainnet/release-gates.ts`) | code | `false` on the PR / `staging/mainnet`. `true` only on the isolated test branch (§2). |
| `TAPLY_ONECLICK_MODE` | Vercel env (server) of the isolated test project | `funded` for the test. `scripts/check-mainnet-env.mjs` refuses `funded` while the code gate is closed, on Production, and without the Redis store. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | server | the test project's own Upstash database (never the Testnet one). |
| `TAPLY_BASE_RPC_URL` | server, may contain a provider key | Base JSON-RPC with `eth_getLogs` for release evidence. Default `https://mainnet.base.org` rate-limits `eth_getLogs`; then nothing is released (safe). |
| `TAPLY_ONECLICK_API_KEY` | server, optional | sent only as `Authorization: Bearer`. |
| `NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH` | public | `DVJx7F3dHEHJYwpYPwXHu8K9Uo7h4kXFcALucY5oNX8q` (observed 2026-11-16). Without it a USDC receipt stays "Payment received" (never "Verified"). |

Contract: `taply-pay.kendinecrypto.near`, code `9VpaiMp3Hoq8pVVvCW6oSZrvzBdZoNNgUmLCXrm32wX6`,
router `intents.near`, recovery `kendinecrypto.near`, USDC cap 25 USDC. Unchanged.

## 2. Where funded quotes may run

**Domain mapping (verified 2026-11-16):** `taplyapp.xyz` serves the Mainnet build
(`/` → `/m`, `/api/mainnet/*` present; it is the `staging/mainnet` Preview of the
`taply-mainnet` project per the owner). `www.taplyapp.xyz` is an alias of the
Testnet `taply` project (redirects to the apex). So **any code or Preview env
change on `staging/mainnet` is public**. The live `/api/mainnet/oneclick/*`
currently answers `STORE_UNAVAILABLE` (no Redis on that deployment).

Therefore the first funded test runs in a **separate Vercel project**,
`taply-mainnet-1click-test`:

| Setting | Value |
| --- | --- |
| Git branch | `test/mainnet-1click-funded` = the PR head + one commit flipping `ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED` (never merged) |
| Ignored Build Step | builds only `VERCEL_ENV=preview` and that branch |
| Domains | none (only the generated `*.vercel.app` deployment/branch URLs) |
| Deployment protection | Vercel Authentication on **all** deployments (team members only) |
| Env | Preview scope, `gitBranch=test/mainnet-1click-funded` only; public values mirror the live bundle (contract, gift and escrow pins, USDC pin) |
| Redis | its **own** Upstash database (owner creates and connects it; the Testnet store must not be used) |
| `TAPLY_ONECLICK_MODE` | `funded` (the build guard refuses it without Redis, while the code gate is closed, and on Production) |

`staging/mainnet`, `release/mainnet`, `taplyapp.xyz`, Production and DNS are not
touched. Rollback: delete the branch or set `TAPLY_ONECLICK_MODE=off` on the test
project. An already issued deposit address stays valid at 1Click until its
deadline (≤ 20 min); a deposit to it is still delivered and processed by the
contract; the receipt is reached from contract state on any Taply deployment.

Public go-live (later, separate approval): the same code gate on
`staging/mainnet`, Redis on that project, the env, and this runbook's checks.

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
| Quote request timed out (`ATTEMPT_UNCERTAIN`) | A quote may exist at 1Click, but its address was never shown to anyone (an address leaves the server only from a READY record), so nobody can fund it. Blocked until that quote's deadline + 60 min (Taply cannot ask 1Click or Base about an address it never received). | None. The requester can create a new request. |
| Payer sent less than `minAmountIn` (`INCOMPLETE_DEPOSIT`) | 1Click (policy) refunds to the refund address after the deadline unless the rest arrives in time. Blocked (`DEPOSIT_IN_PROGRESS`) until 1Click reports `REFUNDED` **and** Base shows the refund. | None; never "paid". |
| Deposit after the deadline (late deposit) | 1Click policy: refund to the refund address. If it is processed anyway: the request is paid once, a second delivery is held (contract). Both phones see "a payment from an earlier attempt is arriving"; new attempts are refused (`EARLIER_ATTEMPT_ACTIVITY`). | Watch; if held, recovery below. |
| Sent more than `amountIn` | Swap runs for the exact output; the excess is refunded to the refund address. | None. |
| 1Click `REFUNDED` | A claim. Released only when Base Mainnet proves the refund to `refundTo` (finalized, amount = reported = all observed deposits, after every deposit). A fee-deducted or partial refund stays blocked pending separate reconciliation. Otherwise `REFUND_NOT_VERIFIED`. | Wait for Base finality (~20 min); check the refund tx. |
| 1Click `FAILED` | Never released automatically (`UPSTREAM_FAILED`). | Check the Base deposit; if a refund appears, 1Click usually moves to `REFUNDED`. Otherwise contact 1Click with the correlation id. The requester can create a new request. |
| 1Click says `PENDING_DEPOSIT` but Base shows a deposit | `DEPOSIT_UNSEEN_BY_1CLICK`, blocked. | Wait; contact 1Click if it persists. |
| Delivered but not paid out (`router_unclaimed`: `NOT_OPEN`, `WRONG_HASH`, `UNDERPAYMENT`, `LOW_GAS`, `LOW_LIQUIDITY`, `UNKNOWN_REQUEST`, `SURPLUS`…) | USDC is held in the contract (`unclaimed_held`). The request stays OPEN (or expired/cancelled). App: "needs investigation", "do not pay again". | Manual recovery below. |
| `PAYOUT_FAILED_RECOVERABLE` | The contract holds the principal. | Merchant presses "Retry the failed payout" (existing). |
| `PAYOUT_IN_FLIGHT` > 10 min | Unknown callback outcome (R-2). | Do not pay again; investigate the payout receipts. |
| 1Click or the Base RPC unreachable / rate-limited | Nothing changes; contract state stays authoritative; no attempt is released (`EVIDENCE_UNAVAILABLE`). | Wait, or configure a better `TAPLY_BASE_RPC_URL`. |

### Held funds (`unclaimed_held`): who owns them and how they are returned

Held USDC sits in **one pooled bucket** of `taply-pay.kendinecrypto.near`; the
contract does not record whose it is or where to return it. Entitlement is
reconstructed off chain, and every return is a manual, owner-signed action.

**1. Establish entitlement (read-only).**

| Evidence | Source |
| --- | --- |
| The held delivery: request id (or `null`), reason, amount | `router_unclaimed` event in the `ft_on_transfer` receipt logs of the `intents.near` transaction |
| The delivery transaction | `nearTxHashes` of the 1Click status, or the chain locator (router shape) |
| The payer's quote: deposit address, amounts, deadline, **refund address** chosen by the payer, correlation id, 1Click signature | Taply attempt ledger `taply:mainnet:1click:ledger:v2:<requestId>` (`signedResponse`) |
| The Base deposit (sender, amount, time) | `originChainTxHashes` of the 1Click status, verified on Base |

The entitled party is the **payer who funded that quote**. The return address is
the quote's **`refundTo`** (Base, chosen and confirmed by the payer at quote time).
If the delivery cannot be matched to a Taply attempt (`id` is `null`,
`UNKNOWN_REQUEST`, or no ledger entry), do not guess. Ask 1Click for the deposit
behind the NEAR transaction (by correlation id), and return only to an
address that 1Click's records tie to that deposit.

**2. Authority required.**

* `withdraw_unclaimed` accepts only a **direct transaction signed by the recovery
  account `kendinecrypto.near`** (signer = predecessor), with **exactly 1
  yoctoNEAR** attached and **≥ 50 Tgas**. A function-call access key cannot
  attach a deposit, so a **full-access key** of `kendinecrypto.near` is
  needed. Only the owner holds it; Taply and Claude never do.
* Token must be NEAR USDC; the receiver must not be the contract or `intents.near`
  and **must be registered on USDC**. On 2026-11-16 `kendinecrypto.near` was
  **not** registered (`storage_balance_of` → `null`; bound 0.00125 NEAR).
* One recovery at a time (`RECOVERY_IN_FLIGHT`); amount ≤ `unclaimedHeld`.
* Failure: the callback puts the amount back into `unclaimed_held`; an unknown
  callback outcome is never retried automatically.

**3. Steps (owner-signed, in order; record every hash).**

1. Read-only: `get_accounting` → `tokens[0].unclaimedHeld ≥ amount`, `recovery.inFlight == false`.
2. If the receiver is not registered on USDC (one time, 0.00125 NEAR):
   `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1.storage_deposit({"account_id":"kendinecrypto.near","registration_only":true})`, deposit 0.00125 NEAR.
3. Recovery account signs:
   `taply-pay.kendinecrypto.near.withdraw_unclaimed({"token":"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","amount":"<held amount>","receiver":"kendinecrypto.near"})`, 1 yoctoNEAR, 50 Tgas.
   Verify: event `unclaimed_withdrawal_succeeded`, USDC balance of the receiver +amount.
4. Return to the payer on Base. Take a 1Click quote with origin NEAR USDC →
   destination Base USDC, `swapType EXACT_INPUT`, `amount` = held amount,
   `recipient` = the payer's `refundTo`, `recipientType DESTINATION_CHAIN`,
   `refundTo` = `kendinecrypto.near`, `refundType ORIGIN_CHAIN`, `dry:false`. Verify
   the quote signature, then send exactly `amountIn` NEAR USDC to the quote's
   deposit address with `ft_transfer`. 1Click's fee comes out of this amount.
   Whether the payer gets a top-up is an owner decision; record it.
5. Verify: the Base transfer to the payer's `refundTo` (amount, finalized), and the
   1Click status `SUCCESS` for that return. Log request id, held delivery tx,
   withdrawal tx, return quote correlation id, Base tx.

## 5. Setting up the isolated test project (owner, one time)

Claude's Vercel token can read the Testnet `taply` project but cannot see
`taply-mainnet` and gets **403 on project creation**, so the owner creates it:

1. Vercel → Add New → Project → import `KendineCrypto/taply`, name
   `taply-mainnet-1click-test`. Root Directory `apps/web` (include files outside
   the root directory **on**); Framework Next.js; Node 24.x.
   Install `pnpm install --frozen-lockfile`. Build
   `cd ../.. && pnpm --filter "@taply/web^..." run build && pnpm --filter @taply/web run build:mainnet`.
2. Settings → Git → Ignored Build Step:
   `if [ "$VERCEL_ENV" = "preview" ] && [ "$VERCEL_GIT_COMMIT_REF" = "test/mainnet-1click-funded" ]; then exit 1; else exit 0; fi`
3. Settings → Deployment Protection → Vercel Authentication: **All Deployments**.
   Do not add any domain.
4. Storage → Create → Upstash for Redis (new database, e.g. `taply-mainnet-1click-test`)
   → connect to this project, environment **Preview** only.
5. Environment Variables, **Preview**, branch `test/mainnet-1click-funded` only
   (values = the live public bundle on 2026-11-16):

   | Key | Value |
   | --- | --- |
   | `NEXT_PUBLIC_TAPLY_NETWORK` | `near-mainnet` |
   | `NEXT_PUBLIC_TAPLY_RPC_URL` / `_PROVIDER_ID` | `https://rpc.mainnet.fastnear.com` / `fastnear-mainnet` |
   | `NEXT_PUBLIC_TAPLY_VERIFIER_RPC_URL` / `_PROVIDER_ID` | `https://archival-rpc.mainnet.fastnear.com` / `fastnear-archival-mainnet` |
   | `NEXT_PUBLIC_TAPLY_VERIFIER_FALLBACK_RPC_URL` | `off` |
   | `NEXT_PUBLIC_TAPLY_EXPLORER_BASE_URL` | `https://nearblocks.io` |
   | `NEXT_PUBLIC_TAPLY_CONTRACT_ID` / `_CODE_HASH` | `taply-pay.kendinecrypto.near` / `9VpaiMp3Hoq8pVVvCW6oSZrvzBdZoNNgUmLCXrm32wX6` |
   | `NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH` | `DVJx7F3dHEHJYwpYPwXHu8K9Uo7h4kXFcALucY5oNX8q` |
   | `NEXT_PUBLIC_TAPLY_FLAG_WALLET` | `on` |
   | `NEXT_PUBLIC_TAPLY_MAINNET_SIGNING` / `NEXT_PUBLIC_TAPLY_MAINNET_LEDGER` | `on` / `device` |
   | `NEXT_PUBLIC_TAPLY_MAINNET_FIXTURES` | `off` |
   | `TAPLY_CSP_MODE` | `enforce` |
   | `TAPLY_ONECLICK_MODE` | `funded` |
   | `TAPLY_BASE_RPC_URL` (optional, sensitive) | a Base RPC with `eth_getLogs` (only needed for releasing an expired attempt) |
6. Deploy the branch `test/mainnet-1click-funded` (or push to it). Then read-only checks
   (Claude, given a share link or access): the URL without login → Vercel login;
   with login → `/api/mainnet/oneclick/origins` = `{"origins":[{"chain":"base",…}],"funding":true}`;
   project domains: none; env: only the branch scope above.

## 6. First real test: 0.50 USDC from Base (plan, not yet run)

**Where:** the isolated project's branch URL (§5), never `taplyapp.xyz`.
Two devices: phone A = requester, phone B = payer. The Taply device wallet lives
per site: on the test URL phone A either restores its Taply wallet from its own
recovery phrase (entered only on the phone) or connects an external NEAR wallet.

**Amounts (live dry quote 2026-11-16 06:41 UTC, signature verified; re-quoted at test time):**

| Item | Amount |
| --- | --- |
| Principal (merchant receives) | **0.500000 USDC** on NEAR |
| Payer sends on Base | **0.505155 USDC** (`amountIn`); minimum accepted `0.500103` |
| Route cost | ≈ 0.0001 USDC (`minAmountIn − amountOut`); the rest of the 1 % buffer is refunded on Base |
| Base gas (one USDC transfer, ~65k gas at 0.006 gwei + L1 data fee) | < 0.00001 ETH; hold **0.0001 ETH** on Base to be safe |
| NEAR for the request (phone A) | storage bond ≈ 0.006 NEAR + gas ≤ 0.003 NEAR; + 0.00125 NEAR if the requester is not yet registered on USDC → **≤ 0.012 NEAR** |
| Optional, recovery readiness | 0.00125 NEAR to register `kendinecrypto.near` on USDC (only needed if funds are ever held) |

**Hard stop:** one deposit, ≤ 0.55 USDC from Base. The 0.50 USDC principal goes to
the requester's own NEAR account.

**Steps:**

1. Phone A (test URL): Wallet → Request → USDC 0.50 → create (signs on NEAR) → QR.
2. Phone B: scan → "Pay from Base" → own Base address as refund address → "Get quote".
   Check: "Merchant receives 0.50 USDC", amount to send, deadline, refund address.
3. **The single manual signature:** in the Base wallet send exactly the shown
   amount of **USDC on Base** to the shown deposit address, once. No resend on doubt.
4. Watch both phones: deposit seen → processing → payout → receipt; phone A leaves
   the QR by itself.
5. Verification (Claude, read-only): Base tx and amount, 1Click status and
   correlation id, the `intents.near` `execute_intents` tx, `ft_on_transfer` gas and
   result `0`, `get_request` FINAL_PAID with payer `intents.near`, merchant USDC
   +0.500000, the buffer refund on Base, "Verified" on both phones (NEAR-side
   scope), actual fees.
6. If anything differs: stop, do not resend, follow §4.
