# Genuine public NEAR Testnet RPC responses

**These are NOT Taply payments and prove nothing about Taply.** They are unrelated
public Testnet transactions, captured read-only on 2026-11-01 with
`EXPERIMENTAL_tx_status` (`wait_until: FINAL`) through `https://test.rpc.fastnear.com`
(protocol version 88). They exist only to test that the receipt verifier parses
real RPC output and handles real receipt graphs.

| File | Transaction | Why it is useful |
|---|---|---|
| `linkdrop-create-account-callback.json` | `4rtKGZobbcLxfHcaCkvGGfeLUJE49UTY4dF7Y4dDrgys` (`meteor-relay.testnet` → `testnet`, `create_account`) | Same topology as an Instant Pay payout: the contract receipt returns `SuccessReceiptId(callback)`, an outgoing receipt containing a `Transfer` routes its result to the contract (`output_data_receivers`), the callback consumes that `data_id` and returns `true`; gas refunds come from `system` |
| `failed-call-with-refunds.json` | `GGtLkFd3fmc9pWuWCGvkmC6S6iBqzdmiSVxJq8fPTsR5` (`zcash-relayer.testnet` → `zcash-client.n-bridge.testnet`) | A FINAL transaction whose contract call failed, followed by deposit and gas refunds from `system` |

Edits: in `failed-call-with-refunds.json` the large binary `args` of the one
function call was replaced by a short base64 placeholder, identically in the
transaction and in its first receipt. Nothing else was changed. All account IDs
are public on-chain data.

Observation from a sample of 70 recent Testnet transactions: 68 listed the first
receipt in `receipts`, 1 did not (the verifier then derives it from the signed
transaction), and no non-Action receipts appeared.

`final-block.json` is an unedited read-only `block` / `finality: final` response
from `https://rpc.testnet.near.org`, captured 2026-11-01 at approximately
12:20:07 UTC (protocol 88), block
`6yyQncsPtVd3LZorBMt2FZMs7vsGFX2aoPLLu6dk1P5q`, height 275747769.
Its legacy numeric `header.timestamp` is exactly 1793535606670615924, above
JavaScript's safe integer limit. The verifier must preserve it losslessly while
using the string `timestamp_nanosec`. This is RPC compatibility evidence only.
