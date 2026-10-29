# Native Instant Pay ABI v0.4.0

This document describes the implementation, not an approved deployment. There is
no Testnet contract ID or live transaction evidence. `abi.json` is a Taply method
manifest, **not** a generated NEAR ABI-standard bundle. The export check compares
it with the actual production WASM.

## Encoding and types

JSON UTF-8, camelCase argument/response keys, snake_case method names. Unknown
fields and duplicate keys (including escaped aliases) fail for Taply methods.
The SDK-generated `contract_source_metadata` follows NEP-330 and has no Taply
argument parser; call with `{}`. It is informational, not deployment approval.
Every integer is a
canonical decimal **string**, with no leading zero except `"0"`, no signs,
fractions, exponent or whitespace. `U64` and `U128` are range checked; positive
types exclude zero. `HashHex` is exactly 64 lowercase hex characters. Account IDs
use NEAR's validated 2–64 byte syntax; syntax does not prove account existence or
network. Every nullable field must be explicitly present. Memo is at most 256
UTF-8 bytes; Unicode is not normalized. Runtime argument limit is 8192 bytes.

`IntentTerms` is exactly the existing shared `IntentTermsSchema` wire object:

```ts
type IntentTerms = {
  schemaVersion: 'taply.intent.v1'; id: HashHex; network: 'near-testnet';
  contractId: AccountId; creationNonce: HashHex; creatorAccountId: AccountId;
  assetId: 'near:native'; amountBaseUnits: PositiveU128;
  mode: 'instant'; cancelDurationNs: null; fundingExpiresAtNs: PositiveU64;
  permittedPayerAccountId: AccountId | null;
  merchantAccountId: null; memo: string; sessionBinding: null;
};
```

The Rust parser can decode frozen protected/session hash fixtures, but creation
and quoting reject those modes/bindings. Recipient is always creator, must equal
the direct caller on creation, and cannot be the payments contract. Contract ID
must equal the executing account. Funding expiry must be strictly after creation
and at most 24 hours later. Funding requires chain timestamp strictly below expiry.
Expired requests remain `OPEN` and can be cancelled; there is no stored EXPIRED.

Hash algorithms are frozen domain-separated SHA-256 over RFC8785 JCS, as defined
in the lead freeze. This schema's JCS subset contains only ASCII object keys,
strings and null. Both full shared A/B canonical byte fixtures are tested in Rust.
Consumed IDs are retained forever; any repeated creator/nonce creation fails,
even with identical terms. Nonces are opaque 32-byte values, not sequential counters.

## Methods

Exact argument objects, deposits, gas and access are in `abi.json`. All ordinary
mutations require signer = predecessor and predecessor != contract; forwarding
is unsupported. Methods not marked payable reject deposits through SDK wrappers.
Unknown valid IDs return null on reads, while malformed IDs or missing IDs fail.

* `new({})`: self-only initialization, once. No owner parameter, update method or
  treasury withdrawal. Provision/deploy/initialize atomically in any future
  approved deployment process. This method does not prove the network.
* `quote_create_request({terms})`: validates terms and unused ID, returns
  `{quoteVersion:'1', requestId:HashHex, termsHash:HashHex, storageBytes:U64,
  depositYocto:U128, gas:U64}`. Quote is deterministic for the terms/storage policy;
  revalidate immediately before signing. It is not a reservation.
* `create_request({terms,quoteVersion})`: requires exact quoted permanent storage
  bond, current quote version and recipient's direct signature. Returns the OPEN
  request. Rejecting a call rolls back state and attached deposits follow NEAR's
  protocol refund receipts; callers still pay execution gas.
* `cancel_unfunded({id,expectedTermsHash})`: creator-only OPEN → CANCELLED_UNFUNDED,
  including after expiry. Exactly one yoctoNEAR. No principal has been funded and
  no refund transfer is scheduled. Returns the terminal request.
