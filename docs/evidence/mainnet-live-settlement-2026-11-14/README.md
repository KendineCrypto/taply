# Real Mainnet settlement: 0.1 NEAR

This is an **archived read-only verification of a real Mainnet payment**, observed
on 14 November 2026 UTC. The owner created and paid the request in Taply; the
agent independently located and verified it without a wallet key or signature.
The JSON is the recorded result, not a promise that every later RPC call succeeds.

| Field | Observed value |
| --- | --- |
| Network | `near-mainnet` |
| Request | `a035569dc9662a19a7cd077606150e1f443673cef6823fe766ac4c73db852d16` |
| Contract | [`taply-pay.kendinecrypto.near`](https://nearblocks.io/address/taply-pay.kendinecrypto.near) |
| Pinned code hash | `9VpaiMp3Hoq8pVVvCW6oSZrvzBdZoNNgUmLCXrm32wX6` |
| Funding transaction | [`3a7kNLaYQH5aFUjHk422bRQ2iSt4pwMWhVGfBTMP7J2N`](https://nearblocks.io/txns/3a7kNLaYQH5aFUjHk422bRQ2iSt4pwMWhVGfBTMP7J2N) |
| Payer | `kendinecrypto.near` |
| Beneficiary | `ad797669c357fa0f741db7b4cda9779528af3f15e15ce660e7606871ea5c5ea3` |
| Exact amount | `100000000000000000000000` yoctoNEAR = **0.1 NEAR** |
| Contract result | `FINAL_PAID`; `INSTANT_PAYOUT` nonce `1`, `SUCCEEDED` |
| Independent result | `VERIFIED_SETTLEMENT`, `PAID`, `NEAR_SETTLEMENT_ONLY` |
| Trust model | `configured-rpc`, not a light client |

## What was checked

The existing Mainnet verifier accepted the funding call and the exact payout
receipt graph, including the successful callback, expected beneficiary/amount,
asset and deployment pins. Public receipt identifiers are preserved verbatim in
[proof.json](proof.json); the observed contract view and discovery result are in
[request.json](request.json). A candidate transaction hash alone was not counted
as proof.

The verified native payment establishes neither Gift/escrow acceptance nor
USDC/cross-chain settlement. No new payment, deployment, signature, key import or
fund transfer was made during this independent check. The UI deployment status
is separate: [release status](../../RELEASE_STATUS.md).

The published replay script was run again successfully at **23:13:34 UTC** on
14 November: [fresh recheck output](recheck.json). It used the local source tree
equivalent to the pinned Mainnet version. This file is now also an archive; its
`freshCheck` field describes that execution, not the time you open the file.

## Reproduce the check

Requires Node 24.22.2, pnpm 11.5.0 and public RPC connectivity. From a clone with
this evidence directory present, create an isolated checkout of the exact
Mainnet source. These commands do not run a signing flow:

```sh
git fetch origin staging/mainnet
git worktree add --detach ../taply-mainnet-proof f88bc3fdd1d7b9cfabf95f73a3b48baf376968eb
pnpm --dir ../taply-mainnet-proof install --frozen-lockfile
pnpm --dir ../taply-mainnet-proof --filter @taply/shared build
pnpm --dir ../taply-mainnet-proof --filter @taply/near-client build
node docs/evidence/mainnet-live-settlement-2026-11-14/verify.mjs ../taply-mainnet-proof
```

The script prints its fresh result and asserts the observed settlement fields.
RPC pruning, rate limits or missing evidence can cause a nonzero exit. That is
not converted into success using the archived output.

Verifier source:
[mainnet-settlement-receipts.ts at f88bc3f](https://github.com/KendineCrypto/taply/blob/f88bc3fdd1d7b9cfabf95f73a3b48baf376968eb/packages/near-client/src/mainnet-settlement-receipts.ts).
The source tree was tested at `d984206`; [exact CI](../../RELEASE_STATUS.md#exact-ci-snapshot).
