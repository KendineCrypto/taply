# Taply v0.4 typed contract and HTTP/SSE API (design, NOT deployed)

## Freeze these types before parallel coding
```ts
type Network = 'near-testnet';
type Amount = string; // strict positive integer base units; no JS float
// NEAR native decimals 24; token decimals from verified contract allowlist
type Asset = { kind: 'native'; symbol: 'NEAR'; decimals: 24 } |
 { kind: 'nep141'; contractId: string; symbol: string; decimals: number };
type PayMode = 'instant'|'protected'|'milestone';
type ChainState = 'OPEN'|'CANCELLED_UNFUNDED'|'PAYOUT_IN_FLIGHT'|
  'LOCKED'|'REFUND_IN_FLIGHT'|'RELEASE_IN_FLIGHT'|
  'REFUND_FAILED_RECOVERABLE'|'RELEASE_FAILED_RECOVERABLE'|
  'PAYOUT_FAILED_RECOVERABLE'|'FINAL_PAID'|'CANCELLED_REFUNDED';
type SessionState = 'OPEN'|'JOINED'|'REVIEWED'|'EXPIRED'|'DISCONNECTED'|'CLOSED';
type VerifyState = 'unverified'|'pending_finality'|'verified_final'|'stale'|'mismatch';
interface Verification { state: VerifyState; source: 'chain'|'index'|'mock';
  checkedAt: string; blockHeight?:string; explorerUrl?:string; payoutTxHash?:string; }
interface PaymentIntent {
 id:string; network:Network; contractId:string; mode:PayMode;
 creatorAccountId:string; recipientAccountId:string; payerAccountId?:string;
 asset:Asset; amountBaseUnits:Amount;
 status:ChainState; createdAtNs:string; expiresAtNs?:string;
 cancelUntilNs?:string; merchantId?:string; sessionCommitment?:string;
 version:number; verification:Verification;
}
interface HandshakeSession { id:string; intentId?:string; merchantId?:string;
 state:SessionState; expiresAt:string; comparisonCode:string;
 connectedParticipants:number; nonceCommitment:string; }
interface Receipt { requestId:string; mode:PayMode; finalStatus:'FINAL_PAID'|'CANCELLED_REFUNDED';
 network:Network; payerAccountId:string; recipientAccountId:string;
 asset:Asset; amountBaseUnits:Amount; contractId:string;
 fundingTxHash:string; payoutOrRefundTxHash:string; verified:Verification; }
interface MerchantProfile { slug:string; accountId:string; displayName:string;
 status:'account_bound'|'unverified'; verifiedAt?:string; }
interface Contact {id:string; label:string; accountId:string; storage:'local';}
interface SplitGroup {id:string; asset:Asset; total:Amount;
 parts:{accountId?:string; share:Amount; requestId?:string; status:ChainState}[];}
interface RecurringTemplate {id:string; ownerAccountId:string; amount:Amount;
 asset:Asset; cadence:'weekly'|'monthly'; timezone:string;
 status:'active'|'paused'|'cancelled'; nextDueAt:string;}
```

## API (read, coordination; not a payment authority)
- `GET /api/health` -> network, API version, chain watcher freshness, status.
- `GET /api/assets` -> allowlisted verified Testnet tokens, precision, contract ids.
- `GET /api/payment-intents/:id` -> PaymentIntent with proof provenance and finality.
- `GET /api/receipts/:id` -> Receipt or 404/409 `NOT_FINAL`.
- `GET /api/merchants/:slug` -> MerchantProfile; account binding evidence if available.
- `POST /api/sessions` -> server-created opaque session + short-lived join URL; authenticated merchant authorization; rate limits and CSRF rules.
- `POST /api/sessions/:id/join` -> validate join token and intent binding; never accept caller-provided verified flag.
- `GET /api/sessions/:id/events` -> authenticated SSE hints (`session.joined`, `intent.seen`, `payment.changed`, `session.expired`); client re-fetches chain on payment changes.
- `GET /api/merchants/:slug/payments` -> authenticated merchant-scoped requests; server verifies merchant receiver binding.
- `GET /api/accounts/:id/activity?cursor=` -> chain-indexed activity with provenance.
- `GET /api/splits/:id`, `GET /api/recurring/:id` -> optional read projections.

## On-chain methods (Rust names & params subject to SDK verification)
`create_request(args, attached storage deposit?) -> id`; `cancel_unfunded(id)`;
`pay_instant_native({id}, attached deposit)`;
`fund_protected_native({id}, attached deposit)`;
`cancel_protected({id})`; `release_protected({id})`;
`get_request({id})`; `get_receipt({id})`; `get_supported_assets()`;
`ft_on_transfer(sender_id, amount, msg)` for FT later.
Never expose a mutable unsigned `mark_paid`, `change_recipient` or `cancel_for_payer` HTTP endpoint.

## Contract event schema
`{standard:'taply',version:'0.4.0',event:'request_created'|'funded'|'locked'|'refund_started'|'refunded'|'release_started'|'paid'|'payout_failed',data:[{intentId,accountId?,asset?,amountBaseUnits?,operationNonce?}]}`; include signed chain tx evidence from event envelope, not forged payload.

## Frontend routes
`/` wallet; `/send`; `/receive`; `/request/new`; `/pay/[id]`;
`/checkout/[slug]`; `/merchant`; `/activity`; `/receipt/[id]`;
`/contacts`; `/split`; `/recurring`; `/settings`; `/demo` for explicitly fake simulation.

## Errors (must map to human messages)
`WRONG_NETWORK`, `INVALID_ACCOUNT`, `INVALID_ASSET`, `INVALID_AMOUNT`, `INSUFFICIENT_BALANCE`, `INSUFFICIENT_GAS`, `AUTH_REQUIRED`, `WALLET_NOT_READY`, `SOCIAL_LOGIN_NOT_TESTNET_CAPABLE`, `USER_REJECTED`, `REQUEST_EXPIRED`, `REQUEST_ALREADY_FUNDED`, `REQUEST_ALREADY_SETTLED`, `WINDOW_STILL_OPEN`, `CANCEL_WINDOW_CLOSED`, `REFUND_IN_FLIGHT`, `PAYOUT_IN_FLIGHT`, `REFUND_FAILED`, `PAYOUT_FAILED`, `UNVERIFIED_MERCHANT`, `SESSION_EXPIRED`, `SESSION_MISMATCH`, `NETWORK_UNAVAILABLE`, `RPC_TIMEOUT_UNKNOWN_STATUS`, `RATE_LIMITED`, `RECEIPT_NOT_FINAL`.

## API compatibility
Use Zod or equivalent schema validation and TypeScript strict mode. Backend/UI mock fixtures must carry `verification:{source:'mock',state:'unverified',checkedAt:...}`. Unknown transaction status is UNKNOWN, never PAID. Schema changes need lead approval + matching Rust fixture updates.
