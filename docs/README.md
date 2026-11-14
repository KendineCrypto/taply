# Documentation map

## Product and release entry points

| Document | Use it for |
| --- | --- |
| [Judge quick start](JUDGE_QUICK_START.md) | Five-minute evaluation, real vs synthetic data and local setup |
| [Release status](RELEASE_STATUS.md) | Current source commits, networks, CI, deployment blocker and evidence scope |
| [System overview](SYSTEM_OVERVIEW.md) | Trust boundaries, settlement vocabulary and source-file map |
| [Demo route](DEMO_AND_JUDGING.md) | A two-minute product demonstration backed by evidence |
| [Mainnet live proof](evidence/mainnet-live-settlement-2026-11-14/README.md) | Public 0.1 NEAR input/output and read-only verifier replay |

## Detailed Testnet evidence

| Document | Scope |
| --- | --- |
| [Verification matrix](VERIFICATION_MATRIX.md) | Dated per-feature CI, real-chain and public-browser evidence |
| [Proof ledger](EVIDENCE.md) | Original observed accounts, transactions and verification records |
| [Release evidence index](RELEASE_EVIDENCE_INDEX.md) | Historical Testnet transaction index |
| [R-2 reachability](R2_REACHABILITY.md) | Callback uncertainty analysis and measured constraints |
| [Security review](SECURITY_REVIEW_2026-11-09.md) | Dated AI review, not an external audit |

## Protocol and design history

[Product](PRODUCT.md) · [State machine](PAYMENT_STATE_MACHINE.md) ·
[Security policy](SECURITY.md) · [API shapes](API.md) · [UX flows](UX_FLOWS.md) ·
[Test plan](TEST_PLAN.md) · [Original architecture](ARCHITECTURE.md) ·
[Milestones](MILESTONES.md)

These files retain original requirements, staged implementation notes and dates.
A planned route or feature in them is not proof it is live. The release map above
resolves current scope; the source and evidence links establish individual claims.

Mainnet protocol/runbook details live in the
[pinned Mainnet source tree](https://github.com/KendineCrypto/taply/tree/f88bc3fdd1d7b9cfabf95f73a3b48baf376968eb/docs).
This avoids presenting a Testnet branch as the implementation of Mainnet behavior.
