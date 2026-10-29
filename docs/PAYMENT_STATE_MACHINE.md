# Payment engine — canonical state machines (must read before coding)

## Immutable intent fields
`id`, `creator`, `recipient`, `assetId`, `amountBaseUnits: u128`, `mode`, `createdAtNs`, `expiresAtNs?`, `cancelUntilNs?`, `merchantId?`, `sessionCommitment?`, `tokenAllowlistVersion?`. Enforce creator authorization, storage budget, strict valid account IDs, token allowlists, exact amount and meaningful deadlines. Request terms may not mutate after signing.

## Mode vs session independence
**Handshake != escrow.** Handshake controls *presentation, pairing and notifications*; on-chain intent controls *ownership and funds*. An offline Handshake server must not change who gets paid, amount, cancelability or proof of payout.

## Requested lifecycle
`DRAFT (off-chain only)` -> `OPEN` -> `FUNDING` -> `[mode-dependent]` -> `CLOSED`.
`OPEN -> EXPIRED` if funding not yet accepted; expiry assessed on-chain, not trusted client clock.
`OPEN -> CANCELLED_UNFUNDED` by creator with valid authority. `FUNDED` requests cannot be "cancelled" using unfunded cancellation.
On-chain state is source of truth, backend `EXPIRED` projections are derived unless a transaction records it.

## Instant pay
`OPEN -> PAYOUT_IN_FLIGHT -> FINAL_PAID` on payout confirmation.
`PAYOUT_IN_FLIGHT -> PAYOUT_FAILED_RECOVERABLE` on failed callback; beneficiary can retry payout (idempotent) or appropriate safe refund branch under reviewed rules.
If direct atomic native transfer is used, codify why actual receipt is final and who bears storage/gas; don't pretend receipt exists merely because deposit was received.

## Protected pay
`OPEN -> LOCKED` upon exact deposit, record payer + cancelUntilNs agreed **before deposit**.
`LOCKED -> REFUND_IN_FLIGHT` **only** when chain timestamp < cancelUntilNs and signer=payer.
`LOCKED -> RELEASE_IN_FLIGHT` **only** when chain timestamp >= cancelUntilNs and no refund in flight.
`REFUND_IN_FLIGHT -> CANCELLED_REFUNDED` after successful payer refund callback.
`RELEASE_IN_FLIGHT -> FINAL_PAID` after confirmed beneficiary payout callback.
Failed promise -> `REFUND_FAILED_RECOVERABLE` or `RELEASE_FAILED_RECOVERABLE` with reserved balance still accounted for; retry authorization & idempotency; do NOT reset to LOCKED allowing both branches without careful versioning.

## Critical invariants
1. Single on-chain payment authority. UI/backend may not mark payment `FINAL_PAID`.
2. At most one active outgoing transfer for each funded obligation at any time.
3. Fund accounting: funds received = transferred to recipient + refunded to payer + safely reserved liability + explicit supported fees. **No leakage, no double spending**.
4. Release vs cancel race: decision committed atomically **before** async external transfer; callbacks restricted to self and tied to intent + monotonically increasing operation nonce.
5. Do not unlock for another path while any promise might still settle; retries of failed transfers require evidence of failure and preserved balance.
6. A request may be funded once only. Duplicate source/token callbacks or replay cannot create additional obligations.
7. Deadline enforced with chain time; browser countdown purely indicative. Merchant UI labels `LOCKED (NOT PAID)`.
8. `ft_on_transfer` caller is **the FT contract**; `sender_id` identifies payer. Reject unsupported sender/asset/amount, return unused amount per NEP-141 and test failure resolution; never accept arbitrary `msg` to change payee.
9. Cross-contract payout/resolver may fail if recipient not registered with FT storage; user should receive actionable status rather than silent success.
10. Native NEAR transfer may be delayed/fail: verify actual promise outcome before `FINAL_PAID`.
11. Never allow caller-controlled `paid`, `verified`, `settled` booleans.
12. On-chain source references must include transaction + relevant receipts/outcomes; a single incoming deposit tx is not proof outgoing payout succeeded.

## Human-readable session comparison code
Session nonce should be generated with secure random bytes. Bind immutable on-chain intent id, chain contract id, asset, amount, recipient, merchant account and session id into SHA-256 canonical serialization, then take e.g. first 30 bits and encode Crockford Base32 as 6 characters. A six-character code helps humans compare session details but can collide and isn't cryptographic merchant authentication. Exact derivation documented in shared package and tested with vectors. Session tokens expire; no trust in displayed same code if an attacker controls both browser views.

## Declined signing
Wallet rejection causes `USER_REJECTED` local status; do not create `FUNDED` or `PAID` state. If tx submitted but RPC timed out, query chain/tx status before enabling retry to prevent double pay.

## Mode support per asset
G1/G3 **native NEAR first**; NEP-141 after reviewed storage, callback and refund design. Any unsupported asset/mode disabled rather than quietly routed to unsafe flow.
