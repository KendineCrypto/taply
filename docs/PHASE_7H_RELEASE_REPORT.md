# Phase 7H release-candidate report

2026-11-06. Frontend + release work on the operator's Windows machine.
**Nothing was pushed, merged, tagged, deployed, signed, funded, posted or
submitted.** No transaction was created; every browser run used a read-only
injected wallet whose signing methods throw, with the Instant Pay signing flag
**off**. `apps/api/**`, `contracts/payments/**` and `packages/near-client/**`
were not modified.

## Verdict

| Scope | Readiness |
| --- | --- |
| Judge review from a clean clone (local simulation + read-only real pilot data) | **READY**: reproducible, gates green (section 6), README walkthrough verified in the browser |
| Instant Pay merchant POS on Testnet with real signing | **Software ready, not re-proven today.** Needs a human-approved signing build and one fresh two-phone sale; no physical phone was used in 7H |
| Hosted public HTTPS demo | **Not deployed.** Plan in section 8; optional (Q-012) |
| Hackathon submission | **Blocked on human items:** LICENSE, judged branch/tag (main lacks Phases 4–7H), demo video + X post, payload and consent |
| Live Handshake (G2) | **NO-GO**, unchanged from 7G. Disabled; room client now matches the core reducer but is unwired |
| Protected Pay | Disabled (security gate) |
| Rust/contract checks | **BLOCKED** on this machine (no Rust toolchain); not re-verified in 7H |


## 1. Branch, base and commits

| Item | Value |
| --- | --- |
| Worktree | `C:\taply-phase7h-release` (new, isolated) |
| Branch | `feature/phase7h-release` (new, local only) |
| Base | `feature/phase7g-integration` @ `f3d15acd73faf35b7ff255ffbac6e7d48307b162`, equal to `origin/feature/phase7g-integration` (checked with `git rev-parse` after fetch) |

| Commit | Change |
| --- | --- |
| `e268660` | fix(web): delegate Handshake room reducer to near-client `applyRoomCatchUp` (+ parity/adversarial tests) |
| `787a449` | fix(web): one retry control for one outage on the pay screen |
| `55ff5aa` | fix(web): remove repeated status and contradictory receipt copy; receipt read retry; TR term |
| `d16b24e` | fix(web): 44 px touch targets for `/demo` tour controls |
| `54cabdf` | fix(web): announce the receipt outcome to screen readers |
| `c59404f` | docs: judge README, submission checklist, Phase 7H QA harness, screenshots and raw QA JSON |
| report commit | this report and the live-region re-check JSON (`git log -1`) |

Files changed versus the base: only `apps/web/**`, `README.md` and the two
`docs/PHASE_7H_*` files. `git diff --stat f3d15ac HEAD -- apps/api
contracts/payments packages/near-client packages/shared pnpm-lock.yaml
package.json` is empty. No `.env.local` is tracked; the QA one was created
outside git, kept out of the gate builds and deleted afterwards.


## 2. Environment

| Tool | Required | Observed |
| --- | --- | --- |
| Node | 24.22.2 (`.node-version`) | 24.22.2 |
| pnpm | 11.5.0 | 11.5.0 |
| Rust / Cargo | 1.95.0 + wasm32 | not installed (Rust checks **BLOCKED**, as in 7G) |
| Browser | Playwright 1.64.1 Chromium (separately installed, not a repo dependency) | headless |
| Testnet RPC for QA | | `https://test.rpc.fastnear.com` (see 5.1 for why not `rpc.testnet.near.org`); archival `https://archival-rpc.testnet.near.org` only where the harness says so |

Baseline at `f3d15ac` before any change: `pnpm check` exit 0, shared 92/92,
near-client 167/167, web 757 passed + 1 skipped (identical to the 7G report).

## 3. Handshake room reducer (priority 2)

Phase 7G found the frontend `applyRoomSync` (`apps/web/src/lib/handshake/room.ts`)
laxer than the core `applyRoomCatchUp` (`packages/near-client/src/room-sync.ts`).

**Change (frontend only; near-client untouched):**

- The wire shape is now `RoomCatchUpSchema` itself (`RoomSnapshotSchema =
  RoomCatchUpSchema.shape.room`). The frontend only adds cross-field rules on
  top (payer-progress consistency in the snapshot *and* every event room,
  ordering, reset-without-events, same-session).
