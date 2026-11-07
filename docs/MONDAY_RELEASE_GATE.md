# Monday release gate — READ-ONLY public NEAR Testnet demo

Branch `feature/monday-testnet-sprint` (worktree `C:\taply-monday-sprint`), based on
`feature/final-integration-review` @ `e6d0890`. Prepared 2026-11-08. Nothing was
pushed, merged, deployed or published. No wallet signature, transaction or
contract deployment was made. G1 contract, code hash and ABI are unchanged.

## Decision

**Conditional GO for a READ-ONLY public Testnet demo**, once the five steps below
are done. NO-GO for any signing, merchant transactions, live Handshake (G2) or
Protected Pay (G3): those stay off.

Conditions before the public URL is shared:

1. A human runs the real-iPhone checklist (section 4) on the Preview URL and
   records PASS/FAIL. WebKit emulation is not iPhone acceptance.
2. A human creates the Vercel project and DNS records with the values in
   section 5 (no account-specific values are invented here).
3. The Preview deployment passes the post-deploy checks in section 5.4.
4. Independent review of this branch (it is unreviewed, like F-01 on the base).
5. `pnpm check` and the final WebKit + Firefox smoke on the release-candidate commit, on a
   machine with enough free memory (both were not run here).

## 1. What "read-only demo" means here

| Surface | State in the Monday build |
| --- | --- |
| Wallet connect (external NEAR Testnet wallet) | On (read-only: account + balance) |
| Instant Pay signing (`NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY`) | **Off** |
| Merchant transactions (`..._FLAG_MERCHANT`) | **Off** |
| Live Handshake (`..._FLAG_HANDSHAKE`) | **Off**; G2 unapproved, undeployed |
| Protected Pay (`..._FLAG_PROTECTED_PAY`) | **Off**; security gate |
| Send (direct transfer) | Preview only; `SEND_SIGNER_AVAILABLE = false` in code |
| Social login, sponsored gas, milestone | Hard-disabled in code (no env override) |
| Contacts, Recurring templates, Split Pay | On; local-only planning; never sign; kill switches below |
| Historical pilot sale `/pay/9b9a…4502`, `/receipt/9b9a…4502` | Read from the Testnet contract live; receipt verifier runs live |
| `/demo`, `/demo/handshake` | Synthetic, stamped DEMO |

## 2. Gate results (actual)

| Gate | Result | Evidence |
| --- | --- | --- |
| Web typecheck (`tsc --noEmit`) | PASS | sprint session |
| Web lint (`eslint .`) | PASS (0 problems) | sprint session |
| Web tests (`vitest run`) | PASS 1,098 / 1 skip at `a92e124`; focused PASS after | sprint report §3 |
| Root `pnpm check` | **NOT RUN** (low memory) — required before review | |
| Production build (Vercel-like filtered build) | PASS, 24 routes + proxy | `pnpm --filter "@taply/web..." run build` |
| HTTP route sweep | PASS: 27 URLs 200, unknown route 404 | |
| Security headers | PASS: CSP (enforced, nonce), nosniff, no-referrer, DENY, COOP, Permissions-Policy; no X-Powered-By. HSTS off locally by design | |
| Chromium / WebKit / Firefox release smoke | Chromium on RC: 23/23 run PASS (partial). WebKit 44/44 and Firefox 53 PASS/2 harness FAIL (fixed)/1 BLOCKED on earlier sprint builds. Final WebKit/Firefox on RC: NOT RUN | sprint report §4 |
| Wallet executor under CSP (Meteor, Chromium) | PASS: executor booted in its srcdoc frame, no script violation | §6 of sprint report |
| G1 contract / hash pins unchanged | PASS: no file outside `apps/web` changed | `git diff --stat e6d0890..HEAD -- . ':!apps/web'` is empty |
| Payment flags unchanged | PASS | diff of `lib/flags/features.ts` touches only contacts/recurring/splitPay |
| Secrets in git | PASS: none; only `apps/web/.env.example` tracked | |
| Live Testnet payment evidence | **None new.** Only the historical 2026-11-01 pilot (docs/EVIDENCE.md) | |
| Physical iPhone | **NOT RUN** (human step) | §4 |

## 3. Kill switches (Vercel env, no redeploy of code needed beyond a rebuild)

