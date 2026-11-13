# Mainnet instant protocol v0.6.0-mainnet

2026-11-13. Interface-first implementation target based on infrastructure
`6776cdd`. NOT deployment evidence. The owner's mainnet implementation mission
supersedes earlier Testnet-only implementation restrictions on this branch.
Deployment, funds, keys, hosting, DNS and merges remain separately owner-approved.
No automatic key deletion; keep staging intact. Existing contracts are frozen.

## Constructor and network

New independent crate: `contracts/payments-mainnet`. Private self-called
`new`, zero deposit, 30 TGas, exact arguments:

```json
{
  "tokens": [{"accountId":"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","decimals":6,"symbol":"USDC"}],
  "routerAccountId":"intents.near",
  "recoveryAccountId":"kendinecrypto.near",
  "nativeCapYocto":"1000000000000000000000000",
  "usdcCapBaseUnits":"25000000"
}
```

Only those values are accepted, immutable forever. Contract identity must be
`taply-pay.kendinecrypto.near` or staging `devkendinecrypto.near`.
Network `near-mainnet`; chain ID `mainnet`; genesis
`EPnLgE7iEq9s7yTkos96M3cWymH5avBAPm3qx3NXqR8H`.
A contract cannot read genesis: client and deployment tool must verify it.
RPC `https://rpc.mainnet.fastnear.com`, archival
`https://archival-rpc.mainnet.fastnear.com`, alternative
`https://rpc.mainnet.near.org`; explorer `https://nearblocks.io`.
No runtime switch or cross-network fallback. Pin account AND deployed code hash.
No approved mainnet code hash exists yet.

## Request types and ABI

Preserve `taply.intent.v1`, JCS/domain-separated hashes, required nullable fields,
string u128/u64 numbers; use `network:near-mainnet`. Recipient equals creator.
Initial candidate supports instant only; Protected Pay fails `PROTECTED_DISABLED`.
Assets: `near:native` (24 decimals, positive, <=1 NEAR) and `nep141:<USDC>`
(6 decimals, positive, <=25 USDC). Creation AND quote enforce caps:
`NATIVE_CAP_EXCEEDED`, `USDC_CAP_EXCEEDED`. No merchant/session binding.

| Method | Arguments | Deposit / gas |
| --- | --- | --- |
| get_config / get_accounting | `{}` | view |
| quote_create_request | `{terms}` | view |
| create_request | `{terms,quoteVersion:"1"}` | exact quoted storage bond / 30 TGas |
| get_request / get_receipt | `{id}` | view |
| cancel_unfunded | `{id,expectedTermsHash}` | creator, 1 yocto / 15 TGas |
| pay_instant_native | `{id,expectedTermsHash}` | exact principal / 50 TGas |
| retry_native_transfer | `{id,expectedOperationNonce}` | failed payout beneficiary, 1 yocto / 50 TGas; native or token |
| ft_on_transfer | `{sender_id,amount,msg}` | allowlisted token predecessor, zero deposit |
| withdraw_unclaimed | `{token,amount,receiver}` | direct recovery account, 1 yocto / 50 TGas |
| on_unclaimed_transfer_complete | `{operationNonce}` | private callback / 15 TGas |
| on_native_transfer_complete | `{id,operationNonce,kind:"INSTANT_PAYOUT"}` | private callback / 15 TGas |

Request storage is permanently charged to creator at the exact quote, never to
principal. Register contract and merchant on USDC before funding, using fresh
`storage_balance_bounds` and `storage_balance_of` reads. Previously observed
registration minimum 1250000000000000000000 yocto is not a fresh quote.

## Exact message and router delivery

Both wallet and 1Click must use one shared exported message builder:

```json
{"id":"<64 lowercase hex>","expectedTermsHash":"<64 lowercase hex>","action":"pay_instant"}
```

Wallet calls USDC `ft_transfer_call` with
`{receiver_id:<pinned contract>,amount:<exact principal>,msg:<above string>}`,
1 yocto and 100 TGas. No payee override in message.
1Click: EXACT_OUTPUT, `destinationAsset:nep141:<USDC>`, DESTINATION_CHAIN
recipient, identical `customRecipientMsg`. Verify quote signature AND echoed
amount, recipient, asset, message and swap type before presenting funding.

