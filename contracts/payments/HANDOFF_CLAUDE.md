# Phase 2B wallet integration handoff

Scope: native Instant Pay implementation and local sandbox evidence only. **No
Testnet deployment is approved or configured.** Keep financial production/demo
activation gated on the human-reviewed deployment ID and observed code hash.

No root pnpm manifests/lockfile, shared schemas or apps/web source changed. The
contract and sandbox use their own Cargo manifests/locks. Claude can integrate
the frozen method arguments without any new root dependency. If wallet selection
needs packages, propose exact versions to the lead separately; this change does
not authorize root wallet dependency changes.

1. Verify Testnet chain/genesis and approved contract code hash with near-client.
   Fetch `get_config`; reject a fault build and unsupported modes. This config is
   contract-specific, not the HTTP API config. The present near-client supports
   accounts/transaction outcomes; typed contract `call_function` reads and a full
   settlement action/receipt verifier still need integration before Verified Paid.
2. Generate and durably journal a cryptographically random 32-byte creation nonce
   **before** opening a wallet. Compute deterministic ID and terms hash through
   `@taply/shared`. Recipient creates; use instant/native, null cancel duration,
   null merchant/session binding, explicit null payer constraint if unrestricted.
   Use chain time for funding expiry, at most 24 hours after execution.
3. Fetch `quote_create_request({terms})`. Display principal, permanent storage bond
   (no refund on cancellation/settlement), and separate wallet gas estimate. Sign
   `create_request({terms,quoteVersion})` with exactly `depositYocto` and the quoted
   gas. On unknown outcome keep the journaled ID and reconcile it; all duplicate
   creation attempts are rejected, not treated as new invoices.
4. Read `get_request({id})` at a finalized block and parse with the unchanged shared
   ContractRequestSchema. Independently recompute terms hash. Validate the signer,
   displayed account, amount, expiry and expected contract/code before funding.
5. Sign `pay_instant_native({id,expectedTermsHash})`, attaching **exact principal**
   and at least 50 Tgas. There is no extra payer storage deposit. Never combine an
   overpayment or gas fee with the attached principal. Payout is asynchronous.
6. A callback promise can resolve `false` with a successful top-level transaction:
   this means recorded payout failure, NOT Paid. Use state + receipt evidence.
   PAYOUT_IN_FLIGHT has no automatic timeout/reset/retry. A successful transfer
   followed by failed callback can remain in flight permanently; show unresolved.
7. Only recipient may sign `retry_native_transfer` for a fresh verified recorded
   failure, supplying its exact current nonce, one yoctoNEAR and 50 Tgas. Destination
   and amount cannot change. Payer has no refund/retry action in Instant mode.
8. Recipient may `cancel_unfunded` from OPEN with matching hash, one yoctoNEAR and
   15 Tgas. No principal refund occurs, and the permanent storage record remains.
9. `get_receipt` returns terminal contract facts, **not VerifiedReceipt**. Verify
   approved code, finalized state, funding action, transfer destination/amount,
   matching callback and graph relationships. Transaction hashes and internal
   receipt IDs are distinct. Events/socket status are refetch hints only.

Exact ABI: [ABI.md](ABI.md), [abi.json](abi.json). Security decisions and unresolved
deployment gates: [ADR-001.md](ADR-001.md). Reproduction and actual results:
[README.md](README.md), [VALIDATION.md](VALIDATION.md).

Protected Pay, Handshake/merchant profiles, FT, relaying, social wallets,
refunds, admin settlement and migrations are absent. Do not enable them from a
shared enum or render a green success state for any unresolved operation.
