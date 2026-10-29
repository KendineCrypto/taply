# @taply/near-client — Phase 1A

Wallet-neutral, read-only NEAR Testnet infrastructure. No signer, wallet selector,
key storage, transaction construction, broadcast, deployment or payment actions.
Uses native Fetch and a small JSON-RPC allowlist, without a signing SDK.

## Configuration and account reads

```ts
import { createNearTestnetClient } from '@taply/near-client';

const near = createNearTestnetClient({
  network: 'near-testnet',
  rpcUrl: 'https://rpc.testnet.near.org',
  rpcProviderId: 'near-public-testnet',
  contract: null, // No approved Taply deployment yet.
});

const result = await near.readNativeBalance('testnet');
if (result.error === null && result.observation.assurance === 'verified_final') {
  // Exact decimal strings in yoctoNEAR. Do not convert to Number.
  console.log(result.observation.data?.amountYoctoNear);
}
```

`checkNetwork()`, `readAccount(accountId)`, `readNativeBalance(accountId)` and
`checkContract()` return `ReadResult<T>`: the frozen shared `ChainObservation<T>`
plus a typed, sanitized `error | null`. Configuration errors throw `NearClientError`
synchronously; read failures return null data and an error, never a zero balance.

Every public read verifies RPC `chain_id`, pinned public Testnet genesis hash and
node sync state. Account reads first select `block(finality: final)`, query at that
exact hash, then compare returned block hash and height. Account suffixes alone
do not establish network identity. HTTPS endpoints with embedded credentials,
query parameters or fragments are rejected; server applications must supply a
trusted static endpoint configuration, not an end-user URL.

`contract: null` is required until a deployment is approved. To check an approved
deployment, configure `{ accountId, expectedCodeHash }`. This checks the NEAR code
hash at a finalized block; it does **not** approve that code's security or verify
a payment. The account's `amount` includes storage collateral; the client does
not calculate spendable balance or invent storage/gas budgets.

## Trust and errors

`source: rpc` means an observation from the configured RPC, not an indexer, cache,
websocket or wallet. `verified_final` means this particular read is anchored to
final RPC evidence, not that a Taply payment is paid. This is RPC trust, not a
light-client or cryptographic proof against a malicious provider.

There is no automatic cache fallback and no indexer input. Outages return a new
unknown observation; consumers retain any previous verified observation separately
and mark it stale if displaying it. Never turn an unavailable/unknown read into
an absent request, unpaid transaction, failed transfer, or permission to retry a
payment. The API must retain the shared `PaymentIntentResponse` payment envelope.

Fetch uses `cache: no-store`, `credentials: omit`, and rejects redirects. Exclude
these requests from service-worker caching too. Runtime errors expose codes and
localization keys, not RPC messages or URLs. `retry` describes **reads only**.
There are no automatic timeout retries. RPC calls default to 10 seconds each
(configurable 100–30,000 ms), responses to 1 MiB (1 KiB–4 MiB), JSON depth to 48.
Large numeric RPC tokens are parsed losslessly and returned as decimal strings;
duplicate keys, malformed UTF-8, invalid hash lengths and mismatched evidence fail.

## Tests and dependencies

`pnpm check` builds/typechecks both packages and runs deterministic unit tests.
`@taply/near-client/testing` is the only injectable transport entry point. Its
observations always have `source: mock`, `assurance: unverified`, null
`observedBlock`, and `rpcAvailable: false`. Mock success is never Testnet proof.

Dependencies are exact pins: workspace `@taply/shared`, Zod 4.6.7,
jsonc-parser 3.3.1, lossless-json 4.3.3; TypeScript 7.0.2 on Node 24.13.0 and
pnpm 11.5.0. The parser's installed API and these RPC methods were checked against
primary documentation on 2026-10-29:

- [NEAR account RPC](https://docs.near.org/api/rpc/contracts)
- [NEAR transaction RPC](https://docs.near.org/api/rpc/transactions)
- [NEAR status RPC](https://docs.near.org/api-reference/post-status)
- [NEAR block RPC](https://docs.near.org/api-reference/post-block)
- [lossless-json API](https://github.com/josdejong/lossless-json)
