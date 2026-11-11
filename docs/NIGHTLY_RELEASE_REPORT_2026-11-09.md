# Nightly release report — 2026-11-09

> **Archived status report.** This file records what was true on the date in its
> title or sections and is kept unchanged as history. It is not the current status.
> Current status (2026-11-11): payments are signed on taplyapp.xyz, the live two-phone
> Handshake and Protected Pay (Testnet escrow, not audited) are on. Authoritative:
> [README](../README.md) and [VERIFICATION_MATRIX.md](VERIFICATION_MATRIX.md).

Autonomous overnight sprint by Claude Code on DESKTOP-SDAI72B
(`C:\taply-monday-sprint`), under the owner's written delegation. Every result
below was observed in this run unless it says "historical".

**Overall: CONDITIONAL GO.** The public read-only Testnet release on
https://taplyapp.xyz is GO. Public payment signing is **NO-GO until the owner
runs the signed G1 acceptance** on the protected QA build (it needs the owner's
own wallets; nothing was signed tonight).

## 1. Revisions

| Item | Value |
| --- | --- |
| Released source | `b67b278250736c99162d2c71cc467a7eddb8f09a` (code); the commit carrying this report is on the same branches, docs only |
| `release/taplyapp` (Vercel production branch) | fast-forwarded `fef6a2f` → `b67b278` (no force) |
| `main` (GitHub default) | fast-forwarded `86bd54b` → `b67b278` (no force) — judges now clone the released app |
| `feature/monday-testnet-sprint` | same as `release/taplyapp` |
| `qa/g1-signing` (new, protected QA) | same code as the release |
| PR #11 (`feature/final-integration-review` @ `e6d0890`) | Its head is an ancestor of the release, so GitHub marked it **merged** automatically when `main` moved. No merge commit, branch and review history untouched |
| Production deployment | `dpl_56BfmSLPGFfrYM2H3RUzJ4TGPjFC` (Git source `release/taplyapp` @ `b67b278`, READY) on `taplyapp.xyz`, `www.taplyapp.xyz` |
| Previous production (rollback target) | `dpl_mybW8sqwKCNc8uMQETrQMsTeEPEv` (`fef6a2f`) |
| QA build (signing on, protected) | `dpl_2QxkRW438NUETLmGmAGKzHha8wgz` → https://taply-git-qa-g1-signing-kendinecryptos-projects.vercel.app |

Commits in this sprint (all on top of `fef6a2f`):

| SHA | Change |
| --- | --- |
| `150f642` | Never call the public app a "Preview": "Payments not enabled yet" / "Ödemeler henüz açık değil"; sending copy; "View checkout"; EN/TR dictionary regression |
| `5ebf406` | Release smoke can reach a protected Vercel Preview (OIDC header only to the Preview origin) |
| `4331c22` | **CI fix**: `workspace-check` failed on the release head because the API tests load the Handshake reader directly and could not resolve the `@/` alias from the F-05 fix, and Node type stripping rejected a parameter property. Relative `.ts` import + explicit field; no behaviour change |
| `7eaf0f5` | Same "Payments not enabled yet" message on the payer screen |
| `b67b278` | Launch documentation (README, judge guide, checklist, demo plan, readiness, evidence ledger, acceptance plan, submission package) |

## 2. Production state (Priority 0)

- `https://taplyapp.xyz` 200 without login; `www` and HTTP → 308 apex. Let's
  Encrypt certificates (apex and www), valid to 2027-02-06.
- Headers: CSP with per-request nonce + `strict-dynamic`, HSTS
  `max-age=63072000`, `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy` (camera self only),
  COOP `same-origin-allow-popups`. HTML `no-store`.
- Robots: `noindex, nofollow` meta (deliberate); no `robots.txt`/sitemap.
- PWA: manifest, 192/512/maskable icons, apple-touch-icon served. **No service
  worker**, so no stale cached build can be served.