- `applyRoomSync({ previous, untrusted, requested, current })` takes the raw
  body, drops a response whose request scope (session, account, auth
  generation) differs from the current one **before parsing**, runs the strict
  parse, then delegates the state transition to `applyRoomCatchUp` unchanged.
  A sync applies only if **both** accept it: the frontend can be stricter than
  the core, never laxer.
- Typed refusals that never change state: `invalid`, `unsupported_version`,
  `session_mismatch`, `cursor_invalid`, `cursor_conflict`, `refresh_required`;
  the last three set `refetchWithoutCursor`.
- Behaviour change inherited from the core: a **reset to an older cursor is
  ignored** (no rollback). The old test that expected it to apply was updated.

| 7G divergence row | Before | Now |
| --- | --- | --- |
| Event gap after the client cursor | applied | refused `refresh_required` |
| Equal cursor, different room | ignored | refused `cursor_conflict` |
| Last event room ≠ snapshot | applied | refused `cursor_conflict` |
| Non-ISO `emittedAt` | applied | refused `invalid` |
| 17-digit cursor | applied | refused `invalid` |
| Account not in the room | not checked | refused `session_mismatch` |
| Forged `paid` / extra fields | refused | refused `invalid` |

**Tests** (`apps/web/src/lib/handshake/__tests__/room-reducer-parity.test.ts`,
19 tests): every row above; non-contiguous/zero/short event runs; foreign
sessions in events; payer-progress forgery (shown to be accepted by the core
alone, refused here); unknown versions and non-objects never throw; numeric
(not lexical) cursor order; duplicate delivery returns the *same* state object;
account switch drops in-flight responses and never reuses another scope's
state; applied state has exactly `sessionId, accountId, authGeneration, cursor,
room` and no paid/verified/receipt/payout field; a **seeded 2,000-case
differential fuzz** against `applyRoomCatchUp` (applied ⇒ core applied the
identical state; core threw ⇒ frontend refused; every branch exercised); and a
source scan proving `room.ts` delegates and no file outside `lib/handshake`
uses the reducer, reader or adapter.

**Mutation check:** temporarily restoring the old lax logic made 8 of these
tests fail (gap, conflict ×2, membership, non-contiguous, foreign session,
differential, delegation scan); restored, all pass.

**Live Handshake stays disabled:** flag off by default, `resolveRoomAdapter`
returns unavailable without a reviewed backend, no route imports the room
reader/reducer, `/s/<session>` does not show room state (5.4), the room UI is
mounted only on DEMO-stamped `/demo/handshake`.

## 4. Merchant POS / customer / receipt audit and fixes (priorities 3–4)

Audited on the production build with the real pilot sale
`9b9a5724…4502` (FINAL_PAID) on both roles, plus a third account, and with
synthetic failures. Fixed (no status mapping, verifier logic or signing gate
changed):

| Finding | Fix | Test |
| --- | --- | --- |
| Pay screen with RPC down or a stale final block showed **two** retry buttons ("Try again" for the contract check, "Check again" for the request), the open 7G follow-up | Pay screen shows the explanation without its own button; the single **Check again** re-reads the request and re-runs the contract check when that is what failed. A code-hash mismatch is still never retryable | `freshness.test.tsx` (2 new); mutation check: re-adding the second button fails the test |
| Receipt said "Open the receipt to check them" **on the receipt** | Receipt-specific EN/TR copy: the receipt check "has not succeeded on this screen" | `receipt-verification.test.tsx` |
| Receipt read failure had no retry, only "Back to payment" | One **Check again** that re-reads the terminal facts (not for a code-hash mismatch) | `receipt-verification.test.tsx` (new: failed read → retry → Paid per contract, never Verified Paid) |
| Pay hero said "Paid per contract" three times (chip, title, proof legend) | Legend row names the evidence level: **Contract record: paid** next to **Verified Paid: Not checked on this screen** (TR: *Kontrat kaydı: ödendi*) | `shared-session.test.tsx` |
| Turkish used two terms for Verified Paid (*Doğrulanmış Ödeme* ×3, *Doğrulanmış Ödendi* ×15) | Normalised to *Doğrulanmış Ödendi* | full web suite |
| Verified Paid receipt had **no live region** (found by browser QA, 5.2) | One persistent polite `role=status` region with the existing announcement copy | `receipt-verification.test.tsx` (2 new) |
| `/demo` tour controls 36 px high (found by browser QA, 5.2) | `var(--tap-target)` (44 px) | QA re-run: 0 small controls |

