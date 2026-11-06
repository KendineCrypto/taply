# Phase 7G: premium two-device checkout, merchant Verified Paid, demo readiness

2026-11-05. Worktree `C:\taply-phase7g-ux`, branch `feature/phase7g-ux`, base
`5999d0c` (Phase 7F integration). `apps/web`, `README.md` and
`docs/PHASE_7G_DEMO_KIT.md` only. **No change** to `contracts/**`,
`apps/api/**`, `packages/**`, `pnpm-lock.yaml`, flags or env files. No new
dependency. No transaction sent, nothing deployed, pushed, published,
submitted or merged.

## Commits

| Commit | Stage | Summary |
| --- | --- | --- |
| `5f375cf` | 1–2 | Canonical two-phone status; leaner Paid per contract; merchant home and checkout clean-up |
| `5e661ae` | 5 | Merchant-side Verified Paid via read-only funding locator |
| `213fca7` | 3 | Evidence-led, compositor-friendly motion |
| `419916b` | 4 | Versioned Handshake room adapter boundary (gated, DEMO-previewed) |
| `2ed177c` | 9 | Locator background-tab / account-switch tests |
| `1c71088` | 7–8 | Demo kit and README |
| (this commit) | 6, 9 | Browser QA script, screenshots and this report |

## Stage 1: audit findings and what changed

Baseline: production build at `5999d0c`, 390 px, real pilot data.

| Finding | Fix |
| --- | --- |
| Paid per contract said four times on one screen (title, body, legend, contract badge), plus a second explanatory paragraph | Paragraph and badge removed at this stage; one "Verified Paid: not checked on this screen" row remains next to "Paid per contract" |
| The primary next step (View receipt) sat below the fold, under the nav bar | The action moved into the hero's proof row: **Verify receipt** (merchant) / **Check receipt** (customer), above the fold at 390 px |
| Merchant home: two full disabled tiles + a five-line caution notice before the sales list | One quiet inert "Coming later" row and one muted line |
| Checkout: three stacked notices (what this proves, no listing, signs nothing) | One "What this page proves" notice with all three facts |
| Waiting state animated the Wallet step as if something happened there | No ripple while awaiting (Stage 3) |
| Merchant phone could not reach Verified Paid without the customer's link | Stage 5 locator |

Kept on purpose: the Store QR vs sale QR split, collapsed request details,
the amount shown once per screen, the brand palette and typography.

Not changed (follow-up): the RPC-down pay screen shows two retry controls
("Try again" for the contract check, "Check again" for the request); a single
retry would be clearer.

## Stage 2: one payment on two phones

Both phones render the same hero for the same request: amount, Pay to
account, sale code, five-step timeline and now **one canonical status**
(`journeyStatus`, `lib/merchant/journey.ts`).

| Stage (chain/verifier) | Merchant phone | Customer phone |
| --- | --- | --- |
| OPEN | Ready for customer | Ready to review, or **Checking chain** if this device's own pay attempt is unexplained |
| OPEN + this device's wallet open | (n/a) | Awaiting wallet approval |
| PAYOUT_IN_FLIGHT | Payment observed | Transaction submitted |
| FINAL_PAID | Paid per contract | Paid per contract |
| FINAL_PAID + verifier `verified` | Verified receipt available | Verified Paid |
| failed / unresolved / cancelled | Needs attention / Closed | Needs attention / Closed |

Rules enforced in code and tests: statuses come only from the existing
evidence-based stage plus this device's journal; never from a scan, a timer
or the other phone. A verified status passed with a non-verified stage is
replaced. Only verified statuses use lime. No live hero says joined,
connected or online. Handshake-specific states exist only in the gated room
adapter (Stage 4). The sale code is labelled a sale code only.

## Stage 3: motion

CSS only. The hero's breathing glow moved from an animated `box-shadow`
(full repaint each frame) to an opacity-animated inner layer. Added: a gold
pulse along the timeline only at PAYOUT_IN_FLIGHT, a one-time settle pop on
the Contract step at Paid per contract, a one-time sweep across the terms
when the payer confirms them, a single fade per status change (identical
updates replay nothing). The amount glow runs twice, then rests. The verified
glow and burst stay one-time. The existing scanner recognition (corners close
and success mark) and the one-time Verified Paid burst are unchanged.