- Production env (15 values, Production scope only): `near-testnet`,
  `taply-pay-pilot-1.testnet`, code hash `BrR6bioU…`, FastNEAR RPC, archival
  verifier RPC, share origin `https://taplyapp.xyz`, CSP enforce. Flags:
  wallet `on`; Instant Pay, merchant, Handshake, Protected Pay `off`.
  Verified in the live JS bundle after the update.
- Vercel: production branch `release/taplyapp`; Ignored Build Step skips every
  production build from any other branch (so `main` can never go live by
  accident; the `main` push tonight produced only a protected Preview).
  Previews keep Vercel Authentication.

## 3. G1 Instant Pay readiness (Priority 2)

Code re-audit of the signing path (AI review in this session, not a human or
external audit):

- `submitCall` journals before the wallet opens, under a cross-tab lock; no
  journal → no signing.
- After the SDK is invoked, every throw, malformed result, missing or
  ill-formed hash records `OUTCOME_UNKNOWN` (blocking). Only local pre-dispatch
  checks (no wallet / other account) record the single non-blocking state
  `USER_REJECTED` + `notDispatched`. Legacy entries without that evidence read
  back as blocking. Wallet decline text is never trusted (F-01 fix intact).
- Transaction hashes must match the base58 32–44 pattern; redirect parameters
  are hints only, matched to journal entries after an on-chain read, never
  authority to unblock.
- Reconciliation resolves only on verified final, non-stale RPC reads
  observed after the attempt started; creation resolves on absence only after
  the signed funding expiry.
- Signing additionally requires the contract code hash and config to verify
  at a fresh final block, and the reviewed config to be unchanged right before
  the wallet opens.

Tests: wallet/payments/verify/payment UI suites 546 passed (1 opt-in live
skip); full web suite green in CI on `b67b278` (73 test files, 1 skipped; locally 1,112 tests passed on `150f642`). Read-only contract preflight: 10/10 PASS.

