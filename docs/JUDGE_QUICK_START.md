# Judge quick start

Taply makes the merchant and payer agree on the request, then check the payment
on NEAR. This guide separates trying the product from inspecting its evidence.
[Current release identity](RELEASE_STATUS.md) · [Architecture/source map](SYSTEM_OVERVIEW.md)

## 1. Inspect real money movement without a wallet

Open the [Mainnet proof](evidence/mainnet-live-settlement-2026-11-14/README.md):
0.1 native NEAR, exact recipient, successful payout and callback, independently
verified. The public input/output JSON and a read-only replay script are included.
No wallet, recovery phrase or signature is needed.

For the earlier Testnet flow, open the
[pilot receipt](https://taplyapp.xyz/receipt/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502?ftx=CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su).
An RPC outage can prevent a fresh check. An archived result is labelled as an
archived result; it is not a new live verification.

## 2. Try the product with Testnet funds

Use [taplyapp.xyz](https://taplyapp.xyz) in two browsers or on two devices.
Test tokens have no monetary value. Faucet availability is external to Taply.

| Step | Action | Observe |
| --- | --- | --- |
| 1 | Create a Taply Wallet, or connect an existing NEAR Testnet wallet | Real account, recovery-phrase backup for Taply Wallet, chain balance |
| 2 | Create a small payment request, e.g. 0.05 test NEAR | Exact amount, recipient and expiry before signature; a QR/link after creation |
| 3 | Open the link in the second browser | Request terms read from the contract; Live Handshake presence/sale code when available |
| 4 | Review and approve in the payer wallet | Separate user confirmation; submitted is not yet paid |
| 5 | Follow the receipt on both screens | Contract payout state, then independent receipt verification when RPC evidence is available |
| 6 | Create a new Protected request with a 60-second window | LOCKED — NOT PAID; cancel before cutoff for refund, or release after cutoff in a separate run |

Optional: try the Testnet other-asset flow, contacts, Split and Recurring templates.
A template prepares a request; it does not schedule an unattended debit.
The [synthetic demo](https://taplyapp.xyz/demo) is explicitly labelled DEMO.

## 3. Inspect Mainnet with the correct release expectations

[Mainnet Preview](https://taply-mainnet-git-staging-mainnet-kendinecryptos-projects.vercel.app/m)
uses real funds. The native payment above was performed by the owner and then
independently verified by read-only RPC. Owner-reported Gift acceptance is a
separate claim, not established by that native proof.

The latest Mainnet receipt/recovery source is
[`f88bc3f`](https://github.com/KendineCrypto/taply/tree/f88bc3fdd1d7b9cfabf95f73a3b48baf376968eb).
Its CI is green, but Vercel rejected the new deployment with `build-rate-limit`.
The Preview can still show the older QR/receipt behavior. `taplyapp.xyz` remains
Testnet. [Deployment table](RELEASE_STATUS.md#source-and-deployment-identity).

## 4. Follow a claim into code

| Question | Starting point |
| --- | --- |
| What makes a request immutable and a payout final? | [Payment state machine](PAYMENT_STATE_MACHINE.md), `contracts/payments/src/lib.rs`; Mainnet [contract source](https://github.com/KendineCrypto/taply/tree/f88bc3fdd1d7b9cfabf95f73a3b48baf376968eb/contracts/payments-mainnet) |
| Can a websocket or UI animation mark a payment paid? | [Trust boundaries](SYSTEM_OVERVIEW.md); presence/session service is coordination only |
| What does Verified Paid prove? | [Public Mainnet proof](evidence/mainnet-live-settlement-2026-11-14/README.md) and pinned verifier linked there |
| What happens after a lost response? | [Mainnet reconciliation source](https://github.com/KendineCrypto/taply/blob/f88bc3fdd1d7b9cfabf95f73a3b48baf376968eb/packages/near-client/src/mainnet-reconciliation.ts) and [Phase 5 CI](https://github.com/KendineCrypto/taply/actions/runs/43650817911) |
| Which features have real Testnet browser evidence? | [Feature matrix](VERIFICATION_MATRIX.md), preserving original run dates |
| What remains unproven or unsafe to infer? | [Release boundaries](RELEASE_STATUS.md#remaining-boundaries) and [security](SECURITY.md) |

## Reproduce locally

Node 24.22.2, pnpm 11.5.0. On `main`:

```sh
pnpm install --frozen-lockfile
pnpm check
node --test apps/api/test/*.test.mts
cp apps/web/env/public-readonly.env.example apps/web/.env.local
pnpm --filter @taply/web build
pnpm --filter @taply/web start
```

This starts the read-only Testnet configuration on port 3000. Testnet signing
requires `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=on` and a rebuild.
For local Live Handshake, start a Redis REST shim in separate terminals:

```sh
redis-server --port 6390
node apps/web/scripts/redis-rest-shim.mjs 6390 8079 local-test-token
```

Then set `NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE=on`,
`KV_REST_API_URL=http://127.0.0.1:8079` and `KV_REST_API_TOKEN=local-test-token`
in the local environment before building/starting. Rust/sandbox workflows have
separate tool requirements; their evidence links are in [release status](RELEASE_STATUS.md).

To replay the Mainnet observation, follow the separate
[pinned read-only instructions](evidence/mainnet-live-settlement-2026-11-14/README.md#reproduce-the-check).