* `pay_instant_native({id,expectedTermsHash})`: exact principal, optional payer
  restriction, unexpired OPEN and matching immutable hash. Records payer/funding
  time, commits nonce 1 and PAYOUT_IN_FLIGHT, then transfers principal to recipient.
  Returns the callback promise. Successful callback returns true; recorded failed
  transfer returns false. A successful transaction carrying false is NOT paid.
* `retry_native_transfer({id,expectedOperationNonce})`: recipient-only, exactly one
  yoctoNEAR, matching currently recorded failure nonce. Commits a new nonce and
  transfers the identical principal to the identical recipient. No refund branch,
  destination override or payer retry. Expiry does not erase a funded obligation.
* `on_native_transfer_complete({id,operationNonce,kind:'INSTANT_PAYOUT'})`: private,
  nonpayable. Only a matching in-flight operation and exactly one runtime result
  are accepted. Successful native Transfer must return empty bytes. Explicit
  `PromiseError::Failed` records PAYOUT_FAILED_RECOVERABLE; any other error/result
  panics without resolving the operation. Successful callback records FINAL_PAID.
  Stale/duplicate/wrong-kind callbacks panic without rescheduling anything.
* `get_request({id})`: returns the exact shared `ContractRequestSchema`, or null.
  No extra storage fields are added to that shared object.
* `get_receipt({id})`: returns `TerminalFacts` only for FINAL_PAID or
  CANCELLED_UNFUNDED; null otherwise, including unknown IDs and unresolved payouts.
* `get_config({})` and `get_accounting({})`: exact outputs below.

## Read objects

`ContractRequest` is exactly the frozen shared shape (validated against real
sandbox outputs by `scripts/check-wire.mjs`): terms, termsHash, null
sessionCommitment, recipientAccountId, status, revision, createdAtNs,
payerAccountId, fundedAtNs, null cancelUntilNs, settlementBranch and latestOperation.
Unfunded payer/time/branch/operation are null. Funded branch is RECIPIENT.
Operation fields are nonce, INSTANT_PAYOUT kind, destinationAccountId,
amountBaseUnits, status IN_FLIGHT/FAILED/SUCCEEDED, startedAtNs, resolvedAtNs and
failureCode. Only FAILED has NATIVE_TRANSFER_FAILED; only IN_FLIGHT has null
resolvedAtNs. Revisions: create 1; +1 per funding, retry, callback or cancellation.

```ts
type TerminalFacts = {
  schemaVersion: 'taply.terminal-facts.v1'; request: ContractRequest;
  terminalBlockHeight: U64; terminalAtNs: U64; payoutConfirmed: boolean;
  evidenceKind: 'CONTRACT_FACTS_NOT_FINALITY_PROOF';
};
type ContractConfig = {
  schemaVersion: 'taply.contract-config.v1'; contractVersion: '0.4.0';
  network: 'near-testnet'; contractId: AccountId;
  intentVersion: 'taply.intent.v1'; eventVersion: '0.4.0';
  capabilities: {instantNative:true; protectedPay:false; handshake:false;
    merchantProfiles:false; nep141:false; sponsoredGas:false};
  quoteVersion: '1'; storageByteCostYocto: U128;
  gas: {createRequest:U64; payInstantNative:U64; retryNativeTransfer:U64;
    cancelUnfunded:U64; callback:U64};
  storageRefundPolicy: 'PERMANENT_RECORD_NO_WITHDRAWAL';
  unknownCallbackPolicy: 'IN_FLIGHT_NO_RETRY_NO_ADMIN_OVERRIDE';
  testFaultBuild: boolean; // must be false on any approved deployment
};
type Accounting = {
  receivedPrincipalYocto: U128; confirmedPaidYocto: U128;
  inFlightPrincipalYocto: U128; failedHeldPrincipalYocto: U128;
  permanentStorageBondsYocto: U128; authenticationDepositsYocto: U128;
  requestCount: U64; runtimeStorageBytes: U64; runtimeStorageCostYocto: U128;
  runtimeAccountBalanceYocto: U128; inFlightMayAlreadyHaveTransferred: true;
};
```

