# `apps/web` — Taply v0.4 frontend

Mobile-first NEAR **Testnet** wallet and merchant payment PWA. Owned by Claude
(`feature/frontend`). `docs/LEAD_PROTOCOL_FREEZE_v1.md` is the authoritative
protocol; `@taply/shared` is its executable form and this app consumes it rather
than restating it.

## Status: Phase 0.5 (shell + shared protocol integration)

**No payment works. No contract is deployed. Nothing here has been demonstrated
on NEAR Testnet.** `docs/EVIDENCE.md` remains the only place a verified claim may
be recorded, and this phase adds nothing to it.

| Area | State |
|---|---|
| App shell, 20 routes, chrome, accessibility | built |
| Brand assets + PWA icons/manifest | built |
| EN/TR localisation, all 56 shared error codes | built |
| `@taply/shared` integration (types, schemas, hashing) | built, tested against the frozen vectors |
| Payment status mapping + fail-closed rules | built, 105 unit/integration tests |
| Capability flags (all off) | built |
| Mock status matrix at `/demo` | built |
| Wallet connect / signing | **not started** |
| HTTP transport to `/api/v1` | **not started** |
| Instant Pay, Protected Pay, Handshake, checkout, receipts | **not started** |
| Service worker, CSP | **deliberately deferred** (reasons in `src/lib/protocol/README.md`) |

## Commands

Run from the repository root (this is a workspace member now):

```bash
pnpm install                              # see "Lockfile" below
pnpm --filter @taply/shared build         # REQUIRED before web typecheck/test/build
pnpm --filter @taply/web dev
pnpm --filter @taply/web check            # verify:brand + typecheck + lint + test
```

`@taply/shared` exposes only `dist/`, so it must be built before this app can
typecheck, test or build against it.

## Lockfile and workspace — action needed from Codex

`apps/web` is now a member of the root pnpm workspace and depends on
`@taply/shared` via `workspace:*`. The root `pnpm-lock.yaml` and
`pnpm-workspace.yaml` belong to Codex and were **left byte-identical** by this
phase, so the lockfile does not yet contain an `apps/web` importer.

Consequence: `pnpm install --frozen-lockfile` will fail until Codex regenerates
the lockfile. A plain `pnpm install` succeeds and produces the needed entries.
The required change is an added `apps/web:` importer plus its transitive
packages — about +3,387 / −146 lines, no change to any existing
`packages/shared` dependency version.

Two root-level problems were avoided rather than pushed onto Codex:

- **Native build script.** `eslint-config-next` pulls in
  `eslint-import-resolver-typescript` → `unrs-resolver`, which has a native
  postinstall. The workspace does not allow unapproved build scripts, and
  `ERR_PNPM_IGNORED_BUILDS` made *every* pnpm command fail until
  `pnpm-workspace.yaml` was edited. Resolved by composing
  `@next/eslint-plugin-next` with `typescript-eslint` directly — same rules, no
  native build, no root change.
- **Supply-chain minimum release age.** `@types/node@26.6.6` was too new for the
  workspace policy and pnpm wanted a `minimumReleaseAgeExclude` entry. Resolved
  by pinning `@types/node@24.19.2`, which matches the project's Node 24 anyway.

## Unresolved dependencies

- **Lockfile regeneration** (above) — Codex.
- **Root scripts** only run `--filter @taply/shared`. Adding `apps/web` to the
  root `build`/`typecheck`/`test`/`check` scripts is a root-manifest change, so
  it is Codex's or the lead's call.
- **`eslint-plugin-jsx-a11y` and `eslint-plugin-react` are not installed.** Both
  peer at `eslint@^9` only; the entire ESLint 9 line is end-of-life and the
  workspace sets `strictPeerDependencies: true`. The a11y *lint rules* are
  therefore absent for now — the a11y *behaviour* is still implemented and
  asserted. They return when the plugins support ESLint 10.
- **No transport contract exercised yet.** `PaymentIntentResponseSchema` is
  imported and tested, but no endpoint is called, so no real API response shape
  has been observed.

## Architecture

```
src/app/            routes (App Router). One route per frozen path.
src/components/
  brand/            approved mark geometry; never redrawn
  shell/            AppShell, top bar, bottom nav, route scaffold
  status/           StatusBadge, VerifiedPaidRibbon, VerificationChip, MockBadge
  primitives/       Amount, AccountId, Card, DetailRow
  feedback/         ErrorState (protocol codes), NoticeState (client-only), FeatureDisabled
src/lib/
  protocol/         the ONLY protocol import surface; re-exports @taply/shared
  payments/         mapChainState — the only module that decides payment display
  format/           BigInt base-unit amounts; ns timestamps and clock anchoring
  i18n/             EN default + TR, typed dictionaries, no route prefix
  flags/            capability flags, all off until Testnet-verified
  mock/             fixtures + the guard that confines them to /demo
```

### The four load-bearing rules

1. **One protocol definition.** `src/lib/protocol` re-exports `@taply/shared` and
   adds only clearly-labelled presentation helpers. No payment state, error code
   or hash function is declared anywhere else in `apps/web`.

2. **`mapChainState` is the only thing that decides how a payment looks.** Pure,
   exhaustive over `ChainState × CallerRole × Assurance`, takes no boolean like
   `paid` or `verified`. A financial control appears only when the observation is
   *actionable* — `verified_final`, not stale, RPC available, non-mock, no open
   incident — mirroring the shared schema's own `fresh` rule rather than trusting
   it.

3. **Money is `bigint` base units, end to end.** `Number`, `parseInt`,
   `parseFloat` and `Math.round` are banned by eslint outside `src/lib/format/`.
   `U128_MAX` and the cancel-duration bounds come from `@taply/shared`.

4. **Mock data cannot escape `/demo`, and cannot look verified.** A `mock` source
   forces `verifiedRibbon` false and `money` away from `to_recipient`, the shared
   schema pins its assurance to `unverified`, and `lib/mock/guard.ts` refuses to
   render it on any other route. In the live `/demo` page this means **no
   financial CTA renders at all** — which is correct, not a gap.

## Routes

`/` `/pay` `/pay/[id]` `/send` `/receive` `/scan` `/request/new` `/receipt/[id]`
`/activity` `/checkout/[accountId]` `/s/[sessionId]` `/merchant`
`/merchant/setup` `/merchant/register` `/contacts` `/split` `/recurring`
`/settings` `/demo`

`/pay/[id]` is the canonical, role-aware intent view — one route so there is one
status code path. `/checkout/[accountId]` is a discovery entry point and never a
payable invoice (freeze §5); the slug is the account id, as the shared
`MerchantProfileSchema` requires.

## Accessibility

Targets 360 / 390 / 430px, desktop-responsive. Skip link, single `<main>`,
labelled navigation, ≥44px targets, visible focus, no colour-only status, global
`prefers-reduced-motion` handling, and a keyboard/button equivalent for every
gesture control. Pinch-zoom is left enabled.

## Environment

Copy `.env.example`. All values are placeholders; `NEXT_PUBLIC_TAPLY_CONTRACT_ID`
stays empty until Codex deploys and reports a real one. Never put a secret in a
`NEXT_PUBLIC_*` variable — they are compiled into the client bundle.

## Third-party code

Next.js, React, Tailwind CSS, Zod, Vitest, sharp (build-time icon rasterization
only), plus the workspace package `@taply/shared`. No wallet, chain or networking
library is installed yet. Frontend code in this directory was written with Claude
Code; see the root README for the hackathon disclosure required by
HACKATHON.md Q-005.
