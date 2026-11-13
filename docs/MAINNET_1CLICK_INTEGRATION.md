# Mainnet frontend + 1Click integration (candidate, NO-GO for funds)

2026-11-13, Claude Code. Integration branch `claude/mainnet-1click-integration`
(local worktree) based on Codex's verified commit
`bf5d712a9680a6ba5f77a23a5efc168e815bbf6a` (`codex/mainnet-core`, which
contains the infrastructure work `6776cdd`). Pushed to the session branch
`claude/festive-brahmagupta-qkqex1` as a fast-forward.

**Status: NO-GO for mainnet funds.** No deployment, no signing, no funded
1Click quote, no deposit address shown, no Vercel/DNS change, no account or key
action, no merge. Codex's contract, shared schemas, network profile and
transaction builders are used as published, not reimplemented.

## 1. What a mainnet build does now

Build-time selection only: `NEXT_PUBLIC_TAPLY_NETWORK=near-mainnet`.

| Area | Implementation |
| --- | --- |
| Build profile | `apps/web/src/lib/mainnet/config.ts` — explicit mainnet RPC (`MAINNET_RPC_URLS`), explorer `https://nearblocks.io`, contract only `taply-pay.kendinecrypto.near` / `devkendinecrypto.near` with a code hash accepted by `MainnetProfileSchema`. No Testnet default can apply. |
| Route isolation | `apps/web/src/lib/mainnet/build.ts` + `src/proxy.ts`. Testnet build: `/m/*` and `/api/mainnet/*` are rewritten to an unmatched path, so Next serves the same 404 page as before; every other path passes untouched. Mainnet build: only `/m/*` and `/api/mainnet/*` are served; every Testnet page redirects (307) to `/m`, Testnet APIs are 404. |
| Layout | `next.config.ts` aliases `@taply-root/{root,loading,error,not-found}` to `src/app/_roots/testnet/*` (the previous files, unchanged) or `src/app/_roots/mainnet/*`. Only one set is in the module graph: a mainnet bundle has no Testnet provider (wallet adapter, mnemonic vault, payments, Testnet dictionaries). `_roots/contract.ts` makes tsc fail if the two sets' signatures drift. Mainnet builds are Turbopack only (`build:mainnet` uses `--turbopack`); a Webpack mainnet build throws, because its mainnet root context was observed to split at runtime. |
| Labels | `MainnetShell`: "NEAR Mainnet" pill and a banner on every screen: real funds, unaudited candidate, capped at 1 NEAR / 25 USDC, NO-GO notice. Fixture builds add a "FIXTURE DATA — not on chain" banner. English and Turkish (`lib/i18n/dictionaries/mainnet-{en,tr}.ts`, key parity tested). |
| Wallet | `lib/mainnet/wallet-config.ts`, `wallet.tsx`: near-connect 0.12.0 `network:'mainnet'`, `providers.mainnet` only, `features.mainnet`, `signInWithoutAddKey`, `autoConnect:false`. Connect/restore/disconnect only — no signing function exists in this build. `.testnet` accounts are refused. |
| Merchant | `/m/request/new` (`CreateRequest.tsx`): NEAR or USDC, exact decimals, per-asset cap, memo ≤ 256 bytes, receiving account = connected account (fixed), per-sale storage bond from `quote_create_request` (fixture value labelled), USDC registration check via `readUsdcStorage` with the `storage_deposit` candidate. Review shows the exact unsigned `create_request` from `prepareMainnetCreateRequest`. Sign button disabled. |
| Customer | `/m/pay/[id]` (`PayRequest.tsx`): request read at a final block through `createMainnetReader`; merchant account, exact amount, expiry, contract and id come from chain. USDC: "Pay from Base (USDC)" or "Pay with NEAR wallet" (shows `prepareMainnetPayment`'s `ft_transfer_call` with the shared message). NEAR: wallet only. |
| Base USDC checkout | `IntentsCheckout`: Base USDC (only source), refund address with EIP-55 validation, server quote, review (you send on Base, merchant receives exactly, delivered to the contract, deadline countdown, estimate, refund address), signature-verified line, **deposit address withheld**, "origin leg reported by 1Click, not verified by Taply". |
| Status | `lib/mainnet/status.ts` + `PaymentStatusPanel`: Awaiting payment, Deposit observed, Processing, Payment recorded, Independently verified, Failed, Refunded, Unknown — needs investigation. See §3. |
| Explorer | `lib/mainnet/explorer.ts`: nearblocks.io / basescan.org links built from validated hashes only; 1Click's own explorer URLs are never rendered. |

With no contract pinned (today) a mainnet build reads nothing and says so.
With `NEXT_PUBLIC_TAPLY_MAINNET_FIXTURES=on` (Preview only) the screens run
on fixture data.

## 2. 1Click server integration

Server-only, `apps/web/src/server/mainnet/oneclick/`, routes
`POST /api/mainnet/oneclick/quote` and `GET /api/mainnet/oneclick/status?requestId=`
(404 on Testnet builds). Official SDK `@defuse-protocol/one-click-sdk-typescript`
**0.1.26** (exact pin) for `verifyQuoteSignature`, `quoteHash` and types; HTTP
goes through a bounded client to the documented API base
`https://1click.chaindefuser.com`.

### Modes (`TAPLY_ONECLICK_MODE`, server only)

| Mode | Chain | 1Click | Deposit address to browser |
| --- | --- | --- | --- |
| `off` (default) | — | — | — |
| `fixture` | fixture requests | synthetic responses signed by an ephemeral key, verified through the SDK path | never |
| `dry` | real reader (needs a pinned contract) | real **dry** quotes (no deposit address exists) | never |
| `funded` | — | refused: `ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED = false` in code | never |

Fixture mode is refused on Vercel Production in code (`runtime.ts`) and by
`scripts/check-mainnet-env.mjs`; `funded` and `NEXT_PUBLIC_TAPLY_MAINNET_SIGNING=on`
fail every mainnet build.

### Quote checks, in order

1. Mode gate, pinned contract, quote store present.
2. Input: 64-hex request id; origin asset on the explicit allowlist (Base USDC
   `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near` only);
   refund address `0x…40 hex`, EIP-55 when mixed case, not the zero address or
   the token contract.
3. Per-request lock (Redis `SET NX PX`, compare-and-delete release).
4. `get_config` at a final block passes `MainnetContractConfigSchema`
   (genesis + pinned code hash checked by `createMainnetReader`).
5. Request at a final block: exists, `OPEN`, `instant`, asset = mainnet USDC,
   permitted payer null or `intents.near`, principal ≥ 0.50 USDC, request expiry
   leaves ≥ 10 min after the 5 min margin.
6. Contract and merchant both registered on USDC (`storage_balance_of`).
7. One live quote per request: identical inputs reuse it, different inputs →
   `ACTIVE_QUOTE_EXISTS`; an expired funded quote whose status is not
   `PENDING_DEPOSIT`/`REFUNDED`/`FAILED` → `PREVIOUS_QUOTE_IN_PROGRESS`; at most
   3 quotes per request per 24 h.
8. dry/funded: the asset is still listed by `/v0/tokens` with the same chain,
   symbol, decimals and contract address.
9. Body: `EXACT_OUTPUT`, `slippageTolerance:100`, `depositType/refundType
   ORIGIN_CHAIN`, `destinationAsset nep141:<mainnet USDC>`, `amount` = principal,
   `recipient` = pinned contract, `recipientType DESTINATION_CHAIN`, deadline
   ≤ request expiry − 5 min, `customRecipientMsg = buildInstantRecipientMessage(id, termsHash)`.
10. Response accepted only if: shape valid; **SDK `verifyQuoteSignature` passes
    under the 1Click manager key** `ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc`;
    every sent field echoed unchanged; `amountOut` = principal and
    `minAmountOut` ≥ principal; timestamp within 120 s; deadline in the future
    and before expiry − margin; dry ⇒ no deposit address, funded ⇒ deposit
    address ≠ refund address.
11. The signed response is stored (evidence) with the request id; the browser
    gets amounts, deadline, refund address and `deposit: null`.

API key: optional `TAPLY_ONECLICK_API_KEY`, sent only as `Authorization: Bearer`
(the SDK's own scheme), never `NEXT_PUBLIC_`. Upstream error text is never
forwarded; it maps to `UPSTREAM_MIN_AMOUNT | NO_LIQUIDITY | UNAUTHORIZED |
RATE_LIMITED | BAD_REQUEST | UNAVAILABLE`. All responses `Cache-Control: no-store`;
cross-site POSTs are refused.

Status: looked up by request id only (the browser cannot aim the proxy at an
arbitrary deposit address); the 1Click answer must echo the stored deposit
address and correlation id; tx links are rebuilt by Taply. A dry quote has no
deposit address, so no status exists for it.

## 3. Payment states (never paid from 1Click or a wallet response)

| Shown | When |
| --- | --- |
| Awaiting payment | contract `OPEN`, no hint or `PENDING_DEPOSIT` |
| Deposit observed | `OPEN` + `KNOWN_DEPOSIT_TX` |
| Processing | `OPEN` + `PROCESSING`; `OPEN` + `SUCCESS` for ≤ 15 min; `PAYOUT_IN_FLIGHT` ≤ 10 min |
| Payment recorded | final-block `FINAL_PAID` only, with "contract state only" note |
| Independently verified | **unreachable**: `MAINNET_INDEPENDENT_VERIFIER_AVAILABLE = false` |
| Failed | `FAILED`, `INCOMPLETE_DEPOSIT`, `PAYOUT_FAILED_RECOVERABLE` (merchant-only retry), `CANCELLED_UNFUNDED` |
| Refunded | `OPEN` + `REFUNDED` |
| Unknown — needs investigation | contract unreadable or request missing; `PAYOUT_IN_FLIGHT` > 10 min (R-2: no retry, no override); `SUCCESS` > 15 min with contract still `OPEN` (delivery may be unclaimed); delivery after cancellation |

Once money may be moving the screen says "Do not pay again". Nothing retries,
re-quotes or re-pays automatically.

## 4. Fixtures (clearly identified)

- `apps/web/src/lib/mainnet/fixtures.ts` — **FIXTURE DATA, NOT ON CHAIN**: 13
  schema-valid `MainnetRequest`s built with Codex's `calculateMainnetRequestId` /
  `calculateMainnetTermsHash` on the staging contract id, fake merchant
  `taply-fixture-merchant.near`, nonces = ASCII scenario name in hex. Storage bond
  0.00585 NEAR is Codex's sandbox observation, labelled as such.
- `apps/web/src/server/mainnet/oneclick/fixture-client.ts` — **SYNTHETIC**
  1Click responses: SDK 0.1.26 `QuoteResponse` shape, amounts from the dry quote
  recorded in the brief (1.010309 in per 1.000000 out, 35 s), signed by an
  ephemeral per-process key over the SDK's `quoteHash`. They can never pass
  production verification (tested).
- `FIXTURE_CODE_HASH` is a placeholder used only to build fixture call previews;
  it is not the CI candidate hash and not a deployment.

No response recorded from the live 1Click API is included: the sandbox egress
proxy refuses `1click.chaindefuser.com` and the mainnet RPCs.

## 5. Verification

See §8 of this file for the exact commands and results of this increment.

## 6. Remaining security blockers (before any funds)

1. **No deployed contract.** No approved code hash; the CI candidate hash
   `AXaqzk…` is not deployment evidence and is not pinned anywhere.
2. **`intentsRouter:false`** is a literal in Codex's `MainnetContractConfigSchema`
   and the contract's release gate. Real (non-fixture) builds keep "Pay from
   Base" disabled with that reason. Enabling it needs a reviewed contract/schema
   change plus live USDC + 1Click evidence (MAINNET_CI_HANDOFF "Router gas").
3. **Upstream execution envelope**: receiver gas and message size under live
   1Click/USDC are unmeasured; a failed receiver returns funds to Intents, not
   to the customer.
4. **Signature verification against a real 1Click response** is not yet
   demonstrated (only the SDK path with synthetic keys). A recorded dry quote
   from the live API must be added as a fixture and verified with the real key.
5. **`minAmountOut ≥ principal` assumption** for `EXACT_OUTPUT` must be
   confirmed on a real dry quote; if 1Click reports a lower `minAmountOut`,
   Taply refuses the quote (safe, but would block checkout).
6. **Independent mainnet receipt verifier** (brief §9) not implemented, so no
   "Verified Paid" on mainnet.
7. **Mainnet signing** (create, pay, register, cancel, retry) is gated off in
   code; the wallet-signing path (journal, cross-tab lock, unknown outcome) has
   not been ported to mainnet.
8. **Quote store** in dry/funded mode needs the mainnet project's own Upstash
   database; fixture mode uses process memory (not durable on serverless).
9. **No per-IP rate limit** on the quote route yet (per-request limit only).
10. **Prefetch bypass**: Next.js prefetch requests skip the proxy (unchanged
    matcher, to keep Testnet identical). In a mainnet build a prefetch of a
    Testnet path renders without the Testnet providers and fails closed.
11. **Residual Testnet constant in the mainnet bundle**: `TESTNET_GENESIS_HASH`
    is exported from `@taply/near-client`'s shared `rpc` module, which
    `createMainnetReader` needs, so the string ships (unused). API change
    request to Codex: move Testnet constants out of `rpc.ts` (or add a
    `@taply/near-client/mainnet` entry point). The Testnet code hashes in the
    bundle are Codex's `MainnetProfileSchema` deny-list, i.e. a guard.
12. Testnet page chunks are still compiled into a mainnet build's static
    directory (unreachable: their routes redirect). Splitting builds per
    network at the route level would need separate app directories.
13. near-connect fetches its wallet manifest from `raw.githubusercontent.com`
    on load (same as the Testnet build).
14. R-2 remains open (contained, not eliminated).

## 7. Owner approvals still required (none requested by this increment)

Separate explicit approval for each:

1. Pushing a dedicated remote integration branch name (this session may only
   push `claude/festive-brahmagupta-qkqex1`).
2. Merging the SDK dependency/lockfile change (`apps/web/package.json`,
   `pnpm-lock.yaml`: `@defuse-protocol/one-click-sdk-typescript@0.1.26`,
   `@noble/hashes@1.8.0`).
3. Network access for this environment to `1click.chaindefuser.com` and the
   mainnet RPCs, to record a real **dry** quote and run read-only checks.
4. All of `docs/MAINNET_INFRA.md` §6 (accounts, deployment, key deletion, Vercel,
   DNS, funds).
5. Pinning the read-back production code hash and a staging code hash.
6. Opening each release gate (`lib/mainnet/release-gates.ts`) through a reviewed
   code change after the owner-approved release review: signing, funded quotes,
   verifier. Turning on `TAPLY_ONECLICK_MODE=dry` on a Preview.
7. A contract/schema change for `intentsRouter:true` (Codex) after evidence.

## 8. Results of this increment (2026-11-13, this sandbox, Node 24.22.3, pnpm 11.5.0)

| Check | Command | Result |
| --- | --- | --- |
| Whole repository | `pnpm check` | exit 0 — shared 93/93, near-client 262/262, web **1375 passed / 1 skipped** (Codex's `bf5d712`: 1241 web; +134 new) |
| API (CI step) | strict tsc + eslint + `node --test apps/api/test/*.test.mts` | 72/72 |
| 1Click server tests | `vitest run src/server/mainnet` | 56/56: quote body, SDK signature path (5 tampered signed fields), echo mismatch (5 fields), amount/minimum-out, stale, deadline, deposit address rules, malformed, off/funded gates, missing contract/store, 7 bad inputs, 5 bad request states, unknown/rejected-config/unreadable chain, payer restriction, expiry window, USDC registration ×2, duplicate active quote, concurrent BUSY, per-request limit, expired-funded-in-progress block, rejected quote not stored, upstream error mapping, `/v0/tokens` listing, status (fixture, dry, lookup by id, echo/correlation mismatch, Taply-built links), HTTP client (Bearer only, no redirect/cache, error mapping), Redis store (prefix, NX lock, compare-and-delete), HTTP handlers (404 on Testnet, no-store, cross-site/415/413/400), mode resolution |
| Mainnet lib tests | `vitest run src/lib/mainnet` | 52/52: release gates closed, route isolation, profile (no Testnet defaults, approved accounts, Testnet/empty hashes refused), caps and exact amounts, explorer links, allowlist, EIP-55 (official test vectors), fixtures schema-valid, 19 state rows + "never Verified" exhaustive + do-not-repay |
| Mainnet UI tests | `vitest run src/components/mainnet` | 23/23: EN/TR key parity and labels, near-connect mainnet options, Testnet accounts refused, status panel per scenario, refund checksum blocks the request, verified review with withheld deposit, client refuses a wrong principal, 5 server errors in plain language |
| Build guard | `vitest run src/lib/deploy` | 61/61 (adds fixtures/1Click-fixture refused on Production, funded/signing refused everywhere) |
| Testnet regression vs Codex `bf5d712` | both production builds served, 21 paths, normalized HTML (nonce and chunk names removed) | **21/21 identical** status and markup, including Testnet pages, 404s, `/m*` and `/api/mainnet/*` |
| Testnet Webpack build (CI step) | `next build --webpack` | exit 0; runtime smoke `/`, `/pay`, `/wallet`, `/settings`: NEAR Testnet header, 0 page errors |
| Mainnet preview build | `pnpm build:mainnet` with `env/mainnet.env.example`, Preview scope, no contract, fixtures on | guard 14/14 PASS, build exit 0; `taply.testnet-vault.v1` and `taply-e2e-ce38a238` absent from all static files |
| Guard refuses Testnet leakage | only `NEXT_PUBLIC_TAPLY_NETWORK=near-mainnet` set | refused |
| Webpack mainnet build | `next build --webpack` with mainnet env | refused by design (fails closed) |
| Real-browser QA | `scripts/mainnet-1click-qa.mjs` (Chromium; 390 px, 1280 px, 360 px Turkish) | **88/88**; screenshots in `docs/screenshots/mainnet-1click-2026-11-13/` |
| Leak scan of every script the mainnet pages loaded (20) | same run | no Testnet RPC, contract id, code hash, receipt endpoint, vault key or mnemonic list; one known residual: `TESTNET_GENESIS_HASH` string from near-client's `rpc` module (§6.11) |
| Browser network | same run | only localhost and near-connect's wallet manifest (`raw.githubusercontent.com`); no RPC, no 1Click from the browser |

Not verified here: anything live on mainnet (no contract, RPC and 1Click
blocked by the sandbox proxy), wallet connection with a real mainnet wallet,
GitHub Actions run of the new `workspace-check` steps (dispatch needed; the
workflow does not run on pushes to this branch).
