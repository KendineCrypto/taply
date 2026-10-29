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

## Frontend public API

| Method | Observed data | Required input |
| --- | --- | --- |
| `checkNetwork()` | Testnet genesis, chain ID, provider ID, node version | Explicit client config |
| `readAccount(accountId)` | Exact amount, locked amount, storage bytes, code hash | NEAR account ID |
| `readNativeBalance(accountId)` | Native asset and exact account balance fields | NEAR account ID |
| `checkContract()` | Account fields with the configured code hash checked | Non-null approved contract config |
| `observeTransaction(ref)` | Finality, top execution status, root/receipt outcomes, block references | `{ transactionHash, signerAccountId }` |
| `observeReceipt(ref)` | One transaction-bound receipt outcome and its block | `{ transactionHash, signerAccountId, receiptId }` |

All six methods return the same `ReadResult<T>` convention. The package is ESM,
uses standard Fetch/Web Streams/TextDecoder, and has no Node-only runtime imports.
Browser use requires an RPC provider with CORS support; this phase's live tests
run in Node, not in the frontend browser. For provider credentials, use a trusted
server proxy configured to serve Testnet reads, never client-side secrets.

Transactions request `tx_status` with `wait_until: FINAL`. Only method-not-found
triggers the documented `EXPERIMENTAL_tx_status` alias on the same provider.
Timeout, unknown status, shard errors and HTTP failures never trigger that fallback.
`NONE`, `INCLUDED`, `EXECUTED_OPTIMISTIC`, `INCLUDED_FINAL`, and `EXECUTED` are never
promoted to `verified_final`; full non-final responses use `pending_finality`.
Hash-only or incomplete responses cannot become final evidence.

Before final assurance, the observer checks transaction hash/signer/root executor,
unique receipt IDs, the complete rooted outcome graph, selected return status,
and each outcome's block hash/height/time against the final tip. Missing outcomes,
unknown final statuses, orphan receipts, cycles, repeated edges, or inconsistent
blocks fail closed. Limits are 256 receipt outcomes and 32 distinct outcome blocks;
oversized or longer histories need a separately reviewed reconciliation service.
Each call has its own timeout; a transaction observation can make up to 36 RPC
requests including the legacy alias. There is no unbounded graph traversal/polling.

`ReceiptObservation` is an **execution outcome**, not the frozen `VerifiedReceipt`
payment proof. It excludes receipt action payloads and does not verify deposit,
transfer beneficiary/amount, request terms, operation nonce, callback method or
contract settlement state. It needs its originating transaction; there is no bare
receipt-ID lookup that can manufacture finality. Optional RPC `receipts` payloads
may omit the first self-receipt; outcome reconciliation does not rely on those
payloads. Pruned or unavailable history returns an error; configure an appropriate
trusted archival Testnet provider when that history is required.

**A finalized successful transaction is not `FINAL_PAID`.** Failed child payouts
remain visible even if the top execution succeeds. Callback failures remain
visible even after a successful transfer. Base64 return values (including encoded
`false`) and logs are data, never settlement authority or UI HTML. The client has
no payment-state projection, `PaymentIntentResponse` builder, `VerifiedReceipt`
builder or financial retry eligibility API. Frontend integration may display these
observations, but must keep payment controls disabled until the later settlement
verifier and approved deployment exist.

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
On a fresh checkout, run `pnpm install --frozen-lockfile --ignore-scripts`, then
`pnpm check` before the optional integration command so shared exports are built.
`@taply/near-client/testing` is the only injectable transport entry point. Its
observations always have `source: mock`, `assurance: unverified`, null
`observedBlock`, and `rpcAvailable: false`. Mock success is never Testnet proof.

Live tests are separate and opt-in:

```powershell
pnpm --filter @taply/near-client test:integration
```

That reads the public `testnet` account. To also observe an **existing** transaction
and receipt, set all three environment variables below, using known public IDs:

```powershell
$env:TAPLY_TESTNET_TRANSACTION_HASH = '<existing transaction hash>'
$env:TAPLY_TESTNET_SIGNER_ACCOUNT_ID = '<existing transaction signer>'
$env:TAPLY_TESTNET_RECEIPT_ID = '<receipt produced by that transaction>'
pnpm --filter @taply/near-client test:integration
```

There is no mock fallback, synthetic success or silently skipped configured test.
RPC outages/pruning can fail live tests independently of deterministic unit tests.
See [observed Phase 1A results](./VALIDATION.md) for actual evidence and limits.

Dependencies are exact pins: workspace `@taply/shared`, Zod 4.6.7,
jsonc-parser 3.3.1, lossless-json 4.3.3; TypeScript 7.0.2 on Node 24.13.0 and
pnpm 11.5.0. The parser's installed API and these RPC methods were checked against
primary documentation on 2026-10-29:

- [NEAR account RPC](https://docs.near.org/api/rpc/contracts)
- [NEAR transaction RPC](https://docs.near.org/api/rpc/transactions)
- [NEAR status RPC](https://docs.near.org/api-reference/post-status)
- [NEAR block RPC](https://docs.near.org/api-reference/post-block)
- [lossless-json API](https://github.com/josdejong/lossless-json)
