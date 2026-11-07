# Monday Testnet sprint report (2026-11-07 → 2026-11-08)

Engineering lead: Claude Code (frontend owner per `CLAUDE.md`). All changes are
in `apps/web/**` and `docs/`. Nothing was pushed, merged, deployed or published.
No wallet signature, transaction, contract deployment or spending happened.

- Branch: `feature/monday-testnet-sprint` (new worktree `C:\taply-monday-sprint`)
- Base: `feature/final-integration-review` @ `e6d0890a6a85b7c4c2c6fc44614c74fc06f4a396` (PR #11 untouched)
- Release gate and checklists: [`MONDAY_RELEASE_GATE.md`](MONDAY_RELEASE_GATE.md)

## 1. Commits

| Commit | Scope |
| --- | --- |
| `8558f3f` | Phase C: honest, bounded Testnet RPC reads (429, back-off, immutable cache, archived-record fallback, verifier RPC split) |
| `8d38ce0` | Phase D: enforced nonce CSP, wallet nonce hand-off, Zod jitless, reusable `scripts/release-smoke.mjs` |
| `26eda1d` | E1: Taply Contacts |
| `a92e124` | E2 + E3: recurring request templates, Split Pay MVP (also: Zod import ordering fix, harness probe classifier) |
| `a61dd8e` | F-05: bounded body reads for Handshake seams; CSP allows wallet web fonts |
| `1cc8a9f` | E4: new tools reachable from the account menu |
| (docs commit) | This report and `MONDAY_RELEASE_GATE.md` |

## 2. Environment and stability (Phase A)

- Host: ~7.8 GB RAM, ~15 GB free disk. Free RAM at start: **400 MB** (Edge,
  other Claude/Codex sessions). Commit charge stayed below the limit throughout.
- Stopped exactly the two prior Taply servers after verifying their command
  lines (PID 12056 `next start -p 3207`, PID 24616 `next start -p 3100`, both
  `C:\taply-final-integration\apps\web`). Nothing else was stopped.
- One server and one browser at a time; each browser closed after its run.
  Every server I started was stopped again before rebuilding.
- Install: `pnpm install --frozen-lockfile --offline` (store hit, 336 packages, no download).

## 3. Automated results (actual)

| Check | Command | Result |
| --- | --- | --- |
| Web unit/UI tests (full) | `npx vitest run` in apps/web at `a92e124` | **PASS 1,098 / 1 opt-in skip** (72 files). After that, only focused runs: `lib/net`+`lib/handshake` 65 PASS, `components/shell` 11 PASS, `lib/security` 10 PASS. A full re-run at `1cc8a9f` was NOT done (memory) |
| Web typecheck | `npx tsc --noEmit` (apps/web) | PASS |
| Web lint | `npx eslint .` (apps/web) at `a92e124`; focused `eslint` on every later change | PASS, 0 problems |
| Root check | `pnpm check` | **NOT RUN** (see §3.1) |
| Vercel-like build | `pnpm --filter "@taply/web..." run build` (clean `dist/`) | PASS: shared + near-client + Next 24 routes + Proxy |
| HTTP sweep (prod build) | 27 URLs | 27× 200; unknown route 404 |

New test files: `lib/verify/__tests__/rpc-faults.test.ts` (24),
`components/payments/__tests__/receipt-rate-limit.test.tsx` (5),
`lib/security/__tests__/csp.test.ts` (10), `lib/contacts/__tests__/contacts.test.ts` (35),
`components/contacts/__tests__/contacts-ui.test.tsx` (11),
`lib/recurring/__tests__/recurring.test.ts` (40), `lib/split/__tests__/split.test.ts` (38),
`components/split/__tests__/tools-ui.test.tsx` (6), `lib/net/__tests__/bounded-body.test.ts` (9).
Three older tests that asserted "HTTP 429 → RPC_UNAVAILABLE" were updated to the
new `RATE_LIMITED` code; the property they protect (a 429 never counts as missing
history) is still asserted.

### 3.1 Root `pnpm check`

**NOT RUN.** Free RAM was 400–650 MB for most of the session and Claude Code stopped the final
background browser pass for low memory, so the full workspace check (all package builds,
typechecks, lint and tests) was not started. Packages were not modified by this sprint;
`@taply/shared` and `@taply/near-client` were rebuilt successfully by the Vercel-like build.
Run `pnpm check` on a machine with free memory before review.

## 4. Browser runtime (actual, production build, read-only)

Harness: `apps/web/scripts/release-smoke.mjs` (moved from the scratchpad and
extended). Injected read-only wallet throws on every sign method; any RPC
`broadcast`/`send_tx` is aborted and reported; external non-GET requests other
than the Testnet RPC hosts are aborted; every CSP violation in every frame is
captured. Viewports 390×844 (mobile emulation) and 1280×800.

| Run | Build | Result |
| --- | --- | --- |
| Firefox baseline | `e6d0890` (unchanged base) | 36 PASS / 6 FAIL — all 6 chain steps, CORS-blocked 429s from archival RPC (BLOCKED in today's terms) |
| WebKit | sprint, Phase C (pre-CSP) | **44/44 PASS**, incl. a **fresh Verified Paid** of the pilot via archival RPC; 0 broadcasts |
| Firefox | CSP build | functional checks pass; Zod eval probe found and fixed |
| Firefox | RC (E1–E3) | 53 PASS, 2 FAIL (harness text check, fixed), 1 BLOCKED (archival 429, honest archive fallback shown); tool routes 12/12 PASS on re-run |
| Final Chromium | RC `1cc8a9f` | **Partial: 23/23 steps run PASS** (mobile 390: landing EN/TR, locale switch, wallet selector, tool routes EN/TR, merchant, store QR, historical pay EN/TR, DEMO flow, **fresh Verified Paid**), 0 FAIL/BLOCKED, then stopped by Claude Code for low system memory |
| Final WebKit / Firefox | RC `1cc8a9f` | **NOT RUN** (stopped before start, low memory). Latest results on code without only the F-05/menu changes: WebKit 44/44 (Phase C build), Firefox 53/2/1 + tools 12/12 (E1–E3 build) |

BLOCKED means a chain-dependent step failed while the RPC visibly throttled
(HTTP 429 or a CORS-blocked answer). It is not a pass.

WebKit emulation is **not** iPhone acceptance. Physical iPhone: **NOT RUN**.

## 5. Phase C — RPC reliability (implemented)

Findings: `archival-rpc.testnet.near.org` answered this IP with `429` and
`Retry-After: 335`, **without `Access-Control-Allow-Origin`**, so browsers see
an opaque network error; `Retry-After` is not CORS-exposed either. FastNEAR and
`rpc.testnet.near.org` send CORS headers.

Implemented (all in `apps/web/src/lib/verify/`):
- `RATE_LIMITED` transport error with clamped Retry-After (2 s–10 min, default 30 s);
  one shared cool-down for verifier + locator; calls inside it fail fast with no traffic.
- Opaque failures back off 2 s → 60 s (reset on success), reported as
  unavailable, never as rate limited (we could not see it).
- Immutable-answer cache (same tab, memory only): blocks/chunks by hash, state
  queries pinned to a block hash, FINAL tx status. `status` and latest-final
  reads always go to the network, so network identity and current state are
  re-checked on every run (tested).
- Verifier reason `RATE_LIMITED` (transient). Auto re-check 2 s / 8 s / 30 s;
  honours Retry-After; never auto-retries a wait over 60 s.
- Receipt: "RPC busy" copy (EN/TR) with next-check time; separate dashed
  **"Archived · not a live check"** panel for the 2026-11-01 verifier JSON, shown
  only after today's check ended without Verified Paid and only when contract,
  approved code hash and the live terms hash match. Byte-identical copy served
  at `/evidence/instant-pay-2026-11-01-receipt.json` (test-enforced). It never
  sets a receipt status or the Verified Paid ribbon.
- Optional `NEXT_PUBLIC_TAPLY_VERIFIER_RPC_URL/_PROVIDER_ID` (half-set or unsafe → fail closed):
  routine reads on FastNEAR, only verification on archival. Effect in WebKit:
  pay page 27 s → 3 s; 179 FastNEAR vs 12 archival calls.

Four states stay distinct: Paid per contract · Verified Paid (fresh, this
session) · Archived verification (labelled) · Unknown/unavailable.
No code-hash, genesis or verifier check was relaxed.

## 6. Phase D — security and PWA

- **CSP (enforced):** per-request 128-bit nonce via Next 16 `proxy.ts`;
  `script-src 'self' 'nonce-…' 'strict-dynamic'` (no `unsafe-inline`, no
  `unsafe-eval` in production), `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`, `frame-ancestors 'none'`. `connect-src`/`img-src`/
  `frame-src`/`style-src`/`font-src` allow `https:` because wallet executors run
  in srcdoc iframes that inherit the policy and call their own backends and fonts.
- **Wallet check:** Meteor Wallet executor booted under the enforced CSP in
  Chromium (no script violation in its frame; its POST was aborted by the
  harness). Only its web-font stylesheets were blocked → now allowed.
- **Known benign report:** one blocked `eval` from the `is-generator-function`
  capability probe in Next's `util` polyfill (pulled in by `near-seed-phrase`,
  Taply-Wallet vault code that is disabled but loaded by the layout). It is
  try/catch-wrapped; the harness only accepts it when that exact code is at the
  reported chunk position. Zod's probe was removed (`jitless`).
- **HSTS:** off unless `TAPLY_HSTS_MAX_AGE` is set; never `includeSubDomains`/`preload`.
- **Kill switch:** `TAPLY_CSP_MODE=report-only|off` (server-only).
- Share origin already refuses localhost, IPs, private names and non-HTTPS;
  smoke confirmed no localhost links. PWA manifest, icons, `standalone`, theme
  colours present; no service worker (by protocol decision).

## 7. Features (E1–E4)

| Feature | Implemented | Automated tested | Live Testnet verified | Human acceptance | Release status |
| --- | --- | --- | --- | --- | --- |
| RPC 429/back-off/cache/archived fallback | Yes | Yes (fault injection, UI) | Partly: fresh Verified Paid in WebKit; honest fallback seen under real 429 in Firefox | No | Ship |
| Enforced CSP + nonce wallet hand-off | Yes | Yes (unit + 3 browsers) | n/a | No (iPhone pending) | Ship, kill switch |
| Contacts (E1) | Yes | Yes (46 tests) | n/a (local only) | No | Ship, kill switch |
| Recurring templates (E2) | Yes (prepare-only) | Yes (40 + UI) | No (signing off) | No | Ship as planning tool, kill switch |
| Split Pay MVP (E3) | Yes (prepare + status + verify) | Yes (38 + UI) | No (no child request exists on Testnet) | No | Ship as preparation mode, kill switch |
| Merchant polish (E4) | Minimal: navigation; existing flows re-verified by smoke | Yes (smoke) | Historical pilot only | No | Ship |
| F-05 bounded Handshake reads | Yes | Yes (9) | n/a | No | Merged in branch; seams still unwired |
| Live Handshake (G2) | No (unchanged) | existing | No | No | **Off** |
| Protected Pay (G3) | No (unchanged) | existing | No | No | **Off** |

E1 Contacts: exact account IDs only, `.near` refused, hidden/bidi label
characters refused, case/width-insensitive duplicate labels, lookalike
detection (1/l, 0/o, rn/m, `_`/`-`, one edit, same start+end) requiring "I
checked every character", explicit old→new confirmation for account changes,
damaged storage never overwritten. Send picker copies the exact string (T21).

E2 Recurring: civil dates in the template's IANA zone, month-end clamping,
leap years, DST-safe; prepare = pre-fill only; occurrence linked to the
submitted request ID (also on unknown outcome) so it is never offered twice.
Not a subscription; nothing runs in the background.

E3 Split: BigInt yocto shares, remainder 1 yocto at a time, custom shares must
add up exactly; one independent request per share (optional payer
restriction); shares lock once a request exists; per-share chain read checked
against the plan (mismatch never counts); per-share on-demand independent
verification; group complete only when every share is Verified Paid.

## 8. Phase F — Handshake and Protected Pay (assessment)

- **F-05 fixed** (bounded streaming reads, regressions). Seams remain unwired.
- G2 still blocked by **F-06** (no production freshness/anti-rollback
  authority, durable auth not accepted) and by the G1 contract's inability to
  bind a session (`handshake:false`). Smallest safe next slices: (1) an
  authenticated session read behind the existing room reducer with the bounded
  reader, in DEMO routes only; (2) an external freshness authority design
  review. Nothing was deployed or activated.
- Protected Pay: G1 reports `protectedPay:false`; the merchant/escrow candidate
  in `contracts/payments-merchant` is unapproved. Smallest independently
  testable slices: sandbox tests for cancel-before-cutoff refund, release-after-
  cutoff payout, and callback-failure reconciliation (still unresolved per
  ADR-005) — all contract-side, not touched in this sprint.

## 9. Security findings this sprint

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| M-01 | Medium | Archival RPC 429s lack CORS headers: browsers cannot distinguish throttling from outage | Mitigated (back-off, split RPC, honest copy) |
| M-02 | Low | No CSP on the base branch | Fixed (enforced nonce CSP) |
| M-03 | Low | Two library eval probes trip a strict CSP (Zod; is-generator-function via `near-seed-phrase` util polyfill) | Zod fixed; other documented as benign. Follow-up: lazy-load Taply-Wallet vault code |
| M-04 | Low | Disabled Taply-Wallet vault/seed code ships in every page's bundle | Open (follow-up; feature remains disabled) |
| M-05 | Info | Older tests contain literal bidi/zero-width characters in string literals | Open (intentional test inputs; prefer `\u` escapes) |
| F-05 | Medium | Unbounded Handshake reader bodies | Fixed |

No secrets found. No dependency added or changed.

## 10. Remaining risks

See [`MONDAY_RELEASE_GATE.md` §6](MONDAY_RELEASE_GATE.md#6-remaining-risks-ranked).
Also: the sprint code is unreviewed; physical iPhone acceptance not done; no new
live payment evidence (only the historical pilot).

## 11. Proposed final release commit and deploy procedure

1. Independent review of `e6d0890..feature/monday-testnet-sprint` (apps/web + docs only).
2. Human pushes the branch and opens a Draft PR **separate from PR #11** (do not rebase or force-push PR #11).
3. Vercel Preview from that branch with §5 settings of the gate document.
4. Post-deploy checks + real-iPhone checklist on the Preview URL.
5. If all pass, promote to Production on `taplyapp.xyz`; set `TAPLY_HSTS_MAX_AGE=86400`.
6. Any field problem: flip the relevant kill switch (gate §3) and redeploy.
