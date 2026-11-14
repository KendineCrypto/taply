# Device-local signing release security review

Reviewed: `a6a37e6c417c2f0750e804b109585d82fc92f931` and
`docs/release/mainnet-signing-release.patch`, 2026-11-14. Scope is wallet
coordination/signing only, not contract deployment or product release approval.

## Decision

**NO-GO as submitted.** Three narrow fixes are supplied on
`codex/mainnet-device-release-review`. After integration and a passing release-patch
CI run on the corrected commit, **conditional GO for a separately owner-approved,
small-value internal-wallet native transfer test**, using one retained normal
browser profile and a dedicated test wallet. This is not approval to apply the
release patch, fund a wallet, transact, or release publicly.

External-wallet acceptance, token and contract-call release testing are not
established by the native browser harness. They remain outside this limited GO.
No new server authority is required for this explicitly restricted test scope.

## Release-blocking findings and fixes

1. **P1: acknowledged fences used default durability.**
   `apps/web/src/lib/mainnet/device-ledger.ts:50`: readwrite transaction atomicity
   was correct, and the implementation waited for completion rather than request
   success. However, default durability can acknowledge before disk flush; a power
   failure could lose the reservation after broadcast. Require `durability: strict`
   and refuse browsers that do not report it. No relaxed fallback.
   [IndexedDB specification](https://www.w3.org/TR/2026/WD-IndexedDB-3-20261029/)
   describes strict as a durability hint, not an absolute guarantee against loss.
2. **P1: false non-payment claim after FINAL execution failure.**
   `apps/web/src/components/mainnet/Operation.tsx:45` and `:125` asserted that funds
   were not transferred. Child receipts can succeed before another receipt fails.
   Both English and Turkish now require settlement inspection, without inviting
   a second payment. The coordinator already preserves the consumed operation.
3. **P1: unconditional replay guarantee omitted browser-data loss.**
   `apps/web/src/components/mainnet/Operation.tsx:42` and `:122` now explain that
   clearing/evicting data or restoring the wallet does not restore payment history.
   Stop after data loss; never clear data to retry an uncertain payment.

## Accepted limitations for the restricted test only

- The boundary is one origin/browser profile, not a physical device or account.
  Another browser, origin, profile or device has a separate ledger. Cross-device
  duplicate direct sends need not be deliberate. Nonce pinning rejects two
  transactions with the same nonce; it does not prevent a later duplicate with a
  fresh nonce. The release runbook's nonce statement must not be read as that guarantee.
- Browser deletion, eviction or rollback cannot be detected reliably by this local
  design. A missing ledger looks new. Phrase/encrypted-wallet restoration restores
  the key, not fences or tombstones. Retain the profile, avoid private browsing,
  use the account nowhere else, and halt/reconcile independently after any data loss.
- Unknown outcomes block all further payments. External lost-hash attempts cannot
  be cleared by a manually supplied matching transaction; this remains enforced at
  `packages/near-client/src/mainnet-reconciliation.ts:129`. Wallet rejection after
  handoff can also leave a permanent block. This is availability loss, not permission
  to clear storage or resend.
- FINAL execution is not contract settlement. Configured RPC is trusted for chain
  evidence; this is not a light client. No live wallet acceptance or Mainnet transaction
  was performed. Keep balances limited to the owner's explicitly approved test risk.
- The ledger is bounded and fails closed when full. No expiry/reset/takeover was added.

## Verification

Observed completed SUCCESS on the exact reviewed base commit:

- [Workspace](https://github.com/KendineCrypto/taply/actions/runs/43539746638)
- [Release patch, including synthetic open-gate browser signing](https://github.com/KendineCrypto/taply/actions/runs/43539732167)
- [WASM candidate](https://github.com/KendineCrypto/taply/actions/runs/43539732107)

Local corrected-tree results (all offline/synthetic; gates remain false):

```powershell
pnpm install --frozen-lockfile --offline
pnpm --filter @taply/shared build
pnpm --filter @taply/near-client build
# from packages/near-client: 35 passed
node --test test/mainnet-reconciliation.test.mjs test/mainnet-handoff.test.mjs test/mainnet-operation-policy.test.mjs test/mainnet-wallet-parity.test.mjs
# from apps/web: 6 passed, then typecheck passed
pnpm exec vitest run src/lib/mainnet/__tests__/release.test.ts --maxWorkers=2
pnpm exec tsc --noEmit
# from repository root; supply installed Playwright index path: 6 check groups passed
node apps/web/scripts/mainnet-release-browser.mjs <playwright-index.mjs> <output-directory> closed
git apply --check docs/release/mainnet-signing-release.patch
git diff --check
```

Real Chromium: 20 CAS attempts across two tabs yield one winner; stale CAS refused;
strict durability observed; unsupported durability refused; successful put followed
by transaction abort rejects without changing the record; records survive a browser
process restart; closed gate reserves/signs/broadcasts nothing. Restart was orderly,
not a physical power-loss experiment. Source lint passed with one pre-existing
non-null-assertion warning at Operation.tsx:273.

The corrected commit has **not** been CI-verified; the successful base runs do not
cover these changes. The existing release workflow will exercise the expanded
browser checks in both closed and patched modes when run on the corrected tree.
No signing gate was changed or release patch applied during this review.
