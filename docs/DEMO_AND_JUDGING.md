# Taply demo and evaluation route

[Judge quick start](JUDGE_QUICK_START.md) is the interactive entry point.
[Release status](RELEASE_STATUS.md) is the source of truth for network,
commit, deployment and evidence scope.

## A two-minute product demonstration

| Time | Show | Evidence behind the scene |
| --- | --- | --- |
| 0–15 s | A shop/freelancer creates an exact request in Taply | Immutable on-chain terms; amount and recipient review |
| 15–35 s | Second device scans and sees the same sale | QR navigation, live request read; Testnet Handshake is coordination only |
| 35–60 s | Payer reviews and confirms in the wallet | Explicit signature; submitted is distinguished from paid |
| 60–85 s | Both devices show the result and its receipt | Contract payout callback, then independent verifier |
| 85–105 s | Separate Protected Pay refund/release examples | Real Testnet evidence; locked and refunded never labelled paid |
| 105–120 s | Public Mainnet transaction, proof JSON and CI | Actual 0.1 NEAR settlement; exact source/test links |

Use actual captured footage and original network labels. The cinematic product
story is presentation; public chain evidence establishes the payment result.
Preview footage must identify the served build. The newest source is not yet
deployment evidence while Vercel reports `build-rate-limit`.

## What makes the implementation inspectable

- A request's exact terms and canonical hash bind the wallet review to the
  contract call. The recipient is not taken on trust from a QR caption.
- NEAR's async payout and callback are part of the payment state machine.
  A successful submission is not sufficient for a paid receipt.
- Either side can independently inspect the receipt graph. The Mainnet native
  example has public inputs, output and a read-only reproduction script.
- Failure tests accompany the happy path: missing evidence, wrong beneficiary,
  unknown outcome, duplicate operation and replay.
- Testnet runs, Mainnet observations, synthetic browser fixtures and local
  sandbox results are labelled separately in [release status](RELEASE_STATUS.md).

## Evaluation material

| Material | Link |
| --- | --- |
| Product entry and scope | [README](../README.md) |
| Five-minute hands-on route | [Judge quick start](JUDGE_QUICK_START.md) |
| Architecture and source map | [System overview](SYSTEM_OVERVIEW.md) |
| Real Mainnet proof | [0.1 NEAR settlement](evidence/mainnet-live-settlement-2026-11-14/README.md) |
| Real Testnet feature evidence | [Verification matrix](VERIFICATION_MATRIX.md) |
| Exact tested source and CI | [Release status](RELEASE_STATUS.md) |
| Security and limitations | [Security](SECURITY.md) · [R-2 reachability analysis](R2_REACHABILITY.md) |

AI assistance is disclosed in the README. Product claims are supported by
source, test output and public transactions; no ranking or safety guarantee is
implied by an AI review or a passing test suite.
