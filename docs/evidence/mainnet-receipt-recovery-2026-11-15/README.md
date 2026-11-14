# Mainnet receipt verification and pending-attempt recovery

Mainnet Preview scope. No transaction builder, contract, amount, cap, signing
permission, production domain, or unknown-outcome fence is removed.

## Receipt behavior

- Both devices use the existing bounded, read-only block/chunk funding locator
  when a first-attempt native payment has no locally saved transaction reference.
  The locator's input is now network-neutral; its algorithm and bounds are unchanged.
- A located or stored hash is only a candidate. The existing independent Mainnet
  settlement verifier must prove the funding call, exact amount/beneficiary,
  successful payout, callback, finality and deployment pins before the receipt
  becomes Verified Paid. No global verifier flag is enabled.
- Missing evidence, retry history, USDC, in-flight payouts and mismatches keep
  their existing honest states. This automatic native lookup never substitutes
  for the operation history other assets or retries require.
- The owner's supplied 0.1 NEAR example was located and independently verified
  against live Mainnet by read-only RPC. No signature or spend occurred.

## Recovery behavior

- A new review first reconciles a retained pending transaction hash. Only the
  existing FINAL execution verifier can retire that reservation. A fresh account
  snapshot is read afterwards. Replay tombstones and the one-shot send path remain.
- Missing hashes, unavailable proofs and mismatches still block another payment.
- The payment-safety panel periodically rechecks known hashes without signing or
  resending. Gift errors expose that panel instead of pointing to missing controls.

## Copy and presentation

- Removed obsolete unused Gift-disabled copy.
- Mainnet receipts use a compact presentation; full addresses remain in technical
  proof. Existing Testnet receipt defaults are unchanged.
- Main review shows the amount, receiving account and sender. Gas, nonce, key,
  storage reserve and arguments remain in the technical disclosure.
- Request URLs and completed-attempt history are collapsed. Required transaction
  confirmation and unresolved-outcome warnings remain visible.

## Validation

Targeted tests cover candidate-vs-proof separation, exact beneficiary matching,
late results after navigation, unsupported receipt states, retained-hash FINAL
recovery, unavailable/missing proof blocking, and replay after recovery.
The live read-only verification succeeded. Full CI results are linked from the PR.
