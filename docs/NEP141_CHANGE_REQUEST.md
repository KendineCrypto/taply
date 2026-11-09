# Change request: NEP-141 token payments (P2, not started in code)

Status: **PROPOSED — needs lead approval before any code.** Raised 2026-11-09
from the cloud session (branch `claude/kind-cerf-c4n261`).

## Why this is a change request and not code

- Freeze v1 section 3: "Asset: `near:native` only." `packages/shared`
  `AssetIdSchema = z.literal("near:native")`, and every contract read is
  validated with that schema. A token request would fail closed in every
  client today.
- `docs/PAYMENT_STATE_MACHINE.md` "Mode support per asset": NEP-141 only after
  a reviewed storage, callback and refund design.

So the first step is agreeing the wire format below; code follows on approval.

## Proposed wire changes (shared, versioned)

1. `AssetIdSchema = "near:native" | "nep141:<tokenAccountId>"`; token account
   must be on a contract-side allowlist (`get_config.tokens[]` with
   `accountId`, `decimals`, `symbol`, `allowlistVersion`).
2. Terms gain nothing else: `amountBaseUnits` stays a u128 decimal string in
   the token's base units. `tokenAllowlistVersion` (already listed as an
   optional immutable field in the state machine doc) binds the allowlist
   version the recipient saw.
3. `OperationRecord.failureCode` gains `FT_TRANSFER_FAILED` and
   `FT_RECEIVER_NOT_REGISTERED`.
4. New method shapes: no new payer method. Funding is
   `ft_transfer_call(receiver_id = contract, amount, msg)` on the token
   contract, with `msg = {"id", "expectedTermsHash", "mode", "acceptedCancelDurationNs"?, "consentVersion"?}`
   (strict JSON, unknown fields rejected).

## Contract behaviour (candidate, after approval)

- `ft_on_transfer(sender_id, amount, msg)`:
  - `predecessor_account_id` must be the allowlisted token named in the terms
    (never trust `msg` for the token or payee).
  - `sender_id` is the payer; payer restriction, expiry, terms hash and exact
    amount are checked exactly like native funding.
  - Wrong amount / unknown request / expired / already funded → return the full
    `amount` as unused (NEP-141 refund), no state change.
  - Success → return `"0"`; instant → reserve and start payout; protected → `LOCKED`.
- Payout/refund: `ft_transfer(receiver, amount)` with 1 yoctoNEAR, then a
  private callback keyed by id + operation nonce + kind, same branch rules as
  native. A receiver without token storage makes `ft_transfer` fail; that
  records `*_FAILED_RECOVERABLE` with `FT_RECEIVER_NOT_REGISTERED` (best effort:
  the token's error text is not authoritative) and the UI tells the
  beneficiary to register storage on the token, then retry.
- Conservation is tracked per asset (`received[asset] = paid + refunded + locked + inFlight + failedHeld`).
- Liquidity guard per token: contract's own token balance (`ft_balance_of`) is
  not readable synchronously, so the guard relies on per-asset accounting only;
  this is a review point.

## Tests required before any deployment

Fake token contract in sandbox; wrong token caller; `msg` payee injection;
duplicate `ft_on_transfer`; unused-amount return; payout to unregistered
receiver; callback after token panic; conservation per asset; decimals display.

## Frontend

Token amounts use `Amount` with the allowlisted decimals/symbol only; an
unknown token renders as unsupported, never as NEAR. Feature flag `nep141`
(new, default OFF, `security_gate`).
