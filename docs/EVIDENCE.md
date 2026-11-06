# Testnet proof ledger (fill ONLY with observed, reproducible results)

> Historical proof ledger: preserve original observation dates and results. Phase 7H later reverified the pilot via archival RPC ([report](PHASE_7H_INTEGRATION_REPORT.md)); Phase 7I release preparation added no chain observation. See [current scope and limitations](RELEASE_READINESS.md). The feature ledger below is a 2026-11-01 snapshot, not the current frontend inventory.

## Phase 4A public read-only deployment verification — 2026-11-01

**Historical Phase 4A read-only snapshot:** Deployment was verified and no payment had happened at the time of this check. The later live-payment proof is recorded below.
The agent performed public reads only. It did not create/import an account,
deploy, enable signing or move funds. No private key, credential, local env or
private wallet journal is included here.

- Contract: [`taply-pay-pilot-1.testnet`](https://testnet.nearblocks.io/address/taply-pay-pilot-1.testnet).
- Deployment transaction: [`4G9hs8A44uHLPcGtFzLnuxgpyPyWRP6BZ1rziEHNCSFj`](https://testnet.nearblocks.io/txns/4G9hs8A44uHLPcGtFzLnuxgpyPyWRP6BZ1rziEHNCSFj).
- Public provider: `https://rpc.testnet.near.org`; checked at
  `2026-11-01T13:28:00.391Z` using `EXPERIMENTAL_tx_status`, wait_until FINAL.
  Execution FINAL, `SuccessValue("")`; signer = receiver = contract.
  Exactly DeployContract + FunctionCall `new`, `{}`, zero deposit, 30 Tgas.
- Transaction block: `6po1LLb3kUBuuuQisG78BQNAfZCSfb33gxNbJ7eCs1N8`.
  Init receipt `AUZrbm6jcLMMhQtcmbhSQuoGiE5nMh8mh1GGKK59VtRv`
  executed on the contract with `SuccessValue("")`.
- Approved production code hash: `BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`.
  Production WASM SHA-256 remains
  `a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2`.
  The deployment RPC's DeployContract `code` field contains the already-computed
  32-byte code digest, not the original WASM bytes; do not hash that digest again.
- Post-deploy preflight observed **11/11 PASS**, at final block
  `8eeUsFqS1C8KETR17fKQKYPwKQ3tBokkcLvczSC9gvhj`:
  named Testnet account, approved code, one retained FullAccess key, non-fault
  build, matching contract/network, Instant-only capability, quote v1,
  storage-covered balance, conserved principal and no funded requests.
- A second anchored state read at `2026-11-01T13:33:02.294Z`: final block
  `G3Swv1QJo5GRo6mPDbKEZtgUzUpboeCxr8in7arwqSZP`, height `275755286`,
  timestamp ns `1793539970445540652`. Code hash matched. Account liquid amount
  `9997319475981065200000000` yoctoNEAR; storage `345872` bytes.
  `get_accounting`: requestCount `0`, received/confirmed paid/in-flight/failed-held
  principal all `0`. `get_config`: Instant native true; Protected/Handshake/
  merchant/FT/sponsorship false; `testFaultBuild: false`.
- The new wallet chain reader was also exercised read-only against this existing
  public contract/key at final block `6jMC5DZfz7Q3zAn71Jxd6458aDom1iVToAnZPGg82JgE`,
  height `275755696`: exact amount/storage matched, storage price `10^19`
  yoctoNEAR/byte, gas price `10^8` yoctoNEAR/gas. This validates infrastructure
  reads; the contract/deployer identity is **not** a generated Taply-local wallet.

Reproduce the public checks from repo root (no wallet/key needed):

```sh
node apps/web/scripts/deploy-preflight.mjs post taply-pay-pilot-1.testnet --fresh --rpc https://rpc.testnet.near.org
```

`--fresh` is valid only while no requests exist; omit it after pilot use.
Raw transaction lookup: method `EXPERIMENTAL_tx_status`, params
`{"tx_hash":"4G9hs8A44uHLPcGtFzLnuxgpyPyWRP6BZ1rziEHNCSFj","sender_account_id":"taply-pay-pilot-1.testnet","wait_until":"FINAL"}`.
State reads are pinned to the same final block, not mixed optimistic queries.
Trust model is configured RPC, not a light client or security audit. Retained
upgrade authority and callback-stall limitations still apply.

## First live native Instant Pay — 2026-11-01

**Observed user-run Testnet pilot: FINAL_PAID and Verified Paid in Taply's independent receipt verifier.** The operator supplied Taply's public `Copy receipt evidence (JSON)` output and screenshots. The verifier reported `verified_final` via the configured `fastnear-testnet` RPC at `2026-11-01T15:36:30.100Z`. The evidence was captured from the app; this documentation update did **not** independently re-query the chain or perform another signing operation.

- Request ID: `9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502`; immutable terms hash: `11903572703c42b9b2f0b110f861a83eed84d3cdeac955027b2bc241836888f3`.
- Contract: `taply-pay-pilot-1.testnet`; approved code hash `BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`.
- Payer: `taply-pilot-funder-1101.testnet` (NEAR CLI); recipient: `taplytest.testnet`; exact amount: **0.1 Testnet NEAR** (`100000000000000000000000` yoctoNEAR).
- Funding transaction: [`CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su`](https://testnet.nearblocks.io/txns/CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su); signing account matches payer; `operationNonce = 1` (no retry).
- Funding receipt: `Zyj9hfcEsqZQ4DiDDqyZaVYsEqCkv4ppkshVms9Y1uJ`, executor contract, **SUCCESS**, block `275767733`.
- Native transfer receipt: `3kLbAxp9Q4XC1DCr7BNF6Vcy6XPYmNJyTHADA9R9MTv4`, executor recipient, **SUCCESS**, block `275767734`.
- Callback receipt: `3FZ4Eu6JYy9LHikK42hx5E6ZAsrTgcnZ3i4CN7hQgvJp`, executor contract, **SUCCESS**, block `275767735`.
- Observed finalized contract state block: `275768214` (`Ex5DkzLb7M7hrhEEhAW7VQVtmM4Nhsz8j4CH3nUkS9US`); final status `FINAL_PAID`.
- Exact verifier output, including hashes, block timestamps and `configured-rpc` trust metadata: [`docs/evidence/instant-pay-2026-11-01-receipt.json`](evidence/instant-pay-2026-11-01-receipt.json).
- To reproduce via the client verifier on a locally running Taply build configured for this contract and a compatible CORS-enabled Testnet RPC: `/receipt/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502?ftx=CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su`. This URL path is local to the build; no public HTTPS pilot has been proven.

**Boundaries:** Successful CLI-initiated Testnet payment + independently checked receipt do **not** demonstrate mobile wallet redirect, Taply-native wallet signing, second-RPC-provider replication, the full multi-device pilot or a public beta. The native wallet signing gate remains OFF. The configured RPC is trusted (not light-client verification or an external security audit); retained FullAccess authority and callback-stall risks remain. No Mainnet funds involved.

## Feature ledger

| Feature | Status | Contract/tx link | Test command/output | Known gaps |
|---|---|---|---|---|
| Instant contract deployment/config/accounting | TESTNET VERIFIED | Contract and deploy tx above | Read-only preflight 11/11 PASS | Retained FullAccess authority and callback-stall risk |
| External wallet Testnet connect and balance | TESTNET VERIFIED | User-run Meteor wallet flow and Testnet request | Operator observed real balance and signed request | Physical mobile redirect not yet tested |
| Taply-local encrypted vault/identity/recovery | DISABLED | No on-chain native Taply wallet account | Local Web Crypto/vault/UI tests; reviewed SDK signer code built | Signing gate off; live account/transfer and security acceptance pending |
| Native send review/receive QR | DISABLED | — | Exact amount/address/balance/storage/gas + SDK signer tests | No independently signed Taply-native transfer; gate off |
| Signed on-chain request creation | TESTNET VERIFIED | Request ID and subsequent [funding transaction](https://testnet.nearblocks.io/txns/CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su) | Operator created request via Meteor; chain later returned FINAL_PAID for same request | Original creation tx hash not independently archived here |
| Instant Pay payout finality | TESTNET VERIFIED | [Funding/payout tx](https://testnet.nearblocks.io/txns/CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su) | User-provided receipt: FINAL, transfer SUCCESS, callback SUCCESS, FINAL_PAID | Configured-RPC trust; cross-provider replay pending |
| Static merchant checkout intent | NOT IMPLEMENTED | — | — | — |
| Handshake 2-device live session | NOT IMPLEMENTED | — | — | — |
| Protected lock -> refund | NOT IMPLEMENTED | — | — | — |
| Protected lock -> release payout | NOT IMPLEMENTED | — | — | — |
| Verified receipt (Instant native payout) | TESTNET VERIFIED | [Receipt evidence](evidence/instant-pay-2026-11-01-receipt.json) | Taply displayed Verified Paid; verified_final via fastnear-testnet | Native refund/protected-mode verification not implemented; third-device check pending |
| Invisible Wallet genuinely on Testnet | RESEARCH ONLY | — | — | provider compatibility not yet verified |
| Sponsored gas | RESEARCH ONLY | — | — | — |

Allowed values: `NOT IMPLEMENTED`, `MOCK ONLY`, `TESTNET VERIFIED`, `DISABLED`, `RESEARCH ONLY`. Link actual Testnet explorer proofs; never claim user funds held or sent on Mainnet.
