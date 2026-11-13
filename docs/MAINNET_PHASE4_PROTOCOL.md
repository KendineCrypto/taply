# Phase 4 protocol decision record

Base: `4d2e4865577924289a1947b1967797112ea23725`. Isolated branch:
`codex/mainnet-phase4-protocol`. No release gate is opened by this work.

## Transaction reconciliation boundary

Finalized transaction execution and payment settlement are separate facts. The
wallet may retire its nonce reservation only after independently reading a FINAL,
complete causal outcome graph matching the reserved account, public key, nonce,
receiver and exact actions. A failed callback does not establish failed delivery.
Retiring a reservation never authorizes repeating its business operation: permanent
operation tombstones remain, including after failed execution. No timeout, key
nonce advancement, missing transaction, wallet rejection or absent response proves
non-submission. An external-wallet hash is a lookup hint, never proof.

Cross-device signing requires one account-global, durable CAS authority. An
IndexedDB-only journal cannot satisfy that requirement. Device ownership has no
TTL or automatic takeover; another device may reconcile but cannot submit. Loss
of the authority or an acknowledgement blocks handoff. Production authentication,
durability/no-eviction and rollback protection remain release requirements.

## Signing policy

Only one reviewed Transfer or FunctionCall per transaction. No AddKey, DeleteKey,
DeleteAccount, DeployContract, delegate action, arbitrary batching or raw message
signer. Calls must be reconstructed from fresh anchored request/config/storage
evidence with existing typed builders, never accepted from caller JSON alone.
Internal signatures bind nonce and reference block. NEAR Connect 0.12 exposes
signAndSendTransaction with network/signer/receiver/actions but no nonce argument:
the wallet chooses its nonce; reconciliation must bind the returned on-chain
transaction to the reserved action and a nonce strictly above the preflight floor.
Wallet exceptions remain uncertain, including user rejection.

## Settlement and authority

Independent payment proofs require full causal receipt graphs, pinned payment and
token code, exact amounts, data dependencies and operation nonces. Refunds remain
refunds. Retry proofs must bind a recorded failed predecessor operation; they do
not manufacture success from current state. Router funding proves NEAR delivery
only, never the customer's Base debit/refund or upstream quote attribution.

Merchant/Handshake bindings must be immutable hashed terms signed by the merchant;
session presence and backend assertions have no payment authority. R-2 cannot be
resolved on chain from a missing callback without a separately reviewed proof
mechanism. No admin override or blind retry is introduced.

Implementation and evidence sections will be populated as subsystems pass tests.
