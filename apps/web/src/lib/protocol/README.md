# `src/lib/protocol` — TEMPORARY local mirror of `@taply/shared`

**This is the single isolated adapter permitted by Protocol Freeze v1 §2.**

> "Until then, Claude may scaffold `apps/web` as a *self-contained app* without
> editing root files; shared types must remain in one clearly isolated temporary
> adapter for later replacement."

Everything here is hand-typed from `docs/LEAD_PROTOCOL_FREEZE_v1.md` (commit
`f985412`). Codex owns the authoritative schemas in `packages/shared`.

## Replacement procedure (at integration)

1. Codex's Phase 0 commit lands on `main`; `main` merges into `feature/frontend`.
2. Re-point every export in `index.ts` at `@taply/shared`.
3. Delete the local type/enum files; keep only re-exports until imports are migrated.
4. Delete `apps/web/pnpm-workspace.yaml` + `apps/web/pnpm-lock.yaml` so `apps/web`
   joins the Codex-owned root workspace.
5. Run `pnpm check`. Any drift between this mirror and `@taply/shared` surfaces
   as a type error — that is the intended failure mode.

**No file outside this directory may declare a protocol type.** Import from
`@/lib/protocol` only.

## Known assumptions (NOT yet confirmed by Codex)

These are gaps in the freeze that I had to type to compile. Each must be checked
against `packages/shared` and corrected, not kept:

| Assumption | Why it was needed | Risk if wrong |
|---|---|---|
| `ChainObservation.source` = `'chain' \| 'index' \| 'mock'` | Freeze §3 lists the field but not its values; taken from the older `docs/API.md` `Verification.source` | Mock detection (`DemoBoundary`) keys off `'mock'` |
| `observedBlock` is nullable | An unverified/`rpcAvailable:false` read cannot cite a block | Non-null assumption would crash offline views |
| `IntentTerms` field set | Freeze §7 defers the exact object to "Codex's second protocol proposal", which this worktree does not contain | `termsHash` cannot be independently derived until supplied |
| `DerivedProjection` shape | Freeze §3 names the fields (`cancelWindowOpen`, `releaseEligible`, authenticated `retry` eligibility, caller role) but not their types | CTA gating would need rework |
| `ApiError.retryAction` values | Only `WAIT_AND_RECONCILE` is named in §8 | Error mapping falls back to a safe no-retry default |

## Deferred with reasons

- **Service worker / offline caching.** Freeze §8 permits caching the static
  shell and assets only, with `no-store` on every payment read. A SW shipped
  before real payment reads exist is the exact mechanism that could serve a
  stale "Paid" screen. Deferred until there is a read layer to test it against.
- **Content-Security-Policy.** Needs a nonce-based setup against Next's inline
  bootstrap; done wrong it silently disables the app. Deferred to the phase that
  adds the wallet adapter, where it is actually load-bearing.
- **`termsHash` / `sessionCommitment` derivation.** Must consume Codex's
  `packages/shared/test-vectors` fixtures A and B verbatim (freeze §7). Deriving
  it independently here would be "reverse engineering a different algorithm",
  which §7 forbids.
