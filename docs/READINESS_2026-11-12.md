# First-place readiness review — Real-World Money (2026-11-12)

> 2026-11-13 scope note: the owner approved preparing a separate mainnet
> implementation, as recorded in AGENTS.md/CLAUDE.md and MAINNET.md. The earlier
> implementation restriction below is superseded only for that preparation;
> its safety rationale is retained. R-2 is open and no mainnet deployment or
> real-money operation is approved. See MAINNET_IMPLEMENTATION_REPORT.md.

Scope:
- `main` = `release/taplyapp` = `5a7e587`, live on taplyapp.xyz.
- Fixes are on branch `claude/beautiful-gates-c6fhhh`, which is **not merged and not deployed**.

Not done in this review: no contract was changed, nothing was deployed, nothing was posted and nothing was submitted.

Labels: **Proven** = reproduced with evidence linked here. **Hypothetical** = plausible but not reproduced.

## A. Critical blockers to first place

| # | Finding | Status | Evidence | Action |
| --- | --- | --- | --- | --- |
| A1 | **Taply is not in the official submission list.** | Proven, 2026-11-12 ~06:00 UTC | `GET https://nearhackathon.com/api/projects`: 648 projects, none mentions "taply". NEAR Hunt mirror: 618 projects, none either. | The owner publishes the X demo post, then submits once (form or API) before **2026-11-14 23:59 UTC**. Tracks: `realworld`, optionally `open`. A submission cannot be resent, only corrected by hand. |
| A2 | **Track-hint gap.** The track hints are *Stablecoins, NEAR Intents, meta transactions*. Merchants receive **NEAR**, not a stablecoin. There are no Intents (Q-007: no Intents on Testnet) and no gasless calls. Several rivals show mainnet Intents payments in exact USDC (e.g. Dues, CareRail, nearswaps checkout, Penstock). | Proven (README, track table) | `HACKATHON.md` track table; NEAR Hunt Real World list | Cannot be closed safely by 14 Nov (mainnet, new contracts). Say it plainly and lean on what rivals lack (section E). Q-011: hints are not required. |
| A3 | **R-2 is open.** A judge will read "High". | Proven open; **no user-reachable path found** | [R2_REACHABILITY.md](R2_REACHABILITY.md): every callback failure path checked; 2.13 / 2.27 TGas measured of 15 on real receipts; `testFaultBuild: false` on both contracts | Present the reachability evidence (done on the branch). Do not claim a fix. |

## B. Issues that can safely be fixed before submission (done on the branch)

| # | Finding | Status | Evidence | Fix |
| --- | --- | --- | --- | --- |
| B1 | The cashier had to tap **Verify receipt** to see Verified Paid (step 5 of the cashier flow). | Proven (production screenshot) | [handshake/5-merchant-paid.png](evidence/production-final-release-2026-11-11/handshake/5-merchant-paid.png) | The creator's pay screen opens the receipt by itself once paid. Real Testnet on a local build: receipt opened 4 s after payment, **Verified Paid** at 18 s, no hint ([evidence](evidence/cashier-auto-verify-2026-11-12/)). 5 new tests; the component test fails without the change. |
| B2 | README and judge guide said **"Paid per contract"** for Instant Pay. The app says **"Payment recorded · Awaiting verification"**. | Proven (live page text) | `/pay/9b9a5724…` reads "Payment recorded · Awaiting verification" | Wording corrected in README and JUDGE_QUICK_START |
| B3 | README said the first commit is `db10264` (2026-10-29), but that commit is **not an ancestor of `main`**. | Proven | `git merge-base --is-ancestor db10264 origin/main` fails. Roots of `main`: `a085353` (11-01), `4a76769` (11-02), `b076359` (11-05). | README states the real roots; all are inside the window (Q-001) |
| B4 | The per-sale cost to the merchant was not disclosed: a permanent 0.00578 NEAR storage deposit plus about 0.0003 NEAR of gas. | Proven | [g1-instant evidence](evidence/testnet-e2e/2026-11-09T07-13-12-743Z-g1-instant.json); contract `storage_bonds` is never refunded | Added to README Limitations |
| B5 | No 2-minute, no-wallet judge path. | Fixed | Five live links, each opened in a fresh Chromium on 2026-11-12: the receipts show **Verified Paid** (10–21 s); the refund page shows "Refunded · Not a payment"; the release page shows "Payment released" | README section "Check it in 2 minutes", JUDGE_QUICK_START §0 |
| B6 | The R-2 wording in README, judge guide, review and matrix lacked the reachability facts. | Fixed | [R2_REACHABILITY.md](R2_REACHABILITY.md) | Linked from all four documents |