Config reports compiled capabilities, not human approval, RPC finality or a
runtime code hash. Chain identity and the observed code hash must be verified
externally. Contract execution cannot read its originating transaction/receipt IDs
or independently prove finality. `TerminalFacts` is NOT `VerifiedReceipt`.

## Events and source of truth

NEP-297-style log prefix `EVENT_JSON:` with
`{standard:'taply',version:'0.4.0',event,data:[{id,termsHash,status,revision,operationNonce}]}`.
Events: request_created, request_cancelled, payout_started, payout_succeeded,
payout_failed. Operation nonce is `"0"` before funding. No logs contain secret
tokens or private keys. Events corroborate state and trigger refetch; they do not
prove a transfer or replace the receipt graph. Only finalized approved-code state
plus actual successful transfer and callback receipt evidence can support a
Verified Paid badge.

## Accounting and errors

Permanent bond = `(33-byte key + Borsh record bytes + 40 protocol overhead bytes)`
times runtime storage byte cost. Actual storage delta must equal the quote. All
mutable record slots are fixed size; updates reject any size change. Base state,
contract code and operational reserve are funded separately before use. There is
no storage withdrawal/refund promise because records and nonce consumption persist.

Principal received = callback-confirmed paid + failed-held + in-flight. In-flight
is not necessarily cash: a successful transfer may precede a failed callback.
Before each outgoing operation, require cash sufficient for runtime storage and
all held obligations. Authentication yoctoNEAR is tracked separately, not counted
as principal or service fees. Callers prepay gas; NEAR gas refunds/rewards are not
payment amounts. No arbitrary balance can be withdrawn by contract methods.

Contract panics are machine codes, not HTTP ApiError envelopes. Core codes:
NONCE_CONSUMED, REQUEST_ID_MISMATCH, TERMS_HASH_MISMATCH, REQUEST_NOT_FOUND,
EXACT_STORAGE_DEPOSIT_REQUIRED, STALE_QUOTE, STORAGE_QUOTE_MISMATCH,
STORAGE_GROWTH_FORBIDDEN, EXACT_PRINCIPAL_REQUIRED, ONE_YOCTO_REQUIRED,
DIRECT_WALLET_ONLY, RECIPIENT_ONLY, WRONG_PAYER, NOT_OPEN, FUNDING_EXPIRED,
INVALID_FUNDING_EXPIRY, NO_RECORDED_TRANSFER_FAILURE, OPERATION_NONCE_MISMATCH,
PRIVATE_CALLBACK, WRONG_OPERATION_KIND, STALE_CALLBACK, UNKNOWN_PROMISE_RESULT,
INSUFFICIENT_PREPAID_GAS, INSUFFICIENT_OPERATIONAL_LIQUIDITY,
ACCOUNTING_OVERFLOW, ACCOUNTING_UNDERFLOW, COUNTER_OVERFLOW, CONSERVATION_FAILURE.
Validation additionally reports INVALID_ARGUMENTS, INPUT_TOO_LARGE, INVALID_HASH,
NONCANONICAL_DECIMAL, U64_OVERFLOW, U128_OVERFLOW, ZERO_AMOUNT, MEMO_TOO_LONG,
UNSUPPORTED_SCHEMA, WRONG_NETWORK, WRONG_CONTRACT, SELF_RECIPIENT, TOKEN_DISABLED,
PROTECTED_DISABLED and HANDSHAKE_DISABLED. SDK wrappers may reject malformed JSON,
deposits on nonpayable methods, private access or repeated initialization earlier.

An ambiguous RPC result is never a contract failure proof. Re-read the same ID and
receipt graph; never generate a fresh nonce/payment or blindly retry a transfer.
