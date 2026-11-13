# Mainnet functional parity: protocol handoff

Base: `8ca50598ad5ad8bc7dbe86239f0df98ed58a0709`. Development branch:
`codex/mainnet-parity-protocol`. This document specifies implementation boundaries;
it is not evidence of deployment, successful tests or release approval.

## Stable boundaries

The deployed Testnet crates and `payments-mainnet` instant ABI remain unchanged.
New escrow and Gift candidates live in independent crates. Their distinct versions,
network, immutable constructor configuration and code hashes must be checked before
building calls. An account address alone is never deployment identity.

Mainnet wallet records use separate storage and authenticated `near-mainnet`
metadata. Testnet encrypted backups and sessions are rejected, including when
copied into Mainnet storage. Explicit phrase restoration derives the standard NEAR
key; it does not prove account activation. Local creation is not chain creation.
Activation requires final Mainnet account and FullAccess key evidence. There is no
faucet, named-account sponsor, key-deletion helper or automatic activation transfer.

Signing remains unavailable in the shipped application. Implementations must retain
password unlock, exact transaction review, signer/key/network/nonce binding and
fresh final balance checks. No general raw-message wallet signer is exported.
External wallet handoff is a potentially submitted transaction before its response
arrives; cancellation, timeout or absent hash is not evidence of non-payment.

Durable attempt storage must atomically reserve an operation before handoff and
serialize account/key nonce use. Unknown outcomes survive reload and block another
potential payment. A time limit or expired block hash alone cannot prove that an
earlier transaction failed. Only independent final evidence permits resolution.
Storage failure blocks signing; failure after handoff remains uncertain.

## Gift candidate

No Mainnet Gift account, fee or amount limits have been approved. Constructor inputs
must explicitly bind `network`, `contract_id`, `min_amount`, `max_amount` and `fee`;
there are no Mainnet defaults copied from Testnet. Sandbox values are test data.
The separate Gift account must not equal payment, recovery or staging accounts.
The production profile remains unconfigured until owner approval.

Preserve 32-hex Gift IDs, one-use fragment link keys, contract-bound beneficiary
signatures, first-claim reservation, creator-only expiry refund and beneficiary-only
known-failure retry. Mainnet claim signatures use a distinct domain to prevent
cross-network reuse. Unknown payout callbacks remain pending with no retry or
administrative settlement override.

## Escrow candidate and R-2

Use an independent Mainnet escrow crate with a distinct version and explicit
contract identity. Preserve immutable consent/cutoff, exact deposits, storage bond,
operation nonce, private callbacks and per-asset conservation. Router delivery is
not supported by escrow; the instant contract retains all router/unclaimed handling.
The escrow account must never be used as a 1Click recipient.

`LOCKED` is not paid. `*_IN_FLIGHT` is unresolved even if a transfer may have
succeeded. Only a successful, matching callback records settlement; only a recorded
transfer failure allows retry of the same beneficiary and obligation. R-2 is
contained by refusing retry after unknown outcomes, not eliminated. Mainnet escrow
release requires separate security acceptance.

## Integration and release

Claude must import the new explicit Mainnet exports rather than adapt Testnet
schemas using casts. Merchant/Handshake bindings must be committed into exact
on-chain terms; authenticated session identity and websocket status never settle a
payment. Independent receipts must establish transaction/receipt ancestry, exact
beneficiary and amount, finality, deployment identity and callback outcome. Contract
state alone is labelled Payment Recorded, not independently Verified Paid.

Keep `MAINNET_SIGNING_RELEASE_APPROVED`,
`ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED`,
`MAINNET_INDEPENDENT_VERIFIER_AVAILABLE` and `intentsRouter` false.
No deployment, funding, production merge or account-key action is authorized.
Per-subsystem exports, evidence and remaining gaps will be appended after testing.
