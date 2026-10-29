# taply. — NEAR Testnet Payments That Feel Human

> **PRODUCT SPECIFICATION v0.4 (27 October 2026).** This repository kit is documentation, not a functioning blockchain deployment. Never mark planned capabilities as shipped.

**One sentence:** Taply is a NEAR Testnet wallet and merchant payment app with live **Handshake** sessions, **Instant Pay**, consent-based **Protected Pay**, and chain-verifiable receipts.

**Tagline:** Request. Swipe. Pay. / **Core idea:** Don't just send money. Know exactly how the payment will settle.

## What makes Taply different?
- **Handshake:** customer and merchant open the *same* short-lived live session, compare a short human-readable code, see the canonical payee/token/amount, and independently observe settlement. Live presence and a matching code **do not prove real-world merchant identity**.
- **Instant Pay:** signed payment with real on-chain settlement, no fake optimistic success screen.
- **Protected Pay:** a *mutually agreed* cancel window. Funds are held in a Testnet escrow contract; the merchant must display **LOCKED / NOT FINAL** until successful release. Reversal is allowed by contract rules, not by reversing finalized chain transactions.
- **Verified Receipts:** a receipt binds request/session ID, sender, payee, asset, amount, payout result, chain transaction and finality. "On-chain verified" does not mean KYC or fraud-free.
- **Invisible Wallet:** preferred low-friction sign-in, only if verified to provision/control a genuine **Testnet** signing account and support recovery. External Testnet wallet is the safe default fallback.

## Hackathon constraints
- All value transfers and contracts: **NEAR Testnet only**. No cross-chain, bridges, mainnet or real funds.
- Development window: **1–14 Nov 2026**, final 14 Nov 23:59 UTC. Public GitHub + X demo required (verify latest official rules: https://nearhackathon.com/).
- Primary fit: **Real-World Money**. Judge demo: two phones, merchant QR, link, wallet signature, honest on-chain status, actual release/cancel, verified receipts.
- No promise of prizes, security audit, mainnet suitability, production money movement, or 100% perfect custody.

## Read in this order
1. `docs/PRODUCT.md` (complete product and scope)
2. `docs/PAYMENT_STATE_MACHINE.md` (**critical**, state transitions, races and invariant rules)
3. `docs/SECURITY.md` (wallet & escrow safety)
4. `docs/ARCHITECTURE.md` (boundaries and settlement model)
5. `docs/API.md` (typed contracts and events)
6. `docs/UX_FLOWS.md` (screens and copy)
7. `docs/MILESTONES.md` (14-day slices and release gates)
8. `docs/TEST_PLAN.md` (acceptance/security/reproducibility)
9. `docs/DEMO_AND_JUDGING.md` (evaluation evidence and video)
10. `CLAUDE.md` or `AGENTS.md` (agent-specific instructions)

## Repo structure (target; generated source code not yet present)
```text
apps/web/                Claude — mobile-first web/PWA & consumer/merchant UX
apps/api/                Codex — session server, read models, notifications, auth
contracts/payments/      Codex — Rust near-sdk Testnet request & escrow contract
packages/near-client/    Codex — typed RPC/adapters, wallet-neutral on-chain reads
packages/shared/         LEAD — TypeScript schemas and canonical state enums
brand/                   Approved Taply logo assets and tokens, unchanged
scripts/                 Lead-approved test/deployment/demo automation
 docs/                   Specifications, verified evidence and decisions
```

## Parallel work on Windows (after committing this kit to `main`)
```powershell
git worktree add -b feature/frontend ..\taply-claude main
git worktree add -b feature/core ..\taply-codex main
# Terminal A: cd ..\taply-claude; claude
# Terminal B: cd ..\taply-codex; codex
```
Only the project lead edits `packages/shared`, workspace manifests/lockfiles, project-wide config and shared docs unless coordinated. Each agent commits tested increments. Review/merge *daily*; after merge run contract, API, TypeScript and E2E tests. No agent invents deployment URLs, tx hashes or test outcomes.

## Current progress / judge truthfulness
- [x] Product definition, brand assets, agent instructions.
- [ ] Actual Testnet contracts deployed (unknown until tested).
- [ ] Real two-wallet payment (not yet demonstrated).
- [ ] Verified receipt, protected escrow, Handshake end-to-end (not yet demonstrated).
- [ ] Social-login wallet and gas sponsorship (investigation only).

**Every checkbox requires actual reproducible evidence before checking.**

## Sources to confirm versions/integration details
- NEAR hackathon https://nearhackathon.com/
- NEP-141 token standard https://github.com/near/NEPs/blob/master/neps/nep-0141.md
- NEAR Auth https://auth.near.org/ — availability for Testnet **must be verified**, live Mainnet claims don't prove Testnet support.
- NEAR developer docs https://docs.near.org/