Under `prefers-reduced-motion` every effect has an explicit still state
(browser-measured: `animation-name: none` for hero, glow, status, connect and
settle). No motion uses the device clock.

## Stage 4: Handshake room adapter (gated)

`lib/handshake/room.ts`, `RoomStatusPanel`, DEMO preview on `/demo/handshake`.
Handoff for Codex: [`PHASE_7G_HANDSHAKE_ADAPTER.md`](PHASE_7G_HANDSHAKE_ADAPTER.md).
Real Handshake stays off: flag off, no backend adapter, no route wired; a
source-scan test enforces it.

## Stage 5: merchant-side Verified Paid

**Problem:** only the payer's device knew the funding transaction hash, so the
merchant stopped at Paid per contract until it received the customer's link.

**Read-only evidence path (implemented):** the contract stores `fundedAtNs`,
which equals the timestamp of the block that executed the payer's
`pay_instant_native` receipt (verifier check 8 already requires this).
`lib/verify/locate-funding.ts`:

1. reads the final block, then interpolation-searches heights (BigInt) for the
   block whose timestamp equals `fundedAtNs` exactly;
2. scans the new chunks of that block and the three before it for a
   transaction signed by the recorded payer, sent to the contract, with
   exactly one `pay_instant_native` call for this request ID;
3. hands the hash to the **unchanged** independent verifier as a candidate,
   exactly like a `?ftx=` link hint.

Bounded (≤ 48 calls), separate `block`/`chunk`-only transport (verifier
allowlist untouched), runs once per paid request, waits while the tab is
hidden, stores nothing. A wrong candidate can only produce "not verified".

**Real result:** against the pilot payment (2026-11-01) via
`archival-rpc.testnet.near.org`, the locator found exactly
`CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su` in block 275767732 from contract
state alone (6 calls to find the block, opt-in live test). In the production
browser build the merchant phone (no journal, no link) reached **Verified
Paid** with "No link from the customer was needed" (see Stage 6).

**When it cannot:** history pruned (non-archival RPCs keep about two days:
`history_unavailable`), RPC failure (`unavailable`, Search again), no match
(`not_found`), payouts that needed a retry (`not_applicable`: each retry hash
is required). In every case the receipt stays **Paid per contract** and says
why. No guessed hashes, no fake receipts.

**What full independent merchant-side verification still needs** (no new
service was introduced):

- An RPC that retains the payment window (archival, or check within ~2 days).
  For production, a configured archival endpoint with CORS, or a reviewed
  indexer/proof service (needs coordination; not built).
- Retry coverage: either the contract records each operation's transaction
  context, or a reviewed scan for `retry_native_transfer` transactions by the
  recipient around `startedAtNs`.
- **Verifier transport finding (not changed, needs review):** FastNEAR
  answers a pruned block with HTTP 422 + JSON-RPC `UNKNOWN_BLOCK`, and a pruned
  transaction by holding ~30 s and answering HTTP 408 `TIMEOUT_ERROR`. The
  verifier transport maps any non-2xx to `RPC_UNAVAILABLE` (transient), so an
  old receipt reads "could not verify yet" instead of "history unavailable".
  The locator transport reads 4xx JSON-RPC error bodies (only `UNKNOWN_BLOCK` /
  `UNKNOWN_TRANSACTION` are taken); the verifier's behaviour was left as
  reviewed.

## Stage 6: browser QA (production build)

`pnpm --filter @taply/web exec next build --webpack` with the operator's
existing `.env.local` (FastNEAR RPC, pilot contract, flags unchanged), served
by `next start`. Script: `apps/web/scripts/phase7g-qa.mjs`, Chromium (Playwright
1.64.1 from a separate tools folder, not a repo dependency). Results:
[`screenshots/phase7g/phase7g-qa.json`](screenshots/phase7g/phase7g-qa.json).

