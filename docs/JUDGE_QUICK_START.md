# Judge quick start

Taply makes the merchant and payer agree on the request, then check the payment
on NEAR. This guide separates trying the product from inspecting its evidence.
[Current release identity](RELEASE_STATUS.md) · [Architecture/source map](SYSTEM_OVERVIEW.md)

## 1. Inspect real money movement without a wallet

Open the [Mainnet proof](evidence/mainnet-live-settlement-2026-11-14/README.md):
0.1 native NEAR, exact recipient, successful payout and callback, independently
verified. The public input/output JSON and a read-only replay script are included.
No wallet, recovery phrase or signature is needed.

The [archived Testnet pilot verifier result](evidence/instant-pay-2026-11-01-receipt.json)
provides the earlier network's evidence. It is labelled as an archive, not a new
live verification. The public domain now serves Mainnet.

## 2. Open the live Mainnet app

[Open taplyapp.xyz](https://taplyapp.xyz). The root redirects to `/m`; the welcome
screen identifies NEAR Mainnet. You can inspect onboarding, navigation and
request screens without signing. Mainnet uses real funds, not faucet tokens.

The current public domain serves **fa42157**, with the clean header, resilient
display balance reads, QR-to-receipt, compact
Gift/result and same-tab wallet reload fixes. Its three CI workflows passed;
Vercel lists the exact commit and the domain on a Ready deployment. The actual
0.1 NEAR request shows [Verified Paid on the live payment page](https://taplyapp.xyz/m/pay/a035569dc9662a19a7cd077606150e1f443673cef6823fe766ac4c73db852d16)
after independent verification. The public inputs/output in section 1 let you
check that claim separately.

The earlier wallet/receipt build 7c0eac8 became Ready on **15 November at 00:09:33 UTC**.
The subsequent header/balance release is recorded in the [latest live check](evidence/mainnet-header-balance-2026-11-15/README.md). The earlier
14 November domain launch served fa4235f while deployment quota was exhausted;
that historical launch is not relabelled as the newer build.

[Current live evidence](evidence/mainnet-unlock-live-2026-11-15/README.md) ·
[Source/deployment table](RELEASE_STATUS.md#source-and-deployment-identity).
The former public Testnet domain has moved; dated Testnet browser reports retain
their original URL and date as historical evidence.

## 3. Reproduce the Testnet product flow

Use `main` locally (setup below) and two browser sessions. The documented Testnet
flow covers wallet creation, a small request, QR/link review, explicit wallet
approval, both-device receipt verification, and separate Protected Pay refund
and release runs. Faucet/RPC availability is external to Taply.

The original public-site results are archived for [native/token payment and
checkout](evidence/production-regression-2026-11-11/),
[Protected refund/release](evidence/production-protected-pay-2026-11-11/result.json)
and [14 adversarial refusals](evidence/protected-adversarial-2026-11-11/result.json).
They establish real Testnet behavior at their dates, not current Testnet hosting.
Do not use the now-Mainnet domain for an old Testnet transaction or recovery flow.

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
