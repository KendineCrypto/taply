# Testnet proof ledger (fill ONLY with observed, reproducible results)

## Phase 4A public read-only deployment verification — 2026-11-01

**Deployment is verified; payment is not. No actual Taply payment has happened.**
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

## Feature ledger

| Feature | Status | Contract/tx link | Test command/output | Known gaps |
|---|---|---|---|---|
| Instant contract deployment/config/accounting | TESTNET VERIFIED | Contract and deploy tx above | Read-only preflight 11/11 PASS | No payment; retained FullAccess authority |
| External wallet Testnet connect and balance | RESEARCH ONLY | No new wallet signature in this phase | Existing adapter preserved; user reports frontend reads work | No new browser/Meteor acceptance claimed here |
| Taply-local encrypted vault/identity/recovery | DISABLED | No on-chain local-wallet account | Local Web Crypto/security tests; see wallet technical guide | No SDK transaction backend; no production UI integration/signing |
| Native send review/receive QR | DISABLED | — | Exact amount/address/balance/storage/gas tests | Preparation only; no actual native send |
| Signed on-chain request creation | DISABLED | — | Existing contract + frontend tests | Instant Pay signing remains OFF |
| Instant Pay payout finality | NOT IMPLEMENTED | — | — | — |
| Static merchant checkout intent | NOT IMPLEMENTED | — | — | — |
| Handshake 2-device live session | NOT IMPLEMENTED | — | — | — |
| Protected lock -> refund | NOT IMPLEMENTED | — | — | — |
| Protected lock -> release payout | NOT IMPLEMENTED | — | — | — |
| Verified receipt (funding+payout/refund) | NOT IMPLEMENTED | — | — | — |
| Invisible Wallet genuinely on Testnet | RESEARCH ONLY | — | — | provider compatibility not yet verified |
| Sponsored gas | RESEARCH ONLY | — | — | — |

Allowed values: `NOT IMPLEMENTED`, `MOCK ONLY`, `TESTNET VERIFIED`, `DISABLED`, `RESEARCH ONLY`. Link actual Testnet explorer proofs; never claim user funds held or sent on Mainnet.
