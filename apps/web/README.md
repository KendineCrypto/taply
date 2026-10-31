# `apps/web` — Taply v0.4 frontend

Mobile-first NEAR **Testnet** wallet and merchant payment PWA. Owned by Claude
(`feature/frontend`). `docs/LEAD_PROTOCOL_FREEZE_v1.md` is the authoritative
protocol; `@taply/shared` is its executable form and this app consumes it rather
than restating it.

## Status: Phase 2C (Instant Pay integration, signing gated)

**No contract is deployed or configured, and signing is switched off.** The
Instant Pay screens are wired to the frozen contract ABI through
`@taply/near-client`, and verified against real sandbox contract outputs in
tests. Nothing here is Testnet evidence; `docs/EVIDENCE.md` remains the only
place a verified claim may be recorded.

| Area | State |
|---|---|
| App shell, routes, chrome, safe areas, accessibility | built |
| Brand assets + PWA icons/manifest | built |
| EN/TR localisation of all product screens | built |
| External NEAR Testnet wallet connect (`@hot-labs/near-connect`) | built; sign-in with a real wallet **not yet human-tested** |
| Native NEAR balance via `@taply/near-client` (final-block RPC reads) | built; browser Testnet read verified |
| Receive: account ID, copy, QR code of the account ID | built |
| Contract config: account + approved code hash from env, fail-closed | built, tested |
| Contract check: `get_config` at a final block, code hash pinned, problems rejected | built, tested |
| Create Instant request: form, chain-time expiry, quote, exact review, wallet create | built, tested; **signing gated** |
| Share link + scannable QR of the identical link | built, tested |
| Pay review: exact terms, explicit check, wallet approval of `pay_instant_native` | built, tested; **signing gated** |
| Status sync: finalized `get_request` reads, bounded polling while in flight | built, tested |
| Recipient retry of a recorded failure; creator cancel of an unpaid request | built, tested; **signing gated** |
| Receipt: contract terminal facts, labelled as not finality proof | built, tested |
| Verified Paid ribbon | **unreachable**: needs a settlement receipt verifier |
| Protected Pay, Handshake, checkout, send | **disabled** |
| Service worker, CSP | **deliberately deferred** (reasons in `src/lib/protocol/README.md`) |

### Instant Pay rules (Phase 2C)

- **Gates.** Reads need `NEXT_PUBLIC_TAPLY_CONTRACT_ID` and
  `NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH`. Signing additionally needs
  `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=on` (a human decision after Testnet review)
  and this session's `get_config` read passing `contractConfigProblems` (no fault
  build, no Protected/Handshake/NEP-141/sponsored capability, ABI gas floors).
  With any gate closed, every screen still renders, and no wallet request is made.
- **Source of truth.** Status comes only from `get_request` read at a finalized
  block where the contract's code hash matched the pin, then validated by the
  shared `PaymentIntentResponseSchema` (`src/lib/payments/intent.ts`). Wallet
  results, journal entries and polling never change what is shown as paid.
- **Paid vs Verified Paid.** A final read of `FINAL_PAID` renders "Paid per
  contract" with a note that the settlement receipt is not independently
  verified. `mapChainState` now requires `settlementProof: 'verified_receipt'`
  for the Verified Paid ribbon, and nothing produces that yet.
- **No duplicates, no blind retries.** Every signature is journaled in
  localStorage *before* the wallet opens (`src/lib/payments/journal.ts`; public
  data only). An unknown or unconfirmed attempt blocks the same action until a
  finalized read explains it; after two minutes of chain time with no effect, a
  person may deliberately re-review. A creation is re-signed with its original
  nonce and terms, never re-minted. Without a usable journal, signing is refused.
  The contract independently rejects a second funding, a reused nonce and a stale
  retry nonce.
- **In flight.** `PAYOUT_IN_FLIGHT` offers no action. After 5 minutes of chain time
  it is shown as unresolved (`RECONCILIATION_REQUIRED`); a successful transfer
  with a failed callback can stay that way (ADR-001), and nothing retries it.
