# Live taplyapp.xyz vs GitHub: source audit (2026-11-23)

This is a read-only audit. Nothing was deployed, promoted, aliased or changed on the live domain.

## 1. What could and could not be verified

| Check | Result |
|---|---|
| Vercel deployment metadata (source commit / CLI upload) for the apex `taplyapp.xyz` | **Not available to this session.** `taply-mainnet` (prj_GIgo9VBg4FmU79bMX1xePe8jCjXJ) returns 403/404 to the connected Vercel token: no list_deployments, no get_deployment, no inspect. The visible `taply` project only owns `www.taplyapp.xyz`, which is a 308 redirect to the apex. |
| Response headers | Contain no deployment id, commit SHA or `dpl_` skew token. The build id in the RSC payload is `L66NLfCtC_DFX_1RhQ-A6`. |
| Live client bundle | 24 JS chunks downloaded through a real browser, with TLS verified by Node. sha256 list: `evidence/mainnet-swap-2026-11-23/live-chunks-sha256.txt`. |
| Live server routes (GET probes only) | `/api/mainnet/oneclick/attempt` → 405 (exists), `/origins` → 200, `/quote` → 405, `/status` → 400, `/m/swap` → 404. |

**The live source commit could not be retrieved.** The owner can read it in
Vercel → `taply-mainnet` → Production deployment → "Source". A Git SHA there, or "CLI" for an
upload from a local folder, would settle it. If it was a CLI upload, the source exists only on the
machine that uploaded it.

## 2. Evidence that live contains code that is in no GitHub commit

Method:
1. Extract all 1 844 user-facing string literals from the live chunks.
2. Search for each one in the source of every remote branch (`git log --all -S`), in every local worktree of this session, and in `node_modules` (library strings excluded).
3. Normalise escapes before matching.

Result: **12 user-visible strings exist on live and in no commit of any branch or worktree**
(`live-strings-not-in-any-commit.json`), for example:
- "Paid via NEAR Intents. Taply verifies the USDC delivery and merchant payout on NEAR Mainnet."
- "An Intents payment is on its way. Do not ask for another payment."
- "A payment from an earlier attempt is arriving for this request. Do not pay again."
- "This funding asset is not supported." / "1Click does not currently list this asset as expected."

The live `/api/mainnet/oneclick/origins` also returns a second origin:
`{"assetId":"nep141:wrap.near","chain":"near",...,"refundAddressFormat":"near"}`.
Every GitHub branch types origins as `'base' | 'sol' | 'tron'`, so a NEAR origin is not
representable in any committed source. The response also carries `"funding": true`. Of all GitHub
branches, only `test/mainnet-1click-funded` (6dbff6e) has the funded gate open, and that branch
lacks the Taply Wallet disconnect panel that live shows.

What live does match:
- the Taply Wallet disconnect (merged in #46, in `staging/mainnet`);
- the Base USDC deposit flow and attempt route of `claude/mainnet-intents-1click` (PR #45, b19e092);
- extra NEAR-origin / Intents-status code that is not on GitHub.

## 3. What would be lost if `staging/mainnet` + PR #47 replaced live

PR #47 is based on `staging/mainnet` @ 1d327ed. Compared with live, that base **does not contain**:

| Live feature | Source on GitHub | Files (relative to merge base fa42157) |
|---|---|---|
| Pay a USDC request from Base (deposit address, QR, resume, two-phone tracking) | PR #45 only (unmerged) | `app/api/mainnet/oneclick/attempt/route.ts`, `…/quote/route.ts`, `components/mainnet/PayRequest.tsx`, `RequestShare.tsx`, `lib/mainnet/oneclick/client-attempt.ts`, `lib/mainnet/hooks.ts`, `use-verified-receipt.ts`, `lib/verify/locate-funding.ts`, `server/mainnet/oneclick/{http,origin-evidence,runtime,service,store}.ts`, `i18n/dictionaries/mainnet-{en,tr}.ts` |
| Funded 1Click quotes (`funding: true`) | gate `ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED = true` only on `test/mainnet-1click-funded` | `lib/mainnet/release-gates.ts` |
| NEAR (`wrap.near`) as a 1Click origin, and the 12 Intents status / asset strings | **nowhere on GitHub** | unknown |

Wallet, request creation, Gift, receipts, activity and the Taply Wallet disconnect **are** in the base.
`swap + PR #45` merges without conflicts (`git merge-tree`). The NEAR-origin work cannot be merged
from here because its source is not available.

## 4. Decision

- PR #47 **must not** be promoted to production as is. Live would lose the Base deposit flow and the NEAR-origin Intents code.
- The safe release order:
  1. Recover the live source from wherever it was deployed and commit it to a branch.
  2. Review and merge it, together with PR #45, into `staging/mainnet`.
  3. Merge `staging/mainnet` into this branch and re-run CI.
  4. Release only from `release/mainnet`.
- Until then, swap is reviewed on an **isolated Preview of `claude/mainnet-swap` only**. The temporary preview-only build exception is a separate commit and must be reverted before merge.
