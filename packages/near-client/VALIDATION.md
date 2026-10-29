# Phase 1A validation — 2026-10-29

## Dependencies and reproducibility

Registry lookup returned lossless-json **4.3.3**; the installed declaration exports
`parse`, `stringify` and `isLosslessNumber`. Its exact pin and integrity are in the
workspace lockfile. Existing Phase 0 dependency pins remain unchanged.
`pnpm install --frozen-lockfile --ignore-scripts --offline` passed after installation.
Node **24.13.0**, pnpm **11.5.0**, TypeScript **7.0.2**.

## Check results

- `pnpm check`: PASS. Both package builds and TypeScript/type-contract checks
  passed; **92 shared + 93 near-client deterministic tests**, zero failures/skips.
- `pnpm --filter @taply/near-client test:integration` with the three public IDs
  below: **3 passed, 0 failed, 0 skipped**, duration **46.855 seconds**.
  Account checked at `15:26:32.646Z`, transaction at `15:26:51.244Z`, receipt at
  `15:27:09.749Z` on 2026-10-29. Receipt executor was `epochals.testnet` and its
  finalized block was `AGySKUxin4DZSz7K7ftM98KgvsMBNhozeQHfeeWoy2h8`.
- `git diff --check`: PASS. No separate lint or Rust build/test script exists
  in this worktree; no Rust or contract execution results are claimed.

The Windows sandbox initially denied child-process spawning (`EPERM`); workspace
checks then passed with approval to run compiler/test processes outside it.
Worktree commits likewise need access to Git metadata under `C:/taply/.git`.

## Actual read-only Testnet evidence

Provider: `https://rpc.testnet.near.org`. Observed chain ID `testnet`, genesis
`FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b`, node **2.14.0-rc.5**.

Live account test passed at `2026-10-29T15:21:48.189Z`:

- Account: `testnet` (public network root; not a Taply wallet or contract).
- Final block: `BaAji1J2b5ETCv8FrEoKcxCVpWkpUAPeUu8XTo7zdrCD`.
- Height: `275317564`; timestamp ns: `1793287293533585932`.
- Amount yoctoNEAR: `1015896143847750174012305522945`; locked: `0`.
- Storage bytes: `1186783`.

A separate client invocation successfully reconciled this existing public transaction
at `2026-10-29T15:24:01.109Z`:

- Transaction: `GsMs5URUdm74bZgeRJigxYFV7jcA8QE1ytpvjvGe4AJz`.
- Signer: `epochals-sphere.testnet`; receiver: `epochals.testnet`.
- Execution: `FINAL`, selected status `SUCCESS_VALUE`, two receipt outcomes.
- Transaction block: `AztWnLnXDuv3bL4vMqpTpwEpc7ggtaASao9NwH7TV1Tq`, height `275317727`.
- First receipt: `5kAJvnesJKrJD97tDnTCi1spiNPMeJRhg9kpXRE16q9K`.
- First receipt block: `AGySKUxin4DZSz7K7ftM98KgvsMBNhozeQHfeeWoy2h8`, height `275317728`.
- Second receipt: `DMTe5zsE6qd6PZk6psRXVGQQVZfZ72f3TriGKXgWmoov`.
- Second receipt block: `731VPh7k9NNLoQcxuYHFcJoPpJb1vMvjeK3dtkRYHVnw`, height `275317729`.
- Final tip at observation: `BHBx7PZfg6NPBumv6U8bEp74zPwV4JKhpNyAXMgkqFid`, height `275317796`.

The transaction was discovered from public finalized block/chunk reads, then
observed with the client. It belongs to an unrelated NFT application. We did not
create, sign, submit, or cause it. It is infrastructure evidence, **not Taply
settlement proof**. These are historical observations, not a current balance claim.

## Remaining integration gates

- No Taply deployment, approved contract ID/code hash, receipt-action verifier,
  contract state reader or end-to-end Instant Pay proof exists in this phase.
- Frontend/browser CORS and provider availability need application integration.
  Indexer/cache data must remain separate from these RPC observations.
- RPC finality is trusted-provider evidence; this client is not a light client.
- Security approval for escrow, wallet signing, social wallets and sponsorship
  remains outstanding; this package does not enable any of those capabilities.
- No apps/web, brand asset, contract, shared protocol or other branch was changed.
  Nothing was deployed, pushed, published or submitted.
