# Taply — Immediate Windows Execution Plan after protocol freeze

**Important:** `docs/LEAD_PROTOCOL_FREEZE_v1.md` is a lead reconciliation of both agent reports. It approves interface direction **only**, not security, handling production funds, or mainnet deployment.

**Hackathon eligibility timing:** The official nearhackathon.com page says to build the project **during the hackathon**, starting **1 Nov 2026 00:00 UTC (03:00 Türkiye time)**. On 29 Oct, do steps **A–C only (docs/Git)**. **Do not send the implementation prompts in D–E or start actual product coding until the official start**, unless organizers expressly clarify that earlier implementation is eligible. Documentation, research and environment checks are safer pre-window. This guide stages prompts for use once the window opens.

## A. Extract these two files into `C:\taply\docs\`

Do not replace the existing Taply v0.4 package; merge these two new documents. Verify:

```powershell
cd C:\taply
Test-Path .\docs\LEAD_PROTOCOL_FREEZE_v1.md
Test-Path .\docs\NEXT_STEPS.md
```

Both should return `True`.

## B. Commit shared decisions on main

```powershell
cd C:\taply
git add docs/LEAD_PROTOCOL_FREEZE_v1.md docs/NEXT_STEPS.md
git commit -m "docs: freeze Taply v0.4 payment protocol v1"
git status
```

If an agent independently made edits before the freeze, STOP and inspect `git status` in that agent's worktree before merging. Do not overwrite changes.

## C. Give the decision to both worktrees

```powershell
cd C:\taply-codex
git status --short
git merge main

cd C:\taply-claude
git status --short
git merge main
```

Both `git status --short` outputs should be empty before merging. If a merge reports a conflict, stop and send the output for review.

## D. Codex — First implementation task (Phase 0; send on/after 1 Nov 00:00 UTC)

Paste the following in the **existing** Codex session, from `C:\taply-codex`:

> The lead has now committed `docs/LEAD_PROTOCOL_FREEZE_v1.md` on main and merged it into your `feature/core` worktree. Read this document and `docs/NEXT_STEPS.md` before proceeding. You have one-time lead approval to create root pnpm workspace manifests/lockfile and `packages/shared/**` on feature/core, in addition to your existing backend/contract ownership. First implement ONLY Phase 0: minimal deterministic pnpm monorepo scaffold, version-pinned shared TypeScript/Zod schemas for Codex's proposed `taply.api.v1`/`taply.intent.v1`, exact Rust-compatible JSON/UTF-8/JCS/hash fixture vectors A and B, strict validation, and unit tests. Update `docs/API.md` to be consistent with the freeze. Do not deploy, handle funds, touch apps/web, or begin contract settlement code yet. Verify tool versions from installed commands; pin only compatible packages. Run tests, report exact real output, commit the phase-0 result on `feature/core`, and give me the commit hash for integration. If you find a critical contradiction, stop and describe it rather than silently changing the protocol.

## E. Claude — Parallel task (Phase 0 / safe UI scaffold; send on/after 1 Nov 00:00 UTC)

Paste the following in the **existing** Claude session, from `C:\taply-claude`:

> The lead has now committed `docs/LEAD_PROTOCOL_FREEZE_v1.md` on main and merged it into your `feature/frontend` worktree. Read the freeze and `docs/NEXT_STEPS.md` before proceeding. Start ONLY safe frontend Phase 0: scaffold `apps/web` as a self-contained Next.js/TypeScript mobile-first PWA without modifying root manifests, lockfile, shared schemas, backend or contracts. Use approved Taply brand assets exactly, default EN + TR localization setup, accessible navigation, and accurate mock-only presentation under `/demo`. Build a pure exhaustive payment status mapping test that cannot show Paid for LOCKED/unknown/in-flight/refunded, and disabled feature flags for unverified capabilities. No fake chain completion or simulated 'verified' badge outside `/demo`. Defer integration to @taply/shared until Codex's phase-0 package is merged. Verify dependencies, run typecheck/lint/tests, commit on `feature/frontend`, then report changed paths and test outcomes. If you cannot scaffold without conflicting root changes, stop and report a precise blocker instead of altering root files.

## F. After Codex returns the Phase 0 commit

Human/lead reviews `git show --stat feature/core` and tests before merging into main. If approved, `cd C:\taply; git merge feature/core`; then in `C:\taply-claude`, `git merge main`. Do not merge unreviewed contract fund-handling code into main. After the shared package is available, both can move toward the first real Testnet Instant Pay implementation with real test evidence.

**Do not tell agents to build everything in one task.** Use small commits with explicit test results. Human security review remains required before protected fund handling.
