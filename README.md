# taply. — NEAR Testnet Payments That Feel Human

> **Phase 3A — Testnet pilot preparation.** Native Instant Pay has unit/sandbox tests, payment screens and an independent receipt verifier. **No Taply Testnet payment or deployment has been observed.** Signing remains off. [Protocol Freeze v1](docs/LEAD_PROTOCOL_FREEZE_v1.md) supersedes conflicting older specifications.

## Run the developer demo

Use Node **24.22.2** (`.node-version`) and pnpm **11.5.0**. From a fresh clone:

```sh
git clone --branch feature/pilot-core https://github.com/KendineCrypto/taply.git
cd taply
pnpm install --frozen-lockfile
pnpm check
```

Copy `apps/web/.env.example` to `apps/web/.env.local`, leave the contract ID/hash
empty and `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=off`, then:

```sh
pnpm --filter @taply/web dev
```

Open `http://localhost:3000/demo` for **local simulation only**. It cannot produce
a real verified receipt. Public balance/RPC reads are separate infrastructure
checks. `pnpm check` builds the app, checks types/lint/brand and runs local tests;
it does not run Rust, deploy or move funds. For **sandbox contract evidence**, use
[contract validation](contracts/payments/VALIDATION.md) and its reproduction commands.

For the **real two-wallet pilot**, use the exact, approval-gated
[Phase 3A operator commands](contracts/payments/PILOT.md). That guide covers the
pinned WASM, account creation/funding, atomic deploy/init, environment variables,
mobile return, FINAL receipts, raw evidence and troubleshooting. Deployment,
signing enablement and payment require explicit human approval. A passing
simulation or sandbox run never establishes a real Testnet result.

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
- Eligible code window: **19 Oct–14 Nov 2026**, per official [HACKATHON.md](HACKATHON.md) Q-001. Submission opens **1 Nov 00:00 UTC**, closes **14 Nov 23:59 UTC**. Public repository and human-published X demo required; pushing, publication and submission require explicit approval.
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

## Phase 0 reproduction

Use Node **24.22.2** (`.node-version`) and pnpm **11.5.0** (`packageManager`).

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
```

This typechecks and builds `@taply/shared`, then runs local protocol unit tests.
It does not connect a wallet, contact NEAR RPC, deploy or move tokens. Exact
dependency versions/integrities are in `pnpm-lock.yaml`. See
[shared package guidance](packages/shared/README.md) and [fixture format](packages/shared/test-vectors/README.md).
Zod, jsonc-parser, canonicalize and @noble/hashes are the runtime libraries;
TypeScript and Node's test runner provide the build/check tooling. No template
application or pre-existing contract implementation is used.

The initial documentation/brand baseline is commit `db10264`; protocol Phase 0
is developed on `feature/core`. The lead will publish the reviewed submission
diff and choose a project license before release. Testnet-only projects are
eligible; mandatory partner integrations are not required. For a local-only
demo, organizers require a video, not screenshots alone (HACKATHON.md Q-012).
The organizer's mainnet **prize payout account** field is unrelated to Taply's
Testnet-only application; the human supplies it at submission time.

## Repo structure
```text
apps/web/                Claude — mobile-first web/PWA & consumer/merchant UX
apps/api/                Codex — session server, read models, notifications, auth
contracts/payments/      Codex — Rust near-sdk Testnet request & escrow contract
packages/near-client/    Codex — typed RPC/adapters, wallet-neutral on-chain reads
packages/shared/         Codex initial scaffold; Lead coordination thereafter
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
The lead explicitly authorized Codex's initial `packages/shared` and root workspace scaffold under Protocol Freeze v1. After integration, further shared changes require coordination. Each agent commits tested increments; the lead reviews merges. Run the checks that actually exist at each stage and add contract/API/E2E checks with their implementations. No agent invents deployment URLs, tx hashes or test outcomes.

## Current progress / judge truthfulness
- [x] Product definition, brand assets, agent instructions.
- [x] Phase 0 shared protocol schemas, exact canonical fixtures and local unit tests (not chain proof).
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
