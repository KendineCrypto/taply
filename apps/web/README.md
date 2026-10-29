# `apps/web` — Taply v0.4 frontend

Mobile-first NEAR **Testnet** wallet and merchant payment PWA. Owned by Claude
(`feature/frontend`). See `docs/LEAD_PROTOCOL_FREEZE_v1.md` for the authoritative
protocol; this app follows it and never invents a competing one.

## Status: Phase 0 (shell only)

**No payment works. No contract is deployed. Nothing here has been demonstrated
on NEAR Testnet.** `docs/EVIDENCE.md` remains the only place a verified claim may
be recorded, and this phase adds nothing to it.

| Area | State |
|---|---|
| App shell, routing, chrome, accessibility | built |
| Brand assets + PWA icons/manifest | built |
| EN/TR localisation | built |
| Payment status mapping + safety tests | built, unit-tested |
| Capability flags (all off) | built |
| Mock status matrix at `/demo` | built |
| Wallet connect / signing | **not started** |
| API reads, Instant Pay, Protected Pay, Handshake, checkout, receipts | **not started** |
| Service worker, CSP | **deliberately deferred** (see `src/lib/protocol/README.md`) |

## Commands

```bash
pnpm install        # run inside apps/web; this app is self-contained for now
pnpm dev            # dev server
pnpm build          # production build
pnpm check          # verify:brand + typecheck + lint + test
pnpm test           # vitest
pnpm verify:brand   # fails if brand assets or the master path drift
pnpm gen:icons      # re-rasterize PWA icons from the approved SVG
```

## Why this app has its own `package.json` and lockfile

Protocol Freeze v1 §2 gives Codex the one-time authorization to create the root
pnpm workspace and `packages/shared`, and explicitly allows Claude to scaffold
`apps/web` as a self-contained app meanwhile. So `apps/web/package.json`,
`apps/web/pnpm-lock.yaml` and `apps/web/pnpm-workspace.yaml` are **temporary**.
Remove the latter two at integration — the procedure is in
`src/lib/protocol/README.md`.

No root manifest, shared schema, backend or contract file is touched by this app.

## Architecture

```
src/app/            routes (App Router). One route per frozen path.
src/components/
  brand/            approved mark geometry; never redrawn
  shell/            AppShell, top bar, bottom nav, route scaffold
  status/           StatusBadge, VerifiedPaidRibbon, VerificationChip, MockBadge
  primitives/       Amount, AccountId, Card, DetailRow
  feedback/         ErrorState, FeatureDisabled
src/lib/
  protocol/         TEMPORARY local mirror of @taply/shared — the only place
                    protocol types are declared
  payments/         mapChainState — the only module that decides payment display
  format/           BigInt base-unit amounts; ns timestamps and clock anchoring
  i18n/             EN default + TR, typed dictionaries, no route prefix
  flags/            capability flags, all off until Testnet-verified
  mock/             fixtures + the guard that confines them to /demo
```

### The three load-bearing rules

1. **`mapChainState` is the only thing that decides how a payment looks.** It is
   pure, exhaustive over `ChainState × Role × Assurance`, and takes no boolean
   like `paid` or `verified`. `src/lib/payments/__tests__` asserts the whole
   cross-product, including that the verified-paid treatment is unreachable for
   anything except `FINAL_PAID` + `verified_final` from a non-mock source.

2. **Money is `bigint` base units, end to end.** `Number`, `parseInt`,
   `parseFloat` and `Math.round` are banned by eslint outside
   `src/lib/format/`, where the conversions are deliberate and tested.

3. **Mock data cannot escape `/demo`.** `observation.source === 'mock'` forces
   `verifiedRibbon` false and `money` away from `to_recipient`, and
   `lib/mock/guard.ts` refuses to render it on any other route.

## Routes

`/` `/pay` `/pay/[id]` `/send` `/receive` `/scan` `/request/new` `/receipt/[id]`
`/activity` `/checkout/[accountId]` `/s/[sessionId]` `/merchant`
`/merchant/setup` `/merchant/register` `/contacts` `/split` `/recurring`
`/settings` `/demo`

`/pay/[id]` is the canonical, role-aware intent view — one route so there is one
status code path. `/checkout/[accountId]` is a discovery entry point and never a
payable invoice (freeze §5).

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
only). No wallet, chain or networking library is installed yet. Frontend code in
this directory was written with Claude Code; see the root README for the
hackathon disclosure required by HACKATHON.md Q-005.