**Not done (BLOCKED, needs the owner's wallets):** a fresh signed G1 run
(create, decline, pay, wallet return, Verified Paid) on a real device. Nothing
was signed, no key was touched. The protected QA build is ready for it:
signing on there, verified up to the enabled "Create request in wallet" button
(not clicked). Procedure and required evidence:
[TESTNET_ACCEPTANCE_PLAN.md](TESTNET_ACCEPTANCE_PLAN.md).

## 4. CI on the exact release head `b67b278`

| Workflow | Run | Result |
| --- | --- | --- |
| workspace-check (dispatch) | 42531224977 | success: `pnpm check` (shared 92, near-client 207, web 73 files / 1 skipped), standalone API 68, Webpack build |
| wallet-browser-check (dispatch) | 42531227316 | success |
| instant-pay-sandbox (dispatch) | 42531229691 | success: G1 15 unit + sandbox suite; WASM SHA-256 `a13d932f…`, code hash `BrR6bioU…`, 345541 bytes, 12 ABI exports |
| workspace-check (push to `main`) | 42531865803 | success |
| instant-pay-sandbox (push to `main`) | 42531865844 | see GitHub (started after the main update) |

Before the fix, `workspace-check` failed on `5ebf406` (run 42530189583); it has
passed on every head since `4331c22`.

## 5. Production smoke (Priority 5)

All against https://taplyapp.xyz after the update (`b67b278`), read-only:

| Check | Result |
| --- | --- |
| WebKit 390 px + 1280 px, full harness | **56/56 PASS**, 0 broadcasts |
| Firefox 390 px | **29 PASS, 1 BLOCKED, 0 FAIL**: the live receipt re-check could not reach the archival RPC from Firefox (CORS-blocked answer, known since 2026-11-08), so the page stayed **Paid per contract** and showed the 2026-11-01 result as a labelled archive. Honest fallback, no false Verified Paid |
| Chromium 390 px (on `fef6a2f`, before tonight's update) | 31/31 PASS |
| Fresh visit on a Turkish browser → English; Turkish/English choice survives restart; 11 routes each | 44/44 (on `fef6a2f`; the locale code did not change since) |
| Request review, signing off, EN/TR | "Payments not enabled yet" / "Ödemeler henüz açık değil", button disabled, no overflow |
| Pilot receipt | **fresh** Verified Paid (live re-verification of the 2026-11-01 payment) |
| Malformed links (`/pay/deadbeef`, upper-case IDs, script in `ftx`/`memo`/`step`, `/checkout/not..valid`, `/s/garbage`, 3000-char path) | no 500; nothing reflected as HTML (one value appears only JSON-escaped inside Next's data script) |
| Old copy in the live bundle | 0 × "Preview · Transactions off", 0 × "Transactions are switched off" |

The harness also covers offline/reload, back/forward restore, synthetic RPC
outage, unknown request, malformed ID, CSP violations and the DEMO separation.

## 6. Documentation (Priority 4)

README (live site first, honest feature table, build commands, license, diff
section, AI disclosure), JUDGE_QUICK_START, SUBMISSION_CHECKLIST, RELEASE_DEMO,
RELEASE_READINESS (current-state header, history kept), EVIDENCE (new
2026-11-08/09 production section; earlier entries untouched),
TESTNET_ACCEPTANCE_PLAN (protected QA build), HACKATHON_SUBMISSION_PACKAGE (new).

## 7. Hackathon package (Priority 6)

Rules re-read 2026-11-09: deadline **2026-11-14 23:59 UTC**; hosted demo is a
plus and must stay up through 2026-11-18. X post draft (277/280), reply, form
text (979 chars), track `realworld` and link checklist:
[HACKATHON_SUBMISSION_PACKAGE.md](HACKATHON_SUBMISSION_PACKAGE.md).
**BLOCKED:** the 60-second video is not in the repository, so its claims could
not be checked. Nothing was posted or submitted.

## 8. Open items

| Item | State |
| --- | --- |
| Fresh signed G1 acceptance (owner wallets, 2 devices) | BLOCKED on owner |
| Public signing in production | OFF until the item above passes |
| Video review | BLOCKED (file not available) |
| F-02 `main` branch protection | OPEN (settings change for the owner) |
| F-03 CI path coverage policy | OPEN |
| F-06 production auth for G2 | OPEN, G2 disabled |
| F-04 dev-dependency advisory | No production impact (`pnpm audit --prod` clean) |
| Android physical device | Untested |
| Old failed CLI production record `dpl_FgLp…` | Kept; delete only with owner approval |

## 9. Rollback

- Fast: `vercel rollback dpl_mybW8sqwKCNc8uMQETrQMsTeEPEv --scope kendinecryptos-projects`
  (Instant Rollback to the previous production build, no rebuild). Candidate
  checked READY/production before the update.
- Source: push the previous commit to `release/taplyapp` is **not** possible
  without force; instead revert the commit on the sprint branch and
  fast-forward `release/taplyapp`.
- Domain: remove `taplyapp.xyz` from the Vercel project, or re-enable
  forwarding at Unstoppable Domains.
- QA build: delete the branch-scoped Preview variable
  `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY` for `qa/g1-signing`, or the branch.

## 10. Owner morning checklist (5 minutes)

1. iPhone Safari → https://taplyapp.xyz: English, no login; Request → amount →
   Continue shows "Payments not enabled yet" under a disabled button.
2. Open the pilot receipt link from the README: Verified Paid (or a labelled archive).
3. GitHub: https://github.com/KendineCrypto/taply opens on `main` with the new
   README.
4. Decide: run the signed G1 acceptance on the QA build today
   ([steps](TESTNET_ACCEPTANCE_PLAN.md)) — about 20 minutes, two Testnet
   accounts, ≤ 0.05 Testnet NEAR.
5. Record/confirm the video, then post on X and submit (owner only).
