# Mainnet payment feedback — 2026-11-15

Scope: Mainnet Preview only; no Testnet production migration, DNS change,
contract deployment, wallet funding or real transaction by this change.

## Behavior

- A creator's request QR stays live. FINAL_PAID plus a successful payout replaces
  it with the receipt. An unavailable read or in-flight payout never displays
  success. Returning from another tab refreshes the request immediately.
- Open Gift is a compact envelope followed by amount, message and Claim gift.
  Unwrap does not claim. The exact transaction review is still required.
- After submission the claim action disappears. Only a fresh FINAL contract
  read with CLAIMED/REFUNDED and CONFIRMED payout displays completion. Pending,
  failed and unknown outcomes have explicit states and no automatic payout retry.
- Gift reads poll and refresh after submission and on returning to the app.
  Reads from a previous gift or an earlier request cannot overwrite a newer read.
- Personal Gift unwrap starts an independent transfer check and displays the note
  without a large empty envelope. This is a read, not a claim transaction.
- Public transaction references are retained in browser session storage and used
  for automatic receipt-graph checks when available. Link seeds are not included.
  Missing history, including missing earlier retry references, never becomes proof.
  A creator on another device may have contract-state confirmation without the
  payer's transaction references; a stronger receipt claim is not invented.
- Technical details and manual verification remain available in disclosures.

## Checks

- TypeScript and ESLint: passed (existing warnings remain).
- Full web suite before the final Personal Gift simplification: 1568 passed,
  20 existing gated/visual skips. Additional automatic-settlement tests: 5 passed.
- Focused feedback suite: 16 passed (creator QR/receipt, Gift completion,
  read errors, polling/navigation races, automatic receipt verification).
- Standalone API strict types/lint and offline tests: 80 passed, 5 real-Redis
  tests skipped locally. CI runs those with Redis.
- Phase 4 browser checks now cover the mobile Claim button position and a
  polled AVAILABLE → CLAIMED/CONFIRMED transition without reload or transaction.
  Browser screenshots are produced by that CI run, not asserted here in advance.

The signing Preview previously failed the API check because its test assumed a
closed protocol gate. The test now verifies refusal before signing for either
release state (closed gate or absent wallet identity/locked vault). The workflow
selects the existing open/closed adversarial release-browser suite from the actual
checked-out protocol gate; no signing gate or money limit is changed.

Phase 6 is explicitly a CLOSED-gate authority test. On the signing Preview the
workflow creates a temporary closed protocol build for that phase, restores the
source on exit, and retains all 18 assertions. The actual release state is tested
by the existing open/closed release-browser suite before that isolated variant.
No committed or live signing constant is changed by this test setup.
