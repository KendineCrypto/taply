# Release evidence index

Real NEAR **Testnet** evidence only. Files under `docs/evidence/` hold public
data (accounts, hashes, receipts); automation keys never leave
`~/.taply-automation` on the machine that ran them.

| Date (UTC) | Capability | Contract (code hash) | Key transactions | Result | File |
| --- | --- | --- | --- | --- | --- |
| 2026-11-01 | G1 Instant Pay (owner pilot, historical) | `taply-pay-pilot-1.testnet` (`BrR6bioU…`) | funding `CrzQ57Jx…` | FINAL_PAID, Verified Paid | `evidence/instant-pay-2026-11-01-receipt.json` |
| 2026-11-09 | G1 Instant Pay (automation accounts) | `taply-pay-pilot-1.testnet` (`BrR6bioU…`, frozen, only called) | create `A5xd9ak9…`, fund `7Ajta5Tu…` | FINAL_PAID; recipient +0.01 exactly; duplicate refused (`NOT_OPEN`); **Verified** on near-public-testnet and fastnear | `evidence/testnet-e2e/2026-11-09T07-13-12-743Z-g1-instant.json` |
| 2026-11-09 | G3 Protected Pay candidate: refund + release | `taply-e2e-6a6a1fc6.testnet` (`Auw8pZ1T…`, 0 access keys) | refund: fund `8PwUPWtd…`, cancel `9mGVhXBK…`; release: fund `3zbo2exy…`, release `UZg8dQYU…` | CANCELLED_REFUNDED (0.02 back to payer) and FINAL_PAID (0.02 to recipient); 4 adversarial calls refused | `evidence/testnet-e2e/2026-11-09T07-18-30-031Z-g3-protected.json` |
| 2026-11-09 | NEP-141 token payments (TEST-ONLY token) | token `taply-e2e-826c3e79.testnet` (`4WtMAoc8…`), candidate `taply-e2e-6cdaf61b.testnet` (`Ea5REQGA…`), both 0 keys | instant `HhXDEW5f…`; protected fund `FuFnF5cK…`, cancel `B43XpNWH…` | FINAL_PAID (payer −2.5 / recipient +2.5 tUSD-TEST exactly); duplicate returned; protected refund made payer whole | `evidence/testnet-e2e/2026-11-09T07-37-35-259Z-nep141.json` |
| 2026-11-09 | G2 merchant-bound sale (Handshake session binding) | `taply-e2e-9c2eeea4.testnet` (`2QiZFmd5…`, 0 keys) | create `J51nUgZs…`, fund `379pZmM4…` | FINAL_PAID; merchant +0.015 exactly; contract session commitment = client commitment (code `2RB15M`); second sale for the same session refused (`SESSION_ALREADY_USED`); **Verified** on both providers | `evidence/testnet-e2e/2026-11-09T07-59-39-406Z-g2-merchant.json` |

Reproduce (Node 24, from `packages/near-client`, behind a proxy add
`NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<CA>`):
`node testnet-e2e/g1-instant.mjs`, `node testnet-e2e/g3-protected.mjs`, `node testnet-e2e/nep141-token.mjs`, `node testnet-e2e/g2-merchant.mjs`.
Each creates or reuses disposable faucet accounts and writes a new evidence file.

Not evidence of: owner physical-wallet acceptance, external audit, mainnet.