- **Retry/cancel.** Retry appears only for the recipient of a recorded
  `PAYOUT_FAILED_RECOVERABLE` operation (same nonce); cancel only for the creator
  of an unpaid `OPEN` request. near-client's `prepare*` functions restate the ABI
  rules, and the contract re-checks them.
- **QR.** `src/lib/qr/encode.ts` is a small byte-mode encoder (no new
  dependency). Its output was checked outside the repo: identical module-for-module
  to `qrcode@1.5.4` and decoded by `jsqr@1.4.0` for 260 inputs; tests pin those
  matrices.

### Wallet and balance rules

- Sign-in adds **no** access key. Taply never creates, stores or sees a private key.
- A connected account is what the wallet *reported*. Nothing is signed, so it
  is used for public reads only, never as authorisation.
- A balance number is shown only for a `source: rpc`, `verified_final`,
  non-stale read of the exact connected account (`src/lib/near/balance.ts`).
  Errors, mock data, a mismatch or a missing account never render a number, and
  never render zero. After an outage the last verified value stays visible,
  marked stale with its check time.
- `.near` names get a "looks like mainnet" warning, but are not rejected: the
  `near` account exists on Testnet. The Testnet RPC read decides.
- `Cross-Origin-Opener-Policy` is `same-origin-allow-popups` so wallet popups
  can reply to the page that opened them.

## Commands

Run from the repository root (this is a workspace member now):

```bash
pnpm install --frozen-lockfile
pnpm --filter @taply/shared build         # REQUIRED before web typecheck/test/build
pnpm --filter @taply/web dev
pnpm --filter @taply/web check            # verify:brand + typecheck + lint + test
```

`@taply/shared` exposes only `dist/`, so it must be built before this app can
typecheck, test or build against it.

## Open dependencies

- **Reviewed Testnet deployment** of the payments contract, its approved code
  hash, and a human decision to set `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=on`.
- **Settlement receipt verifier** (funding, transfer and callback receipts,
  VerifiedReceipt) before any Verified Paid ribbon.
- **Real wallet capability test** of `signAndSendTransaction` with deposits on
  the chosen Testnet wallets (freeze section 10, gate 3).
- **Codex reads**: account activity, sessions, NEP-413 auth. Listed live in
  `/demo` diagnostics.
- `eslint-plugin-jsx-a11y` / `eslint-plugin-react` still peer at ESLint 9 only;
  a11y behaviour is implemented and tested without those lint rules.

## Architecture

```
src/app/            routes (App Router). One route per frozen path.
src/components/
  brand/            approved mark geometry; never redrawn
  shell/            AppShell, top bar, bottom nav, icons, ComingSoon
  wallet/           BalanceCard, AccountChip, connect button + error notice
  home/             QuickActions, RecentActivity
  status/           StatusBadge, VerifiedPaidRibbon, VerificationChip, MockBadge
  primitives/       Amount, AccountId, Card, DetailRow
  feedback/         ErrorState (protocol codes), NoticeState (client-only), FeatureDisabled
src/lib/
  protocol/         the ONLY protocol import surface; re-exports @taply/shared
  payments/         mapChainState — the only module that decides payment display
  format/           BigInt base-unit amounts; ns timestamps and clock anchoring
  i18n/             EN default + TR, typed dictionaries, no route prefix
  flags/            capability flags; only read-only walletConnect is on
  near/             chain config, the near-client instance, balance view model
  wallet/           wallet adapter interface + NEAR Connect implementation
  hooks/            online status, clipboard
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
only), `@hot-labs/near-connect` 0.12.0 (MIT, wallet connection), plus the
workspace packages `@taply/shared` and `@taply/near-client`. Frontend code in this directory was written with Claude
Code; see the root README for the hackathon disclosure required by
HACKATHON.md Q-005.