**Safety:** injected read-only Testnet wallet whose signing methods throw;
only the app origin and the configured RPC host reachable; RPC methods
recorded: `status`, `block`, `query` (`view_account`, `view_access_key_list`,
`get_config`, `get_request`, `get_receipt`), `chunk`, `EXPERIMENTAL_tx_status`.
**Broadcast attempts: none. Page errors: none.**

**Harness forwarding (disclosed):** the configured RPC has pruned the pilot
blocks. Reads it answered with `UNKNOWN_BLOCK` / `UNKNOWN_CHUNK` /
`TIMEOUT_ERROR`, and every `EXPERIMENTAL_tx_status`, were served from
`archival-rpc.testnet.near.org` (same chain, real data, cached per identical
request). App code and configuration were unchanged.

| Check | Result |
| --- | --- |
| Widths 360, 390, 430, 768, 1280 × EN, TR × merchant, customer (`/pay/<pilot>`) | 19/20 rendered; 0 px horizontal overflow, 0 unnamed controls, 0 targets < 44 px on every audited page (29 pages) |
| `tr-customer-paid-768` | RPC did not answer within 45 s: honest "Talep okunamadı… Bu bir ödeme hatası değildir" (`rpc-unavailable-tr-customer-paid-768.png`). Infrastructure, not an app defect |
| Two browser contexts at once | Same sale code `KED 5E9`, account, amount, stage `contract_paid`, status `paid_per_contract` on both (`two-phones-paid-side-by-side.png`) |
| Merchant receipt **without** link → locator → **Verified Paid** | Pass at TR 360 (76 s cold) and EN 1280 (11 s warm), "No link from the customer was needed" shown. EN 390 (first, cold) ended "Could not search the chain" (RPC did not answer): Paid per contract kept, no false Verified Paid (`rpc-unavailable-merchant-receipt-en-390.png`) |
| Customer receipt with its own link | Verified Paid |
| Third account on the same sale (`stranger-paid-390`) | Payer-side view, Check receipt, no merchant wording |
| Keyboard | Merchant's **Verify receipt** reached in 4 Tab presses with a visible focus ring |
| Screen-reader regions | Every audited payment/receipt page has a `role=status` live region; locator steps announce politely |
| Reduced motion | All Phase 7F/7G effects `animation-name: none` |
| Synthetic: RPC unavailable | "Could not check the payments contract" + "Could not read the request… not a payment failure"; no pay control |
| Synthetic: 6 s RPC latency | Loading state, then the normal hero; no premature status |
| `/demo/handshake` room preview 360/1280 | One instance, DEMO-stamped; joined/pending/mismatch captured |

Not browser-tested here (needs an OPEN request, i.e. a new transaction):
rejected wallet approval, expired request, wrong permitted payer, long amounts
on the review card. These are covered by the jsdom integration tests listed
below and by earlier phases. **No physical iPhone/Android test was performed
in this phase.**

Screenshots (`apps/web/docs/screenshots/phase7g/`): `merchant-paid-{360,390,1280}`,
`customer-paid-{360,390,1280}`, `tr-{merchant,customer}-paid-{360,1280}`,
`two-phones-paid-side-by-side`, `tr-merchant-receipt-verified-360`,
`merchant-receipt-verified-1280`, `customer-receipt-verified-390`,
`keyboard-verify-receipt-focus-390`, `merchant-home-390`, `checkout-390`,
`stranger-paid-390`, `synthetic-rpc-down-390`, `synthetic-slow-rpc-loading-390`,
`demo-room-{joined,mismatch,pending}-360`, `demo-room-pending-1280`,
`rpc-unavailable-*` (infrastructure outcomes, kept as evidence).

Reproduce: build as above, `next start -p 3207 -H 127.0.0.1` in `apps/web`, then
`node apps/web/scripts/phase7g-qa.mjs <playwright/index.mjs> apps/web/docs/screenshots/phase7g apps/web/.env.local`.
Set `TAPLY_QA_ONLY=receipts` to rerun only the receipt sections.

## Stage 9: tests