| Variable | Effect |
| --- | --- |
| `NEXT_PUBLIC_TAPLY_FLAG_CONTACTS=off` | Hides Contacts (page shows "coming later", picker hidden) |
| `NEXT_PUBLIC_TAPLY_FLAG_RECURRING=off` | Hides recurring templates |
| `NEXT_PUBLIC_TAPLY_FLAG_SPLIT=off` | Hides Split Pay |
| `NEXT_PUBLIC_TAPLY_FLAG_WALLET=off` | Hides wallet connection entirely |
| `TAPLY_CSP_MODE=report-only` / `off` | CSP to report-only or off if a wallet breaks in the field (server-only) |

`NEXT_PUBLIC_*` values are inlined at build time: changing one needs a rebuild
(Vercel "Redeploy"). `TAPLY_CSP_MODE` / `TAPLY_HSTS_MAX_AGE` are read at request time.

## 4. Real-iPhone manual acceptance checklist (human)

Device: any iPhone on current iOS, Safari, mobile data AND Wi-Fi. Record model,
iOS version, date/time, Preview URL, and PASS/FAIL + screenshot per line. Do not
approve any transaction; if a wallet asks to sign anything, cancel and record it.

| # | Step | Expected |
| --- | --- | --- |
| 1 | Open the Preview URL in Safari | Home loads; "NEAR Testnet" badge; dark green theme; no horizontal scroll at 375–430 px |
| 2 | Settings → Türkçe, reload, then English | Language switches and persists across reload |
| 3 | Share → Add to Home Screen; open from the icon | Standalone window, Taply icon (not a screenshot), splash dark; status bar readable |
| 4 | Rotate to landscape and back | Layout stays usable (manifest asks portrait; Safari may ignore) |
| 5 | Tap "Connect wallet" | Wallet list appears (Meteor, Intear, …); closing it returns cleanly |
| 6 | Pick a wallet you own (Testnet), sign in only | Returns to Taply showing your `.testnet` account; NO transaction prompt. If it asks to add a key or sign, cancel and record FAIL |
| 7 | Background Safari 30 s during wallet return, come back | Taply restores the connected state or shows a clear retry; never "paid" |
| 8 | Open `/pay/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502` | 0.1 NEAR, Pay to `taplytest.testnet`, code `KED 5E9`, "Paid per contract" within ~10 s |
| 9 | Open `/receipt/9b9a…4502?ftx=CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su` | Either fresh "Verified Paid" (record it), or "Paid per contract" + a dashed "Archived · not a live check" panel. Never Verified Paid without the ribbon logic |
| 10 | Airplane mode, reload the pay page, then back online and "Check again" | Offline/error state with retry; no paid claim while offline; recovers online |
| 11 | Scan tab → camera permission prompt | Prompt appears; denying shows a clear message and a paste-link fallback |
| 12 | Scan the store QR from another screen (`/checkout/taplytest.testnet`) | Opens the store page on the SAME public origin (no localhost/IP) |
| 13 | Contacts: add "Shop" = `taplytest.testnet`, reload, then add `tap1ytest.testnet` | Saved after reload; the lookalike shows a warning and needs the checkbox |
| 14 | Send: Choose from contacts → Shop → amount → Review | Full account ID shown with name; "Confirm and send" disabled |
| 15 | Split: 1 NEAR between 3 | Shares 0.333333333333333333333334 / …333 / …333; "creating requests is switched off" notice |
| 16 | Recurring: monthly template on today | "Due today"; "Prepare request" opens a filled request form; signing off notice |
| 17 | Safari back/forward through pay → receipt → home | Pages restore without stale "paid" states or errors |
| 18 | VoiceOver on: home, pay page, receipt | Amounts and full account IDs are read; buttons are labelled |
| 19 | Settings → Accessibility → Reduce Motion on | No large animations; content still clear |
| 20 | Long-press any share/copy link and paste in Notes | Link starts with the public HTTPS origin, never localhost |

Mark the overall result PASS only if 1–3, 5–6, 8–10, 12, 17 and 20 pass.

## 5. Vercel deployment proposal (not executed)

