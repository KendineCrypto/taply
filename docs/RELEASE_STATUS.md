# Release status and evidence map

Updated: **15 November 2026 UTC**; original domain launch was 14 November. This is a source/deployment/evidence map,
not external security approval. Historical reports below keep their original scope.

## Source and deployment identity

| Surface | Source | Observed status |
| --- | --- | --- |
| **Public Mainnet** | [`7c0eac8`](https://github.com/KendineCrypto/taply/commit/7c0eac8b9b27cf0b6938010de6c9ca321c447e94), deployment `CK8EfUJPnsS39FNeqivQeByXTigH` | **Ready, live at [taplyapp.xyz](https://taplyapp.xyz)**; real native receipt shows Verified Paid |
| Vercel domain target | Project taply-mainnet, Preview environment, branch staging/mainnet | New deployment Ready at 2026-11-15 00:09:33 UTC; custom domain is explicitly listed |
| Tested source | [`673a4dc`](https://github.com/KendineCrypto/taply/commit/673a4dc7aa896b9942822fc662ae7944f9df9551) | Three CI workflows passed; tree equals squash 7c0eac8: `cc72f5cfd6e9008f315ee52496b071d984103bed` |
| Default repository / Testnet source | main, application baseline 6a47a4c before documentation updates | Dated Testnet source/evidence remains; public domain now serves Mainnet |
| Original domain launch | fa4235f, deployment 6DgFjUsspqv8SnFHLVjb3Z37FxBY | Served initially on 14 November while newer builds were quota-blocked; superseded by 7c0eac8 |
| Earlier quota failure | api-deployments-free-per-day | Earlier attempts failed. The new Mainnet build subsequently succeeded; no claim that every team's/project's quota is now clear |

[Current live check and screenshot](evidence/mainnet-unlock-live-2026-11-15/README.md)
· [Original domain launch record](evidence/mainnet-domain-launch-2026-11-14/README.md).
The initial deployment of fa4235f and the later successful fix deployment are
distinct observations. No payment, signature or plan purchase was performed by
the agent during publication checks.

## From Testnet to Mainnet

| Stage | What was observed | Evidence |
| --- | --- | --- |
| Real Testnet wallet/payment flows | Onboarding, signatures, native/token payment and live checkout | [Production regression](evidence/production-regression-2026-11-11/) · [full matrix](VERIFICATION_MATRIX.md) |
| Real Testnet Protected Pay | Refund and release, plus refused adversarial calls | [Browser result](evidence/production-protected-pay-2026-11-11/result.json) · [adversarial result](evidence/protected-adversarial-2026-11-11/result.json) |
| Mainnet implementation | Separate network config, pinned contract, wallet/reconciliation and verifier | [Pinned source](https://github.com/KendineCrypto/taply/tree/f88bc3fdd1d7b9cfabf95f73a3b48baf376968eb) |
| Real Mainnet settlement | A user-created request paid 0.1 native NEAR; independent verifier returned PAID for the exact beneficiary | [Public proof, inputs and replay](evidence/mainnet-live-settlement-2026-11-14/README.md) |
| Mainnet Gift | Owner reports successful funding/claim | User acceptance report; no independently archived Gift hash/proof in this snapshot |
| Mainnet UI/recovery follow-up | Both-device native receipt verification, QR-to-receipt, compact Gift/result UI, retained-hash FINAL recovery | [PR #37](https://github.com/KendineCrypto/taply/pull/37) · [PR #38](https://github.com/KendineCrypto/taply/pull/38); included in the current 7c0eac8 build |

## Exact CI snapshot

All links refer to tested head `673a4dc`, not an unspecified “latest” run.

| Workflow | Result | What it establishes |
| --- | --- | --- |
| [workspace-check · 43656108715](https://github.com/KendineCrypto/taply/actions/runs/43656108715) | PASS | Frozen install; brand, types, lint; shared 93, near-client 350, web 1,603 passed / 7 skipped, API 85; Testnet/Mainnet builds and leak guard; browser suites |
| [wallet-browser-check · 43656108784](https://github.com/KendineCrypto/taply/actions/runs/43656108784) | PASS | Offline browser crypto/SDK desktop and mobile-emulation matrix |
| [mainnet-core-candidate · 43656108705](https://github.com/KendineCrypto/taply/actions/runs/43656108705) | PASS | Rust format/unit/Clippy, WASM candidate, real local NEAR sandbox, wire integration and planner checks |

Workspace browser subchecks include the gate-open release path (12 checks),
Phase 4 (68/68), Phase 5 (31/31), authority integration (6/6), Phase 6 (18/18).
The workflow steps also show Phase 2–3 and the other product/browser checks.
Synthetic RPC fixtures, real Redis and local sandbox execution are labelled as
such. They are not real Mainnet spending evidence.

## What the current receipt/recovery code does

- The creator follows finalized contract state and replaces the QR with a receipt.
- For first-attempt native NEAR payments, either device can locate funding and
  independently verify exact settlement before showing Verified Paid.
- A new review reconciles a retained pending hash. Only matching FINAL execution
  can retire it; the panel also checks periodically without signing/resending.
- Gift can clear a stale unknown-outcome warning after that proof. Missing hashes
  and unavailable/mismatched proof remain blocked; operation replay stays refused.
- Mainnet receipts and review screens fold technical details instead of changing
  transaction builders. Testnet presentation defaults are preserved.

## Wallet reload fix

The current source also restores a valid Mainnet unlock session across same-tab
reload without extending its original five-minute expiry. Explicit lock revokes
the tab row before asynchronous deletion; new tabs stay locked. The wallet key
remains nonextractable, and passwords/recovery words are not session-stored.
Real Chromium reload/lock tests passed; browser-restored or duplicated tabs can
retain browser sessionStorage. [PR #41](https://github.com/KendineCrypto/taply/pull/41).

## Remaining boundaries

No external audit; configured-RPC trust rather than a light client; device-local
ledger scope; owner-controlled contract upgrade keys where retained; callback
uncertainty is not silently resolved. A native payout proof says nothing about
other assets, Gift claims, Protected Pay on Mainnet or cross-chain delivery.

This document supersedes earlier deployment-status summaries. It does not erase
their evidence or turn an old roadmap into shipped behavior.
