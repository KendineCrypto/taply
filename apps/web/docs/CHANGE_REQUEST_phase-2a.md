# Change request for Codex / lead — Phase 2A (frontend)

Raised by: Claude (`feature/frontend`). Status: **open, needs Codex/lead action**.

## 1. Lockfile importer update (root `pnpm-lock.yaml`)

`apps/web/package.json` now declares two dependencies:

| Dependency | Version | Why |
| --- | --- | --- |
| `@hot-labs/near-connect` | `0.12.0` (exact) | External NEAR Testnet wallet connection. The current docs.near.org wallet-login tutorial recommends it (checked 2026-10-29). Zero runtime dependencies; wallets run in sandboxed iframes. Published 2026-10-26, which passes the workspace's 1440-minute `minimumReleaseAge`. |
| `@taply/near-client` | `workspace:*` | Read-only Testnet account/balance reads in the browser. |

Claude did **not** commit `pnpm-lock.yaml`. The exact diff `pnpm install`
produced is in [`lockfile-change-request.patch`](./lockfile-change-request.patch):
+11 lines, **no new transitive packages**, no change to any existing version.

Until it is applied, `pnpm install --frozen-lockfile` fails on a fresh checkout.
To apply from the repo root:

```sh
git apply apps/web/docs/lockfile-change-request.patch
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
```

Note: the package's `.d.ts` files import types from `@near-js/types` and
`@near-js/transactions`, which it lists only as devDependencies. With
`skipLibCheck` those resolve to `any`; `apps/web` does not rely on them.

## 2. Next dependency (not yet installed): QR code encoder

Receive and Request need a scannable QR code. Nothing is installed yet, and no
QR code is faked. Proposal: add a small, zero-dependency QR encoder to
`apps/web` only, after the lead approves the package choice.

## 3. Not requested from shared packages

No change to `packages/shared`, `packages/near-client`, root manifests or
`pnpm-workspace.yaml` is needed for this phase.

## 4. Observations for Codex (`@taply/near-client`)

- Works in the browser against `https://rpc.testnet.near.org` (CORS `*`):
  `checkNetwork()` returned Testnet, final block #275,323,682, nearcore
  2.14.0-rc.5, from the production build in Chrome on 2026-10-29.
- A read against the public RPC took several seconds (one call ~9 s from Node).
  The UI shows a loading state and never retries automatically. A faster
  configured provider (e.g. FastNEAR, which also allows CORS `*`) could be set
  via `NEXT_PUBLIC_TAPLY_RPC_URL` if the lead approves it.
