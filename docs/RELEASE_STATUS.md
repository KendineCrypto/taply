# Release status and evidence map

Snapshot: **14 November 2026 UTC**. This is a source/deployment/evidence map,
not external security approval. Historical reports below keep their original scope.

## Source and deployment identity

| Surface | Source | Observed status |
| --- | --- | --- |
| Default repository / Testnet | `main`, application baseline `6a47a4c1db09d1dce23041d758a41e55147ffd5c` before this documentation update | Testnet app at [taplyapp.xyz](https://taplyapp.xyz); archived real-browser runs are linked below |
| Mainnet source | [`staging/mainnet` at `f88bc3f`](https://github.com/KendineCrypto/taply/tree/f88bc3fdd1d7b9cfabf95f73a3b48baf376968eb) | Receipt/recovery fixes merged through [PR #38](https://github.com/KendineCrypto/taply/pull/38) |
| Tested Mainnet head | [`d984206`](https://github.com/KendineCrypto/taply/commit/d984206ed5ae46e81b18227c52bdf96a1375be49) | All three workflows below passed. Its source tree equals squash `f88bc3f`: `255986cdfad11e1a5dc206e0949de4f0e46ee683` |
| Mainnet Preview | [Preview /m](https://taply-mainnet-git-staging-mainnet-kendinecryptos-projects.vercel.app/m) | Older UI can still be served. Vercel statuses for `f88bc3f` failed with `build-rate-limit`; no live deployment of these fixes is established |
| Mainnet at taplyapp.xyz | Not switched | DNS/Production migration was not performed |

Source history and successful CI do not identify the bytes currently served by a
host. A new Preview deployment must identify the intended source commit and reach
Ready before its new UI can be claimed live.

## From Testnet to Mainnet

| Stage | What was observed | Evidence |
| --- | --- | --- |
| Real Testnet wallet/payment flows | Onboarding, signatures, native/token payment and live checkout | [Production regression](evidence/production-regression-2026-11-11/) · [full matrix](VERIFICATION_MATRIX.md) |
| Real Testnet Protected Pay | Refund and release, plus refused adversarial calls | [Browser result](evidence/production-protected-pay-2026-11-11/result.json) · [adversarial result](evidence/protected-adversarial-2026-11-11/result.json) |
| Mainnet implementation | Separate network config, pinned contract, wallet/reconciliation and verifier | [Pinned source](https://github.com/KendineCrypto/taply/tree/f88bc3fdd1d7b9cfabf95f73a3b48baf376968eb) |
| Real Mainnet settlement | A user-created request paid 0.1 native NEAR; independent verifier returned PAID for the exact beneficiary | [Public proof, inputs and replay](evidence/mainnet-live-settlement-2026-11-14/README.md) |
| Mainnet Gift | Owner reports successful funding/claim | User acceptance report; no independently archived Gift hash/proof in this snapshot |
| Mainnet UI/recovery follow-up | Both-device native receipt verification, QR-to-receipt, compact Gift/result UI, retained-hash FINAL recovery | [PR #37](https://github.com/KendineCrypto/taply/pull/37) · [PR #38](https://github.com/KendineCrypto/taply/pull/38); deployment pending |

## Exact CI snapshot

All links refer to tested head `d984206`, not an unspecified “latest” run.

| Workflow | Result | What it establishes |
| --- | --- | --- |
| [workspace-check · 43650817911](https://github.com/KendineCrypto/taply/actions/runs/43650817911) | PASS | Frozen install; brand, types, lint; shared 93, near-client 347, web 1,598 passed / 7 skipped, API 85; Testnet/Mainnet builds and leak guard; browser suites |
| [wallet-browser-check · 43650817835](https://github.com/KendineCrypto/taply/actions/runs/43650817835) | PASS | Offline browser crypto/SDK desktop and mobile-emulation matrix |
| [mainnet-core-candidate · 43650817864](https://github.com/KendineCrypto/taply/actions/runs/43650817864) | PASS | Rust format/unit/Clippy, WASM candidate, real local NEAR sandbox, wire integration and planner checks |

Workspace browser subchecks include the gate-open release path (10 checks),
Phase 4 (68/68), Phase 5 (31/31), authority integration (6/6), Phase 6 (18/18).
The workflow steps also show Phase 2–3 and the other product/browser checks.
Synthetic RPC fixtures, real Redis and local sandbox execution are labelled as
such. They are not real Mainnet spending evidence.

## What the new receipt/recovery code does

- The creator follows finalized contract state and replaces the QR with a receipt.
- For first-attempt native NEAR payments, either device can locate funding and
  independently verify exact settlement before showing Verified Paid.
- A new review reconciles a retained pending hash. Only matching FINAL execution
  can retire it; the panel also checks periodically without signing/resending.
- Gift can clear a stale unknown-outcome warning after that proof. Missing hashes
  and unavailable/mismatched proof remain blocked; operation replay stays refused.
- Mainnet receipts and review screens fold technical details instead of changing
  transaction builders. Testnet presentation defaults are preserved.

## Remaining boundaries

No external audit; configured-RPC trust rather than a light client; device-local
ledger scope; owner-controlled contract upgrade keys where retained; callback
uncertainty is not silently resolved. A native payout proof says nothing about
other assets, Gift claims, Protected Pay on Mainnet or cross-chain delivery.

This document supersedes earlier deployment-status summaries. It does not erase
their evidence or turn an old roadmap into shipped behavior.