Kept on purpose: the status chip (the one canonical status from 7G) and the
hero title; the Store QR vs per-sale QR split; "Paid per contract" vs
"Verified Paid" as two different things.

## 5. Browser QA (priorities 6–7)

Harness: `apps/web/scripts/phase7h-qa.mjs` (new; same safety model as 7D/7F/7G).
Production webpack build, `next start` on `127.0.0.1:3207`, Chromium headless,
Instant Pay signing flag **off** (the script refuses to run otherwise), injected
read-only wallet whose sign methods throw, every non-app host blocked except
the configured RPC, any `broadcast`/`send_tx` aborted and recorded.
Raw results: `apps/web/docs/screenshots/phase7h/phase7h-qa.json` (full run) and
`phase7h-qa-rerun.json` (re-run cells). Real data: pilot sale
`9b9a5724…4502`, merchant `taplytest.testnet`, customer
`taply-pilot-funder-1101.testnet`, third account `someone-else-qa.testnet`.

**Totals:** 99 audited views in the full run + 11 re-run cells. **Broadcast
attempts: 0.** RPC methods used: `status`, `block`, `chunk`,
`EXPERIMENTAL_tx_status`, `query` (`view_account`, `view_access_key_list`,
`get_config`, `get_request`, `get_receipt`): read-only only. Historical reads
were retried on the archival RPC **only** in the matrix and receipt sections
(the pilot's 2026-11-01 blocks are pruned on FastNEAR); section 5.3 ran
without it.

### 5.1 Public RPC throttling (real, not synthetic)

The first attempt used the README's `https://rpc.testnet.near.org`. After a few
dozen page loads it answered **HTTP 429, `Retry-After: 418`** (confirmed with
`curl`). The app showed "Could not check the payments contract" + "Could not
read the request… not a payment failure" with **one** Check again and no
signing (`throttled-rpc-testnet-near-org-429-tr-390.png`). That run was
discarded and QA was redone on `https://test.rpc.fastnear.com`. FastNEAR also
throttled briefly once, when the harness and a preflight run coincided
(`throttled-fastnear-429-tr-customer-paid-430.png`); that cell passed on re-run.

### 5.2 Width × language matrix (360, 390, 430, 768, 1280 px; EN and TR)

Surfaces: `/`, `/demo`, `/merchant`, `/checkout/taplytest.testnet`, merchant
`/pay/<id>`, customer `/pay/<id>`, customer `/receipt/<id>?ftx=…` (70 views).

| Check | Result |
| --- | --- |
| Horizontal overflow | **0 px** on all 70 views |
| Unnamed interactive controls | **0** |
| Controls under 44 px | `/demo` tour step buttons and pills at **36 px** on all 10 width/language combinations, **fixed** in `d16b24e`; re-run: 0 |
| Same status title repeated on a screen | **0** on payment/receipt screens after the 4.x fixes |
| Live regions | present on all 19 pay views; **missing on all 10 Verified Paid receipt views** (the progress notices unmount once verified, so the outcome was never announced). **Fixed** in `54cabdf` with one persistent polite region; unit-tested, browser re-check in 5.4 |
| Merchant and customer hero on the same sale | both **Paid per contract**, same amount, Pay to account and sale code `KED 5E9` |
| Customer receipt with its own link | **Verified Paid** at every width in EN and TR (history via archival) |
| `<html lang>` | follows the locale cookie (`en` / `tr`) |
| Load failures | 1 (`tr-customer-paid-430`, FastNEAR 429 window), **passed on re-run** |

### 5.3 Edge states

| Scenario | Observed |
| --- | --- |
| **Merchant Verified Paid without the customer's link** (locator → verifier) | Verified Paid, EN 390 in 54 s, TR 360 in 11 s (archival history) |
| **Account switching on one device** (merchant → customer → third account → disconnected, same browser storage) | status `paid_per_contract` for all four; merchant wording ("Verify receipt") only for the merchant; payer-side wording ("Check receipt") for the others; never Verified Paid on the pay screen |
| **Pruned history, NO archival** (what a judge on FastNEAR sees) | Merchant receipt: **Paid per contract** + "This payment is too old for this RPC". Customer receipt with `?ftx=`: **Paid per contract** + "Could not verify yet… does not mean the payment failed. Do not pay again" + one Check again (the FastNEAR timeout behaviour in Known limitations). No Verified Paid in either |
| **Receipt read failure** (SYNTHETIC: every block-anchored read fails) | "Could not read the request… not a payment failure", exactly **one** Check again (new); after the RPC returned, one tap → receipt loaded and reached `verified` through the normal verifier |
| **RPC down on the pay screen** (SYNTHETIC), EN and TR | exactly **one** retry control (was two) |
| **Offline → reconnect** | offline reload shows the browser's offline page; back online the pay screen re-reads the chain and shows `paid_per_contract` again (status comes from the chain, not memory) |
| **Slow RPC** (SYNTHETIC, +6 s per call) | loading state first, **no status at 2.5 s**, then the normal hero |
| **Reduced motion**, EN and TR, `/pay`, `/demo`, `/` | nothing animates for ≥ 1 ms (the app's override is 0.01 ms). The full run flagged `animate-page` at `1e-05s`: a harness regex bug (exponent form), fixed and re-measured fresh |
| **Keyboard** | merchant's **Verify receipt** reached in 4 Tab presses with a visible focus ring |
| **Live Handshake route** `/s/<uuid>` | "Live Handshake is not available yet… No live pairing happens here", no room state, no paid wording |
| `/demo/handshake` | DEMO-stamped. The two-phone preview shows "Waiting for the customer" on both phones by design (flagged by the repeat detector; not a defect) |
| Page errors | 2, both on Chrome's own offline error page (`chrome-error://…` localStorage access from the harness init script); none from the app |

**Expired request, wrong permitted payer, declined signature, long amounts**
need an OPEN request (a new transaction), so they were not browser-tested
here; they stay covered by the jsdom integration suites (`payment-screen`,
`freshness`, `redirect-recovery`, `create-request`). **No physical phone was
used in Phase 7H.**

Committed screenshots (`apps/web/docs/screenshots/phase7h/`, 33 PNG, 5.6 MB):
`en-*-390`, `en-*-1280` (pay/receipt), `tr-*-360`, `en-merchant-receipt-verified-390`,
`tr-merchant-receipt-verified-360`, `switch-*`, `pruned-*`, `synthetic-*`,
`reconnect-merchant-paid-390`, `handshake-live-route-390`, `throttled-*`.



### 5.4 Re-checks after the QA-driven fixes (same harness, label filter)

| Re-run | Result | Raw |
| --- | --- | --- |
| `/demo` at 5 widths × EN/TR + `tr-customer-paid-430` (11 views) | 0 failures: no small controls, no overflow, TR 430 hero renders | `phase7h-qa-rerun.json` |
| Verified Paid customer receipt, EN 390 and TR 360, after `54cabdf` | `verified`, **1 live region** each (was 0), 0 overflow | `phase7h-qa-liveregion.json` |
| Reduced motion, `/pay`, `/demo`, `/` × EN/TR (fresh ad-hoc run with the corrected ≥ 1 ms rule) | nothing animating | (console output, recorded here) |

Broadcast attempts in every re-run: 0.

## 6. Tests and builds (priority 5): final results

Final commit tested: `c59404fe98073230a7245952b861b1a9bbc5f7a7` (clean tree
except this untracked report), **no `apps/web/.env.local` present**, Windows,
Node 24.22.2, pnpm 11.5.0.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0, no tracked file changed |
| `pnpm check` (brand, workspace build incl. Next production build, typecheck, lint, tests) | **exit 0** |
| ↳ brand | `brand assets OK (7 files byte-identical; master path verbatim)` |
| ↳ `packages/shared` | **92 passed, 0 failed, 0 skipped** |
| ↳ `packages/near-client` | **167 passed, 0 failed, 0 skipped** |
| ↳ `apps/web` (Vitest) | **781 passed, 0 failed, 1 skipped** (62 files; the skip is the opt-in live Testnet locator test) |
| `pnpm --filter @taply/web exec next build --webpack` | **exit 0**, "Compiled successfully" |
| Read-only post-deploy preflight, pilot contract, archival RPC | **10/10 PASS** ("Nothing was signed or sent") |

Totals: **1,040 passed, 0 failed, 1 skipped.** Versus the `f3d15ac` baseline
(757 web): +24 web tests (19 room parity/adversarial, 2 pay-screen retry,
3 receipt read-retry/announcement; 2 existing tests updated for the stricter
reducer and new copy).

Not run here (unchanged from 7G, **BLOCKED**): Rust `cargo test` (default and
`merchant-bound-v1`), fmt/Clippy, reproducible WASM builds and hash
comparison, near-workspaces sandbox, `contracts/payments/test/preflight.test.mjs`.
The API's own `node --test` suite was not re-run (no API change in 7H).

## 7. Production / demo readiness audit (priority 10)

| Area | Finding | Status |
| --- | --- | --- |
| Package metadata | Root `taply@0.4.0`, `private: true`, `packageManager pnpm@11.5.0`, `engines node >=24.22.2 <25`; `@taply/web` description accurate. No `license` field anywhere | OK; license is a human decision (checklist C) |
| Engines | `apps/web` says `node >=20.9.0`, root pins 24.22.2 | Harmless (root wins under pnpm); not changed (manifests are lead-owned) |
| Feature flags | Defaults OFF for Instant Pay signing, Merchant, Handshake, Protected Pay; social login, milestone, sponsored gas hard-disabled | OK |
| Signing gate | Even with `INSTANT_PAY=on`, signing needs a fresh finalized `get_config` and code-hash check (`PaymentsSetupNotice`, context `ensureFreshCheck`) | OK |
| Env safety | Only `NEXT_PUBLIC_*` variables exist in the web app (all public by design, inlined at build); `.env.local` git-ignored and untracked; `.env.example` has placeholders only | OK |
| Secrets in git | Pattern scan of tracked files for private-key/token shapes: only transaction/block **signatures** and validator approvals in recorded Testnet fixtures | OK |
| Security headers | `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, COOP `same-origin-allow-popups` (wallet popups), camera self-only. **No Content-Security-Policy and no HSTS** in app config | Open: HSTS comes from the HTTPS host; a CSP must be tested against the NEAR Connect wallet iframes/popups before adding (not done today) |
| RPC dependency | Single configured RPC for reads, verifier and locator. Under this QA's load from one IP, `rpc.testnet.near.org` answered `429` (`Retry-After: 418`) and FastNEAR answered `429` briefly; the app failed closed both times | Use FastNEAR or another provider for demos; never run browser QA from the recording machine right before recording (README updated) |
| API base URL | `NEXT_PUBLIC_TAPLY_API_BASE_URL` declared but no live route calls the API | OK (no backend needed for the demo) |
| Mobile layout / a11y | See section 5 | |
| PWA | `manifest.webmanifest` and icons present; no service worker (by design, protocol freeze §8) | OK |

## 8. Reproducible HTTPS Testnet demo deployment plan (not executed)

**Nothing below was run.** It is a plan for the human operator. Hosting is
optional (Q-012); if used, keep it up until at least 2026-11-18 23:59 UTC.

### 8.1 Decisions the human makes first

1. **Mode of the public URL.** Recommended: **read-only judge demo**
   (`NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=off`). Judges see the real pilot sale,
   receipts and DEMO journeys; nobody can sign through it. A separate,
   unlisted **recording build** with `INSTANT_PAY=on` is used only by the
   operator for the fresh two-phone sale. Turning signing on for a public URL
   lets any visitor sign real Testnet transactions with their own wallet; that
   is a human decision, Testnet only.
2. **Host.** Any HTTPS host that runs `next start` (Node 24.22.2) works.
   Two reproducible options:
   - **Vercel** (zero config for Next.js 16; HTTPS and HSTS by default).
     Project root `apps/web`, install `pnpm install --frozen-lockfile` at the
     repository root, build `pnpm --filter @taply/web build`.
   - **Any VM / container** with Node 24.22.2: `pnpm install --frozen-lockfile
     && pnpm --filter @taply/web build && pnpm --filter @taply/web start -- -p
     3000`, behind a TLS-terminating reverse proxy (Caddy or nginx) on a real
     domain. Private Tailscale HTTPS (the pilot) is fine for recording but is
     not a public judge URL.
3. **RPC provider.** `https://test.rpc.fastnear.com` (used in QA) or another
   provider from https://docs.near.org/api/rpc/providers. Prefer it over
   `rpc.testnet.near.org` (stricter per-IP 429 observed). Rate limits apply per
   visitor IP because reads happen in each visitor's browser; the risk is the
   operator's own device during recording, so do not run QA from it first.
4. **Commit.** Deploy only the tagged, reviewed commit (checklist D).

### 8.2 Build-time environment (all public; set in the host's env UI, never committed)

```
NEXT_PUBLIC_TAPLY_NETWORK=near-testnet
NEXT_PUBLIC_TAPLY_CONTRACT_ID=taply-pay-pilot-1.testnet
NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH=BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B
NEXT_PUBLIC_TAPLY_RPC_URL=https://test.rpc.fastnear.com
NEXT_PUBLIC_TAPLY_RPC_PROVIDER_ID=fastnear-testnet
NEXT_PUBLIC_TAPLY_EXPLORER_BASE_URL=https://testnet.nearblocks.io
NEXT_PUBLIC_TAPLY_SHARE_ORIGIN=            # empty: the site's own HTTPS origin is used for QR links
NEXT_PUBLIC_TAPLY_FLAG_WALLET=on
NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=off     # on only for the operator's recording build
NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY=off
NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE=off
NEXT_PUBLIC_TAPLY_FLAG_MERCHANT=off
```

`NEXT_PUBLIC_*` values are inlined at **build** time: change one, rebuild.
Leave `NEXT_PUBLIC_TAPLY_API_BASE_URL` unset (no backend is used).

### 8.3 Pre-deploy checks (on the exact commit)

```sh
pnpm install --frozen-lockfile
pnpm check                                             # must exit 0
pnpm --filter @taply/web exec next build --webpack     # must exit 0
node apps/web/scripts/deploy-preflight.mjs post taply-pay-pilot-1.testnet --rpc https://test.rpc.fastnear.com
```

The preflight is read-only and must PASS (code hash `BrR6bioU…`).

### 8.4 Smoke test after deploy (read-only, two phones)

1. `https://<host>/` loads, header says **NEAR Testnet**, no console errors.
2. `https://<host>/pay/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502`:
   **Paid per contract**, 0.1 NEAR, Pay to `taplytest.testnet`, sale code
   `KED 5E9`, finalized block and "Contract code hash checked".
3. `/receipt/<same id>?ftx=CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su`: stays
   Paid per contract on a normal RPC and says why; **never** Verified Paid
   without the receipts.
4. `/demo` and `/demo/handshake` show the DEMO stamp.
5. With signing off, no **Approve in wallet** button appears anywhere.
6. Response headers include `strict-transport-security` (host) and the app's
   `x-frame-options: DENY`.
7. Phone camera: `/scan` asks for camera permission over HTTPS.

Rollback: redeploy the previous tagged build or take the URL down. Take-down
date: the human picks one on or after 2026-11-18 (ideally 2026-11-25).

## 9. 60-second demo film and exact screen-recording shot list (priority 11)

Tightened from `docs/PHASE_7G_DEMO_KIT.md` (which remains the long version and
the two-minute live walkthrough). Rules: everything shown as a payment is
**REAL** (fresh operator-approved Testnet sale); anything synthetic is shown
with the **DEMO** stamp visible or not at all; lime appears only on Verified
Paid. Never say "live Handshake", "verified merchant", "escrow", "refund",
"audited", "mainnet". The sale code is a "sale code", never a "security code".

### 9.1 Script (≈ 58 s, ≈ 125 words)

| # | Time | Picture | Voice | On-screen text |
| --- | --- | --- | --- | --- |
| 1 | 0:00–0:04 | `taply.` logo from `brand/assets` on Night `#0B120E` | — | Your wallet. Your payment. One tap. |
| 2 | 0:04–0:09 | Merchant phone, `/merchant` → **New sale** | "Paying a shop in crypto still means copying an address and trusting a screenshot." | Accept NEAR at the counter |
| 3 | 0:09–0:16 | Amount 0.1 → review → wallet approval → sale QR, **Ready for customer**, sale code | "With Taply, the merchant creates one unique sale, signed by their own wallet." | One sale. Signed on NEAR Testnet |
| 4 | 0:16–0:23 | Customer phone scans the QR; review card | "The customer scans it. The terms come from the contract, not from the QR." | Read from the chain |
| 5 | 0:23–0:29 | Split screen: same amount, Pay to account, sale code on both | "Both phones show the same amount, the same account, the same sale code." | Same sale on both phones |
| 6 | 0:29–0:35 | Customer ticks the check → **Approve in wallet** → wallet approves | "Nothing moves until the customer approves in their own wallet." | One approval. Their wallet |
| 7 | 0:35–0:42 | Merchant phone, untouched: **Payment observed** → **Paid per contract** | "The merchant's phone reads the finalized chain by itself." | No tap. No server says "paid" |
| 8 | 0:42–0:50 | Customer receipt **Verified Paid** (lime burst); merchant **Verify receipt** → **Verified Paid** | "Then each phone checks the funding, transfer and callback receipts itself." | Verified Paid, checked on each phone |
| 9 | 0:50–0:55 | Receipt **Technical proof** → the funding tx on testnet.nearblocks.io | "It's all public on NEAR." | (the new tx hash, as the app shows it) |
| 10 | 0:55–0:58 | Logo + line | "Taply. Payments you can check." | NEAR Testnet only · Built at NEAR HACKATHON |

Turkish voiceover option (same timing): "Kripto ile mağazada ödeme hâlâ adres
kopyalamak ve ekran görüntüsüne güvenmek demek. Taply'de satıcı kendi
cüzdanıyla tek bir satış oluşturur. Müşteri QR'ı okutur; koşullar QR'dan değil
kontrattan gelir. İki telefon da aynı tutarı, aynı hesabı, aynı satış kodunu
gösterir. Müşteri kendi cüzdanında onaylamadan hiçbir şey hareket etmez.
Satıcının telefonu kesinleşmiş zinciri kendisi okur. Sonra her telefon makbuzu
kendisi doğrular. Hepsi NEAR'da herkese açık. Taply. Kontrol edebildiğin
ödemeler."

### 9.2 Exact recording shot list

Setup: two phones (or two Chromium windows at 390×844, DPR 3), each with its
own external Testnet wallet; recording build with `INSTANT_PAY=on` (human
decision), FastNEAR RPC, the public HTTPS origin in
`NEXT_PUBLIC_TAPLY_SHARE_ORIGIN` if not hosted. Do-not-disturb on, battery and
clock visible but no personal notifications. Record each phone natively at
60 fps; compose side by side in edit.

| Shot | Device | Start on | Action | Hold on (end frame) | Seconds | Used in |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | Merchant | `/merchant` | none | Receiving account card + **New sale** | 3 | #2 |
| S2 | Merchant | `/merchant/register` | type `0.1`, reference `Demo`, **Continue** | review card with exact amount and 15-min window | 4 | #3 |
| S3 | Merchant | review | **Create request in wallet** → wallet approve | wallet confirmation | 4 | #3 |
| S4 | Merchant | `/pay/<id>` | none | sale QR, **Ready for customer**, sale code, Live pill | 4 | #3, #5 |
| S5 | Customer | `/scan` | point at S4 QR | "Payment found. Opening the request…" | 3 | #4 |
| S6 | Customer | `/pay/<id>` | none, then slow scroll | review card: amount, Pay to, sale code, Instant | 4 | #4, #5 |
| S7 | Customer | review | tick "I checked…", **Approve in wallet**, wallet approve | **Transaction submitted** | 5 | #6 |
| S8 | Merchant | `/pay/<id>` | **no touch** | **Payment observed** (if caught) → **Paid per contract**, "Paid by …" | 6 | #7 |
| S9 | Customer | receipt (auto-opened) | none | **Verified Paid** with burst | 4 | #8 |
| S10 | Merchant | `/pay/<id>` | **Verify receipt** | locator steps → **Verified Paid**, "No link from the customer was needed" | 8 | #8 |
| S11 | Either | receipt | **Technical proof** → tap the funding tx link | nearblocks page with signer = customer, receiver = `taply-pay-pilot-1.testnet` | 5 | #9 |
| B1 (backup) | Desktop | `apps/web/docs/screenshots/phase7h/` | — | `en-merchant-paid-390`, `en-customer-receipt-390` (REAL, archived pilot) | — | only if a live shot fails; caption "archived pilot payment, 2026-11-01" |

If the merchant check says "This payment is too old for this RPC" or "Could
not search the chain", keep it in: say "it falls back to Paid per contract",
then open the customer's **Copy verification link** on the merchant phone.
**Never retry the payment** on camera.

### 9.3 Submission description draft (`idea`, human edits, 20–2000 chars)

> Taply turns a NEAR Testnet wallet into a merchant point of sale you can
> check yourself. The merchant signs one on-chain payment request per sale
> (exact amount in yoctoNEAR, receiving account, expiry) on Taply's own NEAR
> contract. The customer scans the sale QR; their phone reads the terms from
> the contract at a finalized block, shows the same amount, account and sale
> code as the merchant's phone, and pays with one approval in their own
> external wallet. The contract pays the merchant in the same flow. Neither
> phone trusts a server or a socket event for "paid": each re-reads the
> finalized chain, and Taply's independent receipt verifier checks the
> funding, transfer and callback receipts, code hash and access keys before it
> says Verified Paid. The merchant phone can find the payment on chain by
> itself. Testnet only; live Handshake sessions and Protected Pay are not
> shipped yet and are labelled as such.

(≈ 900 characters.) Track: `realworld`.


## 10. Remaining blockers

Human decisions or actions (none can be done by an agent):

1. **LICENSE** file (Q-014). Recommendation for approval: MIT.
2. **Judged branch/tag.** `main` (`86bd54b`) lacks Phases 4–7H. Review, push,
   PR, merge, tag `hackathon-submission`, fix the README placeholder.
3. **Demo video + X post** (required). Needs one fresh, human-approved Testnet
   sale on two phones.
4. **Submission payload** and consent, by the human, before
   2026-11-14 23:59 UTC.

Engineering, not blocking the Instant Pay submission:

5. **Rust checks BLOCKED** here: default-build byte equality with the approved
   pilot hash, `cargo test`, Clippy, candidate builds, sandbox suites
   (7G "Exact next steps" 1). The deployed pilot's code hash was re-checked
   read-only today (10/10 PASS), so the running contract is the approved one.
6. **No physical-device run in 7H**; Android still untested; the 6C iPhone
   receipt JSON is still not archived.
7. **Public RPC throttling** can make a demo device show "could not check"
   (fail-closed). Mitigation: FastNEAR or another provider, no heavy QA on the
   recording device beforehand.
8. **No CSP** in the app's headers (HSTS comes from the host). A CSP must be
   tested against NEAR Connect wallet iframes/popups before it ships.
9. **Old receipts on FastNEAR** with the customer link read as "Could not
   verify yet" instead of "too old for this RPC" (verifier transport maps the
   pruned-history timeout to transient; core-owned verifier, unchanged).
10. `deploy-preflight.mjs` reports throttled view calls as plain FAIL ("no
    response") without the HTTP status; harmless (fail-closed) but confusing.
11. G2 / live Handshake gates from 7G, unchanged: candidate contract sandbox and
    security review, approved deployment, production NEP-413 auth,
    rollback-fresh storage, HTTPS/ACL/recovery, frontend wiring.

## 11. Exact human acceptance steps

Run in `C:\taply-phase7h-release` (or a fresh clone at the final commit).

1. Verify the branch and history:
   ```powershell
   git log --oneline f3d15ac..HEAD
   git diff --stat f3d15ac HEAD -- apps/api contracts/payments packages/near-client   # must print nothing
   git ls-files | Select-String "\.env"                                              # only apps/web/.env.example
   ```
2. Re-run the gates (no `.env.local` present):
   ```powershell
   pnpm install --frozen-lockfile
   pnpm check
   pnpm --filter @taply/web exec next build --webpack
   ```
   Expect exit 0 and the totals in section 6.
3. Read-only contract check:
   `node apps/web/scripts/deploy-preflight.mjs post taply-pay-pilot-1.testnet --rpc https://archival-rpc.testnet.near.org`
   → "All checks passed. Nothing was signed or sent."
4. Judge path: create `apps/web/.env.local` from README section B (signing
   **off**), `pnpm --filter @taply/web build`, `pnpm --filter @taply/web start`,
   then on a phone-width window:
   - `/pay/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502`
     → Paid per contract, 0.1 NEAR, `taplytest.testnet`, `KED 5E9`; the legend
     says "Contract record: paid" / "Verified Paid: Not checked on this screen";
     no Approve button.
   - `/receipt/<same id>` → Paid per contract + "too old for this RPC"; the
     note under it does **not** say "Open the receipt".
   - `/demo` → DEMO stamp; step buttons are comfortably tappable.
   - `/s/00000000-0000-4000-8000-000000000001` → "Live Handshake is not
     available yet".
5. Failure UX: turn the network off in DevTools on `/pay/<id>` and press
   **Check again** → exactly one retry control, honest notices, no status guess.
6. Screen reader (VoiceOver/NVDA) on a receipt that verifies: the outcome is
   announced once.
7. Skim `apps/web/docs/screenshots/phase7h/` and the two raw JSON files.
8. Decide checklist items C–G in `docs/PHASE_7H_RELEASE_CHECKLIST.md`.
9. Only then: push `feature/phase7h-release`, open the PR, merge, tag.
10. Recording day: approve one fresh Testnet sale on two phones with the
    signing build and follow the shot list in section 9.2.

