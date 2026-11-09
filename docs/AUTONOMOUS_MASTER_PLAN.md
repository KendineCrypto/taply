# Autonomous master plan (cloud continuation, from 2026-11-09)

Working branch: `claude/kind-cerf-c4n261` (cut from `main` @ `22765d7`, which
equals `release/taplyapp`, the production source). Production
(https://taplyapp.xyz) is **not** touched by this branch: Vercel builds
production only from `release/taplyapp`.

Progress log: [AUTONOMOUS_PROGRESS.md](AUTONOMOUS_PROGRESS.md).
Feature state: [PRODUCT_COMPLETION_MATRIX.md](PRODUCT_COMPLETION_MATRIX.md).

## Ground rules (unchanged from CLAUDE.md / freeze v1)

- NEAR Testnet only. No mainnet, no personal wallet secrets, no keys in the repo or server.
- The deployed G1 contract (`contracts/payments`) stays frozen; `check-isolation.mjs` must keep passing.
- New money paths ship as **isolated, unreviewed candidates** behind flags that default OFF.
  A flag goes on only after review + real Testnet evidence in `docs/EVIDENCE.md`.
- Never show Paid for LOCKED, in-flight, unknown or refunded states.
- Every increment: tests run for real, committed and pushed, progress log updated.

## Coordination note

CLAUDE.md scopes Claude to `apps/web`. The owner (lead) asked this session to
continue the whole product vision. Changes outside `apps/web` are therefore
made **additively** (new crate, new near-client module, new workflow), never
by editing frozen G1 code or shared schemas, and each is listed in the
progress log as needing Codex/lead review before merge.

## Work queue (priority order)

| # | Item | Gate | State |
| --- | --- | --- | --- |
| 1 | Protected Pay contract candidate (`contracts/payments-protected`) with full unit tests and cross-language wire check | G3 | **Done (candidate)** |
| 2 | near-client Protected call builders (`packages/near-client/src/protected.ts`) | G3 | **Done (candidate)** |
| 3 | Web: Protected journal methods + reconciliation + consent/countdown/cancel/release/retry UI behind `protectedPay` flag (`/protected/[id]`) | G3 | **Done (flag off)** |
| 4 | Web: request creation with Protected mode + duration (flag-gated, `/protected/new`) | G3 | **Done (flag off)** |
| 5 | Sandbox (near-workspaces) run of the candidate: measured gas/storage, real refund + release on a local node | G3 | **Done (local node)**: 3/3, gas measured; Testnet proof is owner-only |
| 6 | NEP-141 design + candidate (`ft_on_transfer`, allowlist, exact amount, unused return, payout callback) | P2 | Change request written ([NEP141_CHANGE_REQUEST.md](NEP141_CHANGE_REQUEST.md)); code waits for lead approval of the shared asset schema |
| 7 | G1 acceptance support: anything the owner's signed run on the QA build needs | G1 | Owner-blocked (needs owner wallets) |
| 8 | Handshake/merchant G2: F-06 production auth, merchant candidate review | G2 | Blocked on review; not started here |
| 9 | Contacts/Split/Recurring polish, wallet improvements | P1 | Queued |
| 10 | Protected QA deployment: fresh Testnet account, candidate WASM, QA build env (`NEXT_PUBLIC_TAPLY_PROTECTED_*`) | G3 | Owner-only (needs a Testnet account the owner controls) |

## Owner-only steps (cannot be done by an agent)

1. Signed G1 acceptance on the protected QA build (`docs/TESTNET_ACCEPTANCE_PLAN.md`).
2. Human security review of the Protected Pay candidate (escrow custody).
3. Creating a fresh Testnet account for any candidate deployment and signing it.
4. Turning any flag on in Vercel production.
