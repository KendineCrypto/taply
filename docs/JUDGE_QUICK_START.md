# Judge quick start — final review branch

No wallet, seed phrase or funds needed. **G1 is a conditional Testnet release
candidate; physical iPhone acceptance remains open; normal G1/G2 contract CI passed.
Real G2 Handshake is NO-GO.** This guide does not authorize signing.

## Start locally

Use Node **24.22.2** and pnpm **11.5.0**. Installation needs package access;
the production build may need Google Fonts access. Tests use offline fixtures
except the explicitly skipped opt-in live test.

```powershell
git clone https://github.com/KendineCrypto/taply.git
cd taply
git checkout feature/final-integration-review   # final reviewed branch (Draft PR to main); not a release tag
git rev-parse HEAD                               # record the exact commit you judged
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @taply/web dev
```

`feature/final-integration-review` contains the implementation, the release
docs, the [final safety review](FINAL_INTEGRATION_REVIEW.md), the F-01
wallet-retry fix (`9db43fb`, `24cf04a`) and the final-build screenshots. It is
a review branch, not a release tag or signing approval, and it is not merged
into `main`. If it later moves, judge the exact commit recorded in the
submission. The older published baseline `7443c01` (PR #10) does not contain
the safety review or the F-01 fix.

Open [localhost demo](http://localhost:3000/demo). Walk through review, processing
and receipt; every scene is **DEMO / synthetic**, not a new chain payment.
No environment file or wallet connection is needed. Open Details for secondary
explanations. The optional `/demo/handshake` is a synthetic preview only.

## Inspect the recorded real payment

Open the [proof ledger](EVIDENCE.md) and
[archived verifier JSON](evidence/instant-pay-2026-11-01-receipt.json).
These record a real **0.1 Testnet NEAR** pilot payment to `taplytest.testnet`,
not fresh verification from this release-preparation run.

For optional current read-only inspection, stop the server and create
`apps/web/.env.local` containing only:

```dotenv
NEXT_PUBLIC_TAPLY_NETWORK=near-testnet
NEXT_PUBLIC_TAPLY_CONTRACT_ID=taply-pay-pilot-1.testnet
NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH=BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B
NEXT_PUBLIC_TAPLY_RPC_URL=https://archival-rpc.testnet.near.org
NEXT_PUBLIC_TAPLY_RPC_PROVIDER_ID=near-archival-testnet
NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=off
NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE=off
NEXT_PUBLIC_TAPLY_FLAG_MERCHANT=off
NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY=off
```

Restart `pnpm --filter @taply/web dev`. Do not inherit signing overrides from
another shell or env file. Production builds must be rebuilt after env changes.

- [Read the pilot sale](http://localhost:3000/pay/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502):
  expect 0.1 NEAR, recipient `taplytest.testnet`, code `KED 5E9` and
  **Paid per contract** if finalized reads succeed.
- [Check the recorded funding proof](http://localhost:3000/receipt/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502?ftx=CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su):
  **Verified Paid** requires successful funding, recipient transfer and callback
  verification plus hash/key/finality checks. It is not guaranteed by opening a URL.
- On missing history, throttling, timeout or offline status, keep the uncertain
  result. Retry reads later; never pay again to make a demo succeed. Use the
  archived proof with its original date if RPC is unavailable.

## Evidence and limits

[Final-build screenshots](../apps/web/docs/screenshots/final/) (on the final
branch) show the offline production UI after the final polish, EN/TR at 390 px
plus desktop; reproduce with `apps/web/scripts/final-shots.mjs`. Every payment
state in them is DEMO/synthetic, not blockchain evidence. Older
[Phase 7I screenshots](../apps/web/docs/screenshots/phase7i/) predate that polish. [Phase 7H screenshots](../apps/web/docs/screenshots/phase7h/)
include historical pilot reads and labelled injected failures.

[Release readiness](RELEASE_READINESS.md) records current tests, CI evidence and
review steps. No public hosted demo, final tag, license or submitted entry is
claimed. Browser emulation does not replace physical iPhone acceptance.
