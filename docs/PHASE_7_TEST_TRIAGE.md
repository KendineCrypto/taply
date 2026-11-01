# Phase 7 signer test triage

Runtime: Windows PowerShell, Node v24.22.2, pnpm 11.5.0, 2026-11-01.
`node --test packages/near-client/test/wallet-payment-signer.test.mjs` reproduced
1 pass / 3 failures before correction. Names share prefix "SDK adapter reuses"
and suffix "preparation, exact args/deposit/gas and never claims Verified Paid":
pay_instant_native, cancel_unfunded, retry_native_transfer.

All threw NearClientError: nearClient.errors.INVALID_ARGUMENT, rpcAvailable false,
contractCode null. Stack (dist/contract.js): refuse:93:11 ->
preparePayInstantNative:132:9 / prepareCancelUnfunded:161:9 /
prepareRetryNativeTransfer:147:9 -> test:33:43 / 34:40 / 35:9 ->
node:internal/test_runner/test:1409:7 (Test.run) -> :974:7
(Test.processPendingSubtests). No network or real signing transaction involved.

Baseline dd582bfee7f7592d775363a086c6ba88b39969b7 was reproduced by extracting
its exact test with git show to a temporary sibling test file, running Node test,
then deleting the temporary file. Same 1 pass / 3 failures and stack. Baseline and
pre-fix HEAD test blob both b255bbea9634e815ed706fb9fcec525b6069d452;
contract.ts both 6e7951138f87758a1dad739f74fd0dec3d9ce4dc. Shared and near-client
trees had no Phase 7 changes. This is a pre-existing clock-dependent test defect,
not a Phase 7 production regression or Windows-specific signing failure.

Root cause: fixture createdAtNs remains October 31; test replaces only expiry
with Date.now()+15 minutes. ContractRequestSchema correctly rejects funding
lifetime >24 hours. create_request passes because it validates IntentTerms,
which has no createdAtNs. Fix moves the entire synthetic lifecycle relative to
the fixture clock, preserving funding/operation ordering, and asserts the complete
ContractRequest schema before testing signing. Production code unchanged.
Targeted rerun: 4/4 passed. Fixtures and disposable test keys remain offline only.