| Command | Result |
| --- | --- |
| `pnpm --filter @taply/web run check` (brand, types, lint, tests) | exit 0 |
| `pnpm check` (workspace) | **exit 0**: shared 92/92, near-client 158/158, web **757 passed, 1 skipped** (61 files) |
| `pnpm --filter @taply/web exec next build --webpack` | exit 0 |
| Opt-in live locator test, archival RPC | pass (found `CrzQ57Jx…`) |
| Same test, FastNEAR / rpc.testnet.near.org | `history_unavailable` (expected: pruned) |

The skipped test is the opt-in live Testnet test. Web went from 665 (base)
to 757 tests. New files:

- `lib/merchant/__tests__/journey-status.test.ts`: status mapping, merchant
  never shows customer/wallet activity, verified only from the verified stage.
- `components/experience/__tests__/shared-session-7g.test.tsx`: two-phone
  consistency (amount, account, code, stage), long values in full, forged
  verified status replaced, duplicate update keeps the node, TR, no presence.
- `components/experience/__tests__/motion-7g.test.tsx`: pulse/settle only on
  evidence, no premature burst, reduced-motion coverage, infinite-animation
  allowlist.
- `lib/verify/__tests__/locate-funding.test.ts`: finds the candidate,
  rejects look-alikes, pruned/unavailable/budget, not-applicable cases,
  transport allowlist and 4xx error bodies (verifier unchanged).
- `lib/verify/__tests__/use-funding-locator.test.tsx`: hidden tab spends no
  RPC, no repeat searches, unmount safety.
- `components/payments/__tests__/merchant-verified-receipt.test.tsx`: merchant
  Verified Paid via locator, wrong candidate never verified, not found,
  pruned, link wins, no locator, account switching.
- `lib/handshake/__tests__/room.test.ts`, `components/handshake/__tests__/room-ui.test.tsx`:
  room contract, gating, honesty and real-vs-demo isolation.

Existing tests updated for new copy only ("Check receipt" link name, the
proof row text, one "Coming later" label). No payment-state assertion was
changed or removed; no payment-security logic was changed to pass a test.

## Remaining backend requirements

Real G2 Handshake: session-capable contract and reviewed near-client adapter,
accepted production auth, NEP-413 wallet proof and signed merchant profiles,
HTTPS/ACL/key/recovery and rollback-freshness gates, then frontend wiring of
the room reader, polling and presence (see the adapter handoff). Merchant-side
verification at scale: archival RPC or a reviewed proof/index service; retry
coverage.

## Known mobile limitations

One user-reported iPhone 13 run (Instant Pay; receipt JSON not archived).
Android untested. Private Tailscale HTTPS only. Camera, wallet return,
safe-area, VoiceOver and orientation checks in the Phase 7E device checklist
remain to be performed by the operator. The locator takes ~1 minute on a slow
archival RPC; on a normal RPC for a fresh sale it reads far fewer slow calls.

## Demo readiness

Ready to record with real Testnet once the operator approves a fresh sale and
payment: script, shot list and REAL/DEMO labels in
[`docs/PHASE_7G_DEMO_KIT.md`](../../../docs/PHASE_7G_DEMO_KIT.md). Fallback
B-roll from the archived pilot is in `screenshots/phase7g/`. Live Handshake is
DEMO only.

## Submission blockers (human decisions)

1. **LICENSE** missing (Q-014). Recommendation for approval: **MIT** (short,
   permissive, explicitly fine per Q-014, matches the npm ecosystem used) or
   **Apache-2.0** if an explicit patent grant matters. The owner decides.
2. **Judged branch:** public `main` (`86bd54b`) predates Phases 4–7. Decide
   which reviewed branch/tag the README and submission should point to; this
   branch is not merged anywhere.
3. **Demo video** and a **human-written X post** tagging @NEARProtocol and
   #NEARHackathon (live HACKATHON.md, re-checked 2026-11-05).
4. **Submission payload** (project name, lead, email, team size, tracks,
   mainnet payout account, repo and demo URLs, description, consent) only from
   the human; deadline **2026-11-14 23:59 UTC**. Mistakes go through
   https://nearhackathon.com/request-changes, never a second submission.
5. Optional but valuable: archive the iPhone receipt JSON and record one fresh
   two-phone sale for EVIDENCE.md.
