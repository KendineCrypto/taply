# Mainnet candidate ABI

The normative interface is [docs/MAINNET.md](../../docs/MAINNET.md).
Version `0.6.0-mainnet`; schema `taply.contract-config.v1`; no deployment.

Request/receipt shapes retain the reference model in `src/model.rs`, with
mainnet-only intent validation and instant-only request creation. Constructor
fields, methods, callback arguments, gas budgets, events and recovery constraints
are specified in the normative interface. Read `get_config` at a final block
with matching code hash; never infer that a capability is approved from method
existence. The inherited protected methods cannot be used to create/fund a valid
protected request in this new contract and are not pilot capabilities.

Additional rejections: INVALID_MAINNET_CONFIG, WRONG_CONTRACT,
INVALID_TOKEN_ALLOWLIST, INVALID_CAPS, PROTECTED_DISABLED,
NATIVE_CAP_EXCEEDED, USDC_CAP_EXCEEDED, RECOVERY_ONLY,
INVALID_RECOVERY_RECEIVER, RECOVERY_IN_FLIGHT, INSUFFICIENT_UNCLAIMED.
Recovery callback: PRIVATE_CALLBACK, STALE_CALLBACK, UNKNOWN_PROMISE_RESULT.
Other inherited errors are literal guards in `src/lib.rs` and `src/model.rs`.

Router reason codes: INVALID_MESSAGE, UNKNOWN_REQUEST, WRONG_MODE, WRONG_HASH,
WRONG_ASSET, NOT_OPEN, WRONG_PAYER, UNDERPAYMENT, LOW_GAS, LOW_LIQUIDITY,
SURPLUS. They do not imply a payment or a refund.

Source of truth: final contract state plus the successful merchant transfer and
its private callback. `get_receipt` returns contract facts, not receipt-graph
verification. R-2 remains open.