Authenticate token predecessor first; only `sender_id:intents.near` gets router
treatment. Valid OPEN instant USDC request, correct hash and permitted payer:
pay exact principal, retain surplus unclaimed. Late but OPEN router deliveries
are accepted. Direct wallet funding remains exact and rejects expired requests.
Reserve outgoing state before scheduling transfer; duplicate/concurrent attempts
cannot pay a request twice.

Malformed messages, unknown ID, wrong hash/asset/mode/payer, non-OPEN,
underpayment and insufficient remaining payout gas retain the full router
delivery in a fixed-size unclaimed ledger and return `"0"` unused. No success
state. Payout requires >=40 TGas REMAINING after validation (15 transfer + 15
callback + overhead). These are initial budgets pending measurement.

**Unresolved execution boundary:** no receiver can guarantee non-panicking
execution under arbitrarily little gas, oversized outer JSON, storage insolvency
or runtime failure. A failed receiver may return funds to Intents, NOT the
customer. Router checkout stays disabled pending sandbox evidence and an
accepted upstream gas/message envelope; a historic 258.8 TGas delivery is not a
protocol guarantee. Never automatically retry an uncertain cross-chain payment.

## Unclaimed accounting and recovery

Fixed-size per-token `unclaimedHeld`, `unclaimedInFlight`, `unclaimedWithdrawn`,
`routerReceived`; one global recovery operation with nonce, amount and receiver.
At most one recovery transfer at once. Reserve held -> in-flight before transfer.
Known callback failure restores held; success credits withdrawn; missing/unknown
callback stays in-flight, no retry. Only recovery account may choose receiver,
after manual attribution. This is custodial authority over unclaimed funds only,
not request principal or failed payouts. No automatic customer attribution.

Conservation per token: received = paid + refunded + locked + failedHeld +
inFlight + unclaimedHeld + unclaimedInFlight + unclaimedWithdrawn.
Received includes router excess and semantic rejections. Plain unsolicited
`ft_transfer` is outside this ledger and is not recoverable by this API.

## Events, configuration and finality

Existing EVENT_JSON `standard:taply`, `version:0.4.0` events:
request_created, request_cancelled, payout_started, payout_succeeded,
payout_failed; data fields id, termsHash, status, revision, operationNonce.
New router_unclaimed event: bounded reason, amount, token, nullable valid id.
New unclaimed_withdrawal_started/succeeded/failed: nonce, amount, receiver, token.
Never log raw messages. Events alone do not prove finality.

get_config preserves candidate fields with contractVersion `0.6.0-mainnet`,
network `near-mainnet`, exact constructor fields, capabilities.instantNative and
nep141 true, protectedPay false, intentsRouter false (release gate),
protected.reviewStatus `UNREVIEWED_OWNER_ACCEPTED_CAPPED`,
unknownCallbackPolicy `IN_FLIGHT_NO_RETRY_NO_ADMIN_OVERRIDE`,
testFaultBuild false for any deployable artifact. No administrative settlement.

OPEN -> PAYOUT_IN_FLIGHT -> FINAL_PAID only after successful transfer callback.
Known transfer failure -> PAYOUT_FAILED_RECOVERABLE; beneficiary explicitly
retries with observed nonce. Missing/unknown callback remains in-flight.
**R-2 is still open**, including recovery callbacks; no blind retry or override.
Deposit, 1Click SUCCESS and elapsed time never mean paid.
Final-block FINAL_PAID permits **Payment Recorded**. **Verified Paid** requires
proven receipt graph, exact merchant transfer, callback, network and code hashes.
No mainnet verification path is proven.

## Claude handoff and release decision

Build fixtures against this interface, keeping mainnet signing/quotes disabled.
External wallets first; mainnet must never unlock a Testnet vault. Protected Pay,
internal wallet creation, split, recurring, swaps and CSV are outside this pilot.
No mainnet funds moved; size/funding estimates and tests remain to be measured.
Current recommendation: **NO-GO for real funds**.