Branch checks:
- `pnpm check`: shared 93, near-client 253, web **1,216** passed + 1 skipped. API 72/72.
- Production web build: OK.
- **Deploying B1 needs owner approval**, then the same post-deploy checks as `docs/evidence/production-final-release-2026-11-11/`.

## C. Checked and holding (no action)

| Check | Result |
| --- | --- |
| Production serves `5a7e587` | Content match on 2026-11-11, 40 s after the push ([evidence](evidence/production-final-release-2026-11-11/)) |
| Wallet creation and restore, QR + scanner, Live Handshake, NEAR pay + Verified Paid, Protected refund + release on production | All pass on 2026-11-11 (same evidence) |
| Merchant phone without the funding hint | **Verified Paid** in 21 s for a fresh payment (29 archival reads). 20 min later, after heavy testing from one IP, the archival RPC rate-limited and the receipt showed "Could not verify yet · Do not pay again". It is honest, but a judge on a busy network may see it. |
| Contract keys | Escrow: **0 keys**. Pilot: 1 full-access key (disclosed). The app pins the code hash and fails closed if it changes. |
| Faucet | Fresh accounts receive exactly 10 test NEAR (`taply-srp-04775a.testnet`) |
| README / judge links | All relative links resolve. All taplyapp.xyz links return 200. |
| CI on `5a7e587` | workspace-check, instant-pay-sandbox, protected-pay-candidate, wallet-browser-check: all green |
| Rules | Public repo ✓, LICENSE ✓, AI and library disclosure (Q-005) ✓, Testnet eligible (Q-010) ✓, hosted demo to keep up until 2026-11-25 (Q-012) |
| Console | No page errors on 14 routes at 390 px and 1280 px |

## D. Must remain future work

| Item | Why not now |
| --- | --- |
| Eliminate R-2 (beneficiary-claim design B) | New contract and a new "credited" meaning; needs review and migration. About 4–6 days ([R2_REACHABILITY.md](R2_REACHABILITY.md) §3) |
| Stablecoin settlement for merchants, NEAR Intents (mainnet only), mainnet | Mainnet, unaudited contracts, real money |
| Gasless merchant (meta-transaction relayer) | A relayer holding funds is a new attack surface |
| CSV export for an accountant (the track's example prompt asks for one) | A small feature; only on-device history exists, which an accountant could not rely on as a full ledger |
| Recovering the per-sale storage deposit | Would need a contract change (records are permanent by design) |
| External security audit | — |

Hypothetical concerns (not reproduced):
- Many judges at once could hit the public archival RPC rate limits. The receipt degrades honestly.
- Upstash Redis free-tier quotas under load. Room creation is rate-limited per client.
- A protocol change to gas or storage prices (an R-2 trigger).

## E. Competitive position (from NEAR Hunt descriptions only; demos not opened)

- **Rivals with features Taply lacks:** mainnet NEAR Intents checkouts paying exact USDC (Dues, CareRail, nearswaps checkout, Kite, Settleform); gasless payment links (Paylink); local-QR rails (NearPocket); POS (NearPay).
- **Differentiators that seem rare in the list:**
  - a **two-phone live handshake** with the same sale code and join/leave states;
  - an **independent receipt verifier** in the browser that checks funding, transfer and callback receipts, code hash and keys;
  - **Protected Pay** with distinct refunded and released receipts;
  - public evidence for every claim, with an honest "not proven" column.
- **Where judges may score Taply down:** "a normal company could use it tomorrow" (Testnet, NEAR-denominated, per-sale cost), and the missing track hints.

## F. Recommended plan for the remaining time

1. **Today:**
   - Review this branch (docs + B1).
   - If approved: merge, deploy and repeat the post-deploy checks.
   - If not: merge the docs only, which carry no runtime risk.
2. **Today or tomorrow:**
   - The owner posts the 175-second demo on X with @NEARProtocol and #NEARHackathon, and links the repo and taplyapp.xyz.
   - Then submit **once**: tracks `realworld` (+ `open`); `projectUrl` is the repo; `demoUrl` is the X post.
   - Re-check A1 afterwards with `GET /api/projects`.
3. **Until 2026-11-25:** keep taplyapp.xyz and the public RPC configuration unchanged (Q-012). Do not deploy contracts.
4. **Do not** add Intents, mainnet or new contract code before judging.
