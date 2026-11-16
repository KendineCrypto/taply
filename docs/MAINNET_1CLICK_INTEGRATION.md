# NEAR Intents / 1Click: paying a Taply USDC request from Base

Status 2026-11-16 (branch `claude/mainnet-intents-1click`, based on
`staging/mainnet` `fa42157`). The implementation is complete behind a **closed**
release gate. `taplyapp.xyz` serves the `staging/mainnet` Preview, so the gate is
never opened there for testing: the first funded test runs only in the isolated,
access-protected `taply-mainnet-1click-test` project (`docs/MAINNET_1CLICK_RUNBOOK.md`
§2, §5–6). The 2026-11-13 candidate notes are in `docs/history/`.

## 1. What the payer and the requester see

| Step | Payer (any browser) | Requester (QR screen, other phone) |
| --- | --- | --- |
| Open a USDC request | "Pay from Base" next to "Pay with NEAR wallet" (only when this deployment serves funded quotes; otherwise the existing "cross-chain not available" notice) | QR, "Waiting for payment" |
| Choose source + refund address | Only **USDC on Base** is fundable. EIP-55 refund address validation. | — |
| Quote | Server asks 1Click for a signed `EXACT_OUTPUT` quote and verifies it. Shown: amount to send on Base, merchant receives (exact), route cost (fees + slippage buffer), deadline countdown, estimate, refund address. | — |
| Deposit | "Send 0.505155 USDC on Base", "Only USDC on the Base network", deposit address with **address-only QR** (labelled: enter the amount yourself, choose Base), copy address / copy amount, memo field with a mandatory confirmation when 1Click returns one, "do not send twice". | — |
| Deposit seen by 1Click | Address and QR disappear; "1Click has seen your deposit… do not send again". | QR disappears; "A payment is on its way from Base. Do not ask for another payment." |
| Delivered + payout | Status panel: Processing → Payout in flight (contract) | "Completing payment…" |
| Final | Receipt ticket. "Verified" only after the independent NEAR-side proof (below); otherwise "Payment received" (contract state). Router note: "Paid from Base through NEAR Intents… the Base leg is reported by 1Click." | Same receipt, found from chain, **without** the payer's quote record. |
| Refund / underpayment / failure / unknown | Plain messages; never "paid"; never a new deposit address by itself. | "Refunded to the payer, request still open", "payer sent less…", "failed", or "needs investigation". |

After a refresh the same browser resumes its own attempt (deposit instructions or
progress). Long technical data (attempt id, 1Click reference, contract,
signature line) is folded under "Technical details". English and Turkish have
identical keys (tested).

## 2. Money path, and where funds can end up

```
Base wallet ──USDC──▶ 1Click deposit address (Base)
   1Click swaps/bridges ──▶ intents.near balance of the 1Click swap account
   intents.near (signs execute_intents itself) ── ft_withdraw{token: USDC(NEAR), receiver: taply-pay, msg: customRecipientMsg}
     └▶ USDC.ft_transfer_call(taply-pay, amountOut, msg)
          └▶ taply-pay.ft_on_transfer(sender_id = intents.near, amount, msg)  ── router_delivery
               ├─ msg/terms/asset/open/payer/amount/gas/liquidity all OK ─▶ ft_transfer(merchant, principal) + callback → FINAL_PAID
               └─ anything else ─▶ amount held as `unclaimed_held` (event router_unclaimed{id, reason, amount}); returns U128(0)
```

`customRecipientMsg` = `{"id","expectedTermsHash","action":"pay_instant"}` from the
same builder as the wallet path. The deployed contract (`taply-pay.kendinecrypto.near`,
code `9VpaiMp3…2wX6`, v0.6.0-mainnet) already implements router delivery; **no
contract change**.

**What this design does and does not guarantee** (precise version of the earlier
"funds cannot get stuck" wording):