### 5.1 Project settings

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| Root Directory | `apps/web` (include files outside root: **on**, needed for `packages/*`) |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `cd ../.. && pnpm --filter "@taply/web..." run build` (builds `@taply/shared`, `@taply/near-client`, then `next build`; validated locally 2026-11-08) |
| Output | Next.js default (`.next`) |
| Node.js | 24.x (repo pins 24.22.2 in `.node-version`; engines `>=24.22.2 <25`) |
| pnpm | 11.5.0 via `packageManager`; set `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel uses it |
| Region | Default; the app reads Testnet RPCs from the browser, not the server |

`apps/api` is not deployed (in-process only; production auth closed).

### 5.2 Environment variables

Production and Preview (same values unless noted). All `NEXT_PUBLIC_*` are public
by design; there are **no secrets** in this app.

```
NEXT_PUBLIC_TAPLY_NETWORK=near-testnet
NEXT_PUBLIC_TAPLY_CONTRACT_ID=taply-pay-pilot-1.testnet
NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH=BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B
NEXT_PUBLIC_TAPLY_RPC_URL=https://test.rpc.fastnear.com
NEXT_PUBLIC_TAPLY_RPC_PROVIDER_ID=fastnear-testnet
NEXT_PUBLIC_TAPLY_VERIFIER_RPC_URL=https://archival-rpc.testnet.near.org
NEXT_PUBLIC_TAPLY_VERIFIER_RPC_PROVIDER_ID=near-archival-testnet
NEXT_PUBLIC_TAPLY_EXPLORER_BASE_URL=https://testnet.nearblocks.io
NEXT_PUBLIC_TAPLY_FLAG_WALLET=on
NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=off
NEXT_PUBLIC_TAPLY_FLAG_MERCHANT=off
NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE=off
NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY=off
# Production only (Preview uses its own *.vercel.app origin automatically):
NEXT_PUBLIC_TAPLY_SHARE_ORIGIN=https://taplyapp.xyz
# Server-only, read per request:
TAPLY_CSP_MODE=enforce
# Production only, after HTTPS on taplyapp.xyz is confirmed (start small):
TAPLY_HSTS_MAX_AGE=86400
```

Do not set `NEXT_PUBLIC_TAPLY_API_BASE_URL` (no API is deployed).

### 5.3 Domain and DNS (human, in the Vercel dashboard and the registrar)

- Add `taplyapp.xyz` (and optionally `www.taplyapp.xyz` redirecting to it) to the
  project. Use **exactly** the A/CNAME records the Vercel Domains screen shows
  for this project; this document does not invent them.
- If the registrar has CAA records, make sure they allow Vercel's certificate
  authority as shown by Vercel.
- HSTS: keep `includeSubDomains` and `preload` OFF. Raise `TAPLY_HSTS_MAX_AGE`
  to 31536000 only after a week without HTTPS problems on every subdomain.

### 5.4 Post-deploy checks on the Preview URL (before Production)

1. `curl -sI <preview>/` shows `content-security-policy` with a nonce, `x-frame-options: DENY`, no `x-powered-by`.
2. Open `/pay/9b9a…4502`: Paid per contract. `/receipt/9b9a…4502?ftx=CrzQ…`: Verified Paid or honest archive panel.
3. Browser console on home, pay, receipt and wallet selector: no CSP violation except the known benign `is-generator-function` eval probe (§6 of the sprint report).
4. Copy a share link: it uses the Preview origin, never localhost.
5. Run `node apps/web/scripts/release-smoke.mjs <playwright index.mjs> <out> chromium` with `BASE=<preview url>`.
6. Then the iPhone checklist (§4). Only then promote to Production.

## 6. Remaining risks (ranked)

1. **Public RPC rate limits.** `archival-rpc.testnet.near.org` 429s carry no CORS
   headers (browsers see a network error). Mitigated: split RPCs, cool-down,
   bounded back-off, archived-record fallback. A judge on a busy IP may see
   "Paid per contract" + archive instead of a fresh Verified Paid.
2. **Wallet behaviour under CSP** verified for Meteor in Chromium only. Other
   wallets / iOS Safari are covered by the iPhone checklist and the
   `TAPLY_CSP_MODE` kill switch.
3. **Unreviewed sprint code** (Contacts, Recurring, Split, CSP, RPC changes) —
   needs independent review; kill switches exist for the three tools.
4. **F-02/F-03/F-04/F-06** from the final integration review remain open
   (governance, CI policy, dev-dependency advisory, durable auth). F-05 is fixed here.
5. No new live payment evidence: the only payment proof is the 2026-11-01 pilot.