| Situation | Where the USDC is | Who can move it | Guarantee |
| --- | --- | --- | --- |
| Deposit below `minAmountIn`, after the deadline, or swap failure before delivery | 1Click / Intents | 1Click (refund to `refundTo` on Base) | **Upstream policy only**; Taply can observe it on Base, not enforce it. |
| Delivered, request OPEN and everything matches | Paid to the merchant | — | Contract-enforced; the request is paid at most once. |
| Delivered but not payable: request already paid (late/second deposit), expired, cancelled, wrong hash/asset/payer, underpaid, surplus over the principal, `LOW_GAS` (< 40 Tgas left), `LOW_LIQUIDITY` | Held in the contract's pooled `unclaimed_held` bucket | **Only** the recovery account `kendinecrypto.near` via `withdraw_unclaimed` (manual, §4 of the runbook) | Not lost and never paid twice, **but not returned automatically**. Return depends on the owner acting. |
| `ft_on_transfer` itself fails (e.g. out of gas before it can record anything) | Returned by USDC's `ft_resolve_transfer` to `intents.near`, then credited by Intents `ft_resolve_withdraw` to the 1Click account (near/intents `dbad9c8`, `Ok(Ok(used))` branch) | 1Click | Depends on the Intents contract version and on 1Click then refunding the payer. |
| Intents' resolver cannot read the result | Stays with `intents.near`, not credited back | Intents operators | Not refunded by code (the only no-refund branch in that source). |

Gas: the contract needs ≥ 40 Tgas left inside `ft_on_transfer` to start the
payout. On 2026-11-16 two single-intent mainnet withdrawals gave the receiver
222 and 270 Tgas. That is an **observation of two transactions, not a guarantee**:
1Click/Intents choose `min_gas` (default 50 Tgas, hard minimum 30 Tgas for
`ft_transfer_call`, plus a weighted share of unused gas that shrinks when one
transaction carries several withdrawals). A delivery with too little gas
ends as `LOW_GAS` (held, manual recovery), not as a payout.

## 3. Server (Next.js route handlers, Node runtime, server-only)

`apps/web/src/server/mainnet/oneclick/`, routes under `/api/mainnet/oneclick/`
(404 on Testnet builds):

| Route | Who | Returns |
| --- | --- | --- |
| `GET origins` | anyone | quotable origins + `funding` (true only for approved funded quotes). Funded mode lists **Base USDC only**. |
| `POST quote` `{requestId, originAsset, refundTo, attemptSecret}` | payer | verified quote; a deposit address only to the attempt owner, only when funding is approved |
| `POST attempt` `{requestId, attemptSecret}` | the same browser | the owner's latest attempt + its status (resume after refresh) |
| `GET status?requestId=` | anyone (both phones) | a **redacted** progress hint: 1Click status, origin/NEAR tx hashes (links built by Taply), refunded amount. Never a deposit or refund address. |

Quote checks, in order: mode gate → input schema (64-hex id, allowlisted origin,
43-char secret) → refund address (EIP-55, not zero, not the token contract) →
per-request rate limit → owner already has a live attempt? return it →
contract config at a final block → request OPEN, instant, USDC, permitted payer
null or `intents.near`, ≥ 0.50 USDC, ≥ 10 min usable before expiry (5 min
margin) → contract and merchant registered on USDC → asset still listed by
1Click identically → durable reservation → `DISPATCHING` → 1Click
(`dry:false` only in funded mode) → `verifyQuoteResponse` (official SDK 0.1.26
signature with the pinned manager key, every request field echoed,
`amountOut = principal`, `minAmountOut ≥ principal`, timestamp ≤ 120 s old,
deadline in the future and ≥ 5 min before request expiry, deposit present for
funded / absent for dry, deposit ≠ refund address) → `READY`.

Fixed quote body: `swapType EXACT_OUTPUT`, `slippageTolerance 100` (1 %, applied
to the input), `depositType/refundType ORIGIN_CHAIN`, `recipient` = the pinned
contract, `recipientType DESTINATION_CHAIN`, `destinationAsset` NEAR USDC,
`amount` = principal, `deadline` = min(now + 20 min, request expiry − 5 min),
`customRecipientMsg` as above. Nothing comes from the browser except request id,
origin, refund address and the attempt secret.

### Attempts (`store.ts`, durable, Redis Lua, no TTL)

* Owner = SHA-256 of a 256-bit secret generated **in the payer's browser** and
  kept in `localStorage` per request. The server stores only the hash.
* At most **one payable deposit address per request**. A READY funded attempt
  blocks new ones until it is **released**, and it is released only on **Base
  chain evidence at a finalized block** (`server/mainnet/oneclick/origin-evidence.ts`):
  - `ORIGIN_NO_DEPOSIT_VERIFIED`: 1Click says `PENDING_DEPOSIT`, deadline + 60 min
    has passed, Base finality has passed it too, and there is **no** USDC Transfer
    to the deposit address from 20 min before the quote up to that finalized block;
  - `ORIGIN_REFUND_VERIFIED`: 1Click says `REFUNDED`, the reported refund
    transaction(s) are successful and finalized and transfer USDC to the quote's
    `refundTo`, their total equals the reported `refundedAmount`, it does not
    exceed what was deposited, and no deposit happened at or after the refund.
  1Click's status alone never releases: `FAILED` is never released
  automatically; `REFUNDED` without the Base refund, `PENDING_DEPOSIT` with a
  deposit on Base that 1Click has not reported, an unreadable or rate-limited
  Base RPC, a status for another quote, or a search range over ~66 h all keep
  it blocked. The block reason is shown to the payer with a recovery path.
* Three kinds of knowledge are kept apart in the owner view: what 1Click
  **claims** (status), what 1Click **reports** as refunded (amount, tx count),
  and what **Base proves** (refund or no deposit, at a finalized block).
* Released attempts are **watched for 30 days**: if 1Click later reports a deposit
  for one (late deposit), the public status shows it to both phones as
  "a payment from an earlier attempt is arriving", the pay page offers no
  payment method, and new attempts are refused (`EARLIER_ATTEMPT_ACTIVITY`).
  If it is delivered anyway, the contract pays the request at most once and
  holds the rest (contract test
  `router_late_open_overpayment_exact_payout_duplicate_and_conservation`).
* A RESERVED/DISPATCHING/UNCERTAIN attempt never showed its address to anyone;
  it still blocks until its own deadline + 60 min.
* Another browser gets `PAYMENT_IN_PROGRESS` for a payable attempt and can
  neither read, replace nor duplicate it. A live dry/fixture quote (no deposit
  address, cannot be funded) is not owned: identical inputs reuse it, other
  inputs get `ACTIVE_QUOTE_EXISTS`.
* Lifetime cap 3 attempts per request; per-request limits 10/min (quote,
  resume) and 40/min (status); per-IP 60/min; global 240/min.
* Upstream timeout ⇒ `UNCERTAIN` (a quote may exist upstream) ⇒ no second quote,
  `ATTEMPT_UNCERTAIN` shown in plain language.
* v2 ledger key `taply:mainnet:1click:ledger:v2:<id>`; a v1 ledger containing a
  funded attempt quarantines the request.

Bounded upstream client: fixed base URL, no redirects, `no-store`, 15 s timeout,
256 KiB cap, API key only as `Authorization: Bearer` from server env, upstream
error text never forwarded. Same-origin JSON POSTs, 2 KiB / 2 s inbound body cap.

## 4. Payment states (PAYMENT_STATE_MACHINE)

`lib/mainnet/status.ts` is unchanged: the contract state at a final block is the
only source of "Payment recorded"; the 1Click status is a hint that can move the
screen between waiting states or explain refunds/failures. Upstream `SUCCESS`
with the request still OPEN is "Processing", and after 15 min "needs
investigation" (the delivery may be held). `PAYOUT_IN_FLIGHT` > 10 min is
"unknown, do not pay again".

## 5. Independent verification ("Verified")

`useVerifiedMainnetReceipt` now covers USDC (requires the owner-approved USDC
code pin `NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH`):

* Candidate funding transactions: the browser's own record (direct wallet pay),
  the public 1Click hint's NEAR tx hashes (router only), or the chain locator
  (`lib/verify/locate-funding.ts`) with a **router shape**: a transaction signed
  by `intents.near` to itself calling `execute_intents` whose `ft_withdraw` of
  NEAR USDC to the contract carries this request's id in `msg` (bounded walk over
  NEP-413 payloads; scans 8 blocks before the `fundedAtNs` block; 160 RPC calls).
* Proof: `verifyMainnetSettlement` (Codex, near-client) checks the whole graph —
  `ft_transfer_call` by `intents.near`, exactly one `ft_on_transfer` from USDC with
  `sender_id = intents.near` and the exact message, amount ≥ principal,
  `ft_resolve_transfer` returning the full amount, funding time = `fundedAtNs`,
  `ft_transfer` of the principal to the merchant with the exact memo, the
  callback returning `true`, final state, code hashes of the contract and USDC at
  every block. The hook additionally requires `routerDelivery` to match the
  expected shape, the beneficiary and the amount.
* Scope label: `NEAR_SETTLEMENT_ONLY` — the Base debit and any Base refund are
  **not** independently verified; the receipt says so.

## 6. Supported routes

| Origin | Destination | Status |
| --- | --- | --- |
| USDC on Base (`nep141:base-0x8335…2913.omft.near`) | USDC on NEAR → Taply request → merchant | Implemented; dry quotes live-verified 2026-11-16; funded behind the gate; real funded test pending owner approval |
| USDC on Solana, USDT on Tron | same | Quote-only (dry/fixture) as before; **not fundable** (refused in funded mode) until each has its own evidence |
| Other 1Click assets (Ethereum, Arbitrum, Polygon … USDC) | — | Not offered. Adding one = allowlist entry + refund-address format + dry + funded evidence |

## 7. Configuration

| Setting | Where | Value for the Base test |
| --- | --- | --- |
| `ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED` | `apps/web/src/lib/mainnet/release-gates.ts` (code) | `true` on `staging/mainnet` only, after approval |
| `TAPLY_ONECLICK_MODE` | Vercel env, server | `funded` (Preview). The build guard refuses it while the code gate is closed and on Production |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel env, server | the mainnet project's own Upstash database (required for funded) |
| `TAPLY_ONECLICK_API_KEY` | Vercel env, server | optional |
| `TAPLY_BASE_RPC_URL` | Vercel env, server (may contain a provider key) | Base JSON-RPC with `eth_getLogs`; default `https://mainnet.base.org`, which rate-limits `eth_getLogs` ("request limit reached" observed). Without a working endpoint nothing is ever released: expired attempts stay blocked (safe, but a new request is then needed). |
| `NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH` | Vercel env | `DVJx7F3dHEHJYwpYPwXHu8K9Uo7h4kXFcALucY5oNX8q` (observed live 2026-11-16; needed for USDC "Verified") |

`apps/web/env/mainnet.env.example` documents these without values.

## 8. Tests (see the PR for exact runs)

* `server/mainnet/oneclick/__tests__/`: quote/attempt/status (memory store and a
  **real redis-server**), funded path with the gate opened only inside the test
  module, AOF crash/restart, HTTP hardening.
* `lib/verify/__tests__/locate-funding-usdc.test.ts`: router/token candidates incl.
  adversarial variants; synthetic-chain locate.
* `lib/mainnet/__tests__/verified-receipt-usdc.test.tsx`: router/direct receipt
  wiring, proof mismatches never applied.
* `components/mainnet/__tests__/intents-funded-ui.test.tsx`: deposit screen, memo
  gate, QR removal, expiry, browser-side rejection of bad deposit data, resume,
  Turkish parity.
* Browser: `scripts/mainnet-1click-qa.mjs` (fixture build: second browser refused,
  stranger cannot open the attempt, resume after reload).
* Live, non-spending: `docs/evidence/mainnet-1click-2026-11-16/`.
