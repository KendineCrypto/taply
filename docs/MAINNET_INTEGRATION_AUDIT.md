# Independent Mainnet integration audit — 2026-11-13

**Decision: GO for technical review and labelled, non-funding previews; NO-GO for Mainnet funds.**

Reviewed `claude/festive-brahmagupta-qkqex1` at
`8256955cbf4fa81d394cb68d7dfb765d41e15306`. Fixes and reproducible evidence are
on the separate `codex/mainnet-integration-audit` branch. No merge, deployment,
wallet signing, funding, DNS, hosting or key operation was performed. The Rust
contract, shared package, near-client and dependency lockfile are unchanged.

## CI evidence for the requested revision

GitHub reports **completed / success**, with the exact requested head SHA:

- [Workspace Check, 43428430599](https://github.com/KendineCrypto/taply/actions/runs/43428430599).
- [Mainnet Core Candidate, 43428435676](https://github.com/KendineCrypto/taply/actions/runs/43428435676), including Rust unit/Clippy, WASM, real local NEAR sandbox/adversarial router, wire integration and planner steps. Completed 12:55:49 UTC.

These are CI verification of the candidate, not live USDC/router proof. They
do not automatically certify the subsequent audit fixes. No local Rust run is
claimed; this Windows environment lacks Cargo. The candidate contract evidence
and artifact measurements remain in [MAINNET_CI_HANDOFF.md](MAINNET_CI_HANDOFF.md).

## Prioritized findings

Severity distinguishes demonstrated current faults from latent blockers behind
the closed funding/signing gates. No P0 exploit was demonstrated in the closed
candidate. This is a bounded integration review, not a claim of absence of bugs.
Line references below refer to the audit branch; findings also identify the
original behavior at the reviewed commit.

### P1-1 — Wrong request can inherit a previous paid view — FIXED

`apps/web/src/lib/mainnet/hooks.ts:30-70` retained the prior successful read on
RPC failure and did not bind state to the current request ID. Load paid request
A, navigate to request B, then fail B's RPC read: A remained the successful
result. A checkout can consequently show another request's payment state.

State is now keyed by request ID, failures become unavailable, and superseded
reads cannot overwrite a newer read. Status hints are also keyed by request ID.
`apps/web/src/lib/mainnet/__tests__/audit-hooks.test.tsx:13` reproduces the A/B
navigation failure; it failed before the fix and passes after it.

### P1-2 — Prefetch headers bypassed route isolation — FIXED

`apps/web/src/proxy.ts:50` previously excluded requests bearing
`purpose: prefetch` or `next-router-prefetch`. These caller-controlled headers
skipped the entire proxy, including network route restrictions and nonce CSP.
Testnet API handlers are still present in the Mainnet build, so excluding them
from the proxy is a boundary failure, even where downstream configuration also
restricts their functionality. No signing bypass was demonstrated.

Removed the header exclusions. Tests use Next's actual compiled matcher utility,
not a substitute route predicate. Both regressions failed before the fix. On the
final local Mainnet preview, GET `/api/handshake/health` with either forged header
returns 404. The full Testnet workspace regression suite passes.

### P1-3 — Quote lease is not concurrency or uncertain-outcome protection — OPEN

`apps/web/src/server/mainnet/oneclick/store.ts:39,52-77`: a 30-second SET NX lease
has no renewal/fencing, and save is separate SET/INCR/PEXPIRE commands. The first
owner can continue after expiration while a second owner starts. Chain config,
request and two storage reads, token lookup and quote creation occur inside the
lease (`service.ts:233-332`); their total allowed duration exceeds 30 seconds.

`node apps/web/scripts/audit-mainnet-lock.mjs` deterministically reproduces two
active owners at 30,001 ms using the real store implementation and a simulated
Redis command/clock. This is **not** a real Redis integration test and its zero
exit code confirms the defect, not safety. Evidence:
`docs/evidence/mainnet-audit-2026-11-13/lock-reproducer.json`.

There is also no durable pending attempt before the upstream quote call. A lost
response or failed persistence has no retained uncertainty record. Records expire
24 hours after the deadline (`service.ts:136,332`), while the expired funded-quote
branch permits new quotes on PENDING_DEPOSIT/FAILED/REFUNDED hints
(`service.ts:274-278`). Such hints do not independently exclude a delayed deposit.
These are code-path observations; no live double delivery was attempted.

Current impact is overlapping dry requests/quota inaccuracies; **funded mode
remains disabled**. Before opening funds: durable per-attempt reservation,
atomic fenced persistence, explicit uncertain state and reconciliation of every
potentially funded attempt are required. Merely extending the lease is not a fix.

### P1-4 — Live router execution envelope and R-2 remain unproven — OPEN release blocker

`contracts/payments-mainnet/src/lib.rs:19,571,789,815` and `docs/MAINNET.md:76-113`:
the authenticated token/router path reserves principal and keeps excess or semantic
rejections in fixed-size unclaimed accounting. Sandbox tests cover conservation,
duplicates, insufficient payout gas and recovery failure. They do not establish
the production USDC/router execution envelope. At least 40 TGas must remain after
validation for payout; arbitrarily low entry gas, deserialization/runtime failure
or storage insolvency can fail before accounting and return tokens to the router.
The live dry quote contains no enforceable proof of receiver gas delivery.

An unknown payout/recovery callback remains in flight, with no blind retry or
administrative success override. This contains double-spend risk but does not
resolve R-2 or guarantee availability. Unclaimed recovery remains owner-controlled
manual attribution, not an automatic refund to the Base payer. Do not infer a
customer refund from a failed `ft_transfer_call` receiver. Keep router checkout off.

### P2-1 — Dry-quote execution deadline was not authenticated — FIXED

`apps/web/src/server/mainnet/oneclick/verify.ts:99-104,112,134`: SDK 0.1.26 signs
different fields for dry and funded quotes. Injecting `quote.deadline` into a dry
response preserves a valid SDK signature; the previous verifier preferred that
unsigned field over the signed request deadline. Regression explicitly proves
the altered response still passes SDK verification, then requires Taply rejection.
Dry execution deadline/memo/inactivity fields are now rejected; unsigned dry
time estimates are not presented as accepted quote data. Core amount/echo checks
were not relaxed.

### P2-2 — Response timeout and byte limit did not bound body consumption — FIXED

`apps/web/src/server/mainnet/oneclick/client.ts:56-97` previously cleared its timer
at response headers, then consumed the entire body and compared JS string length.
A stalled body never timed out; multibyte content exceeded the advertised byte cap.
The timer now covers the entire operation and `bounded-body.ts` counts streamed
UTF-8 bytes, cancels oversized/stalled bodies and refuses invalid UTF-8. Fake-timer
stall and multibyte regressions failed before and pass after the fix.

### P2-3 — Missing status binding fields were accepted — FIXED

`apps/web/src/server/mainnet/oneclick/service.ts:350-352` used optional echo checks,
accepting `{status:'SUCCESS'}` for a stored funded quote. It now requires matching
deposit address AND correlation ID. An added regression reproduced acceptance
before the fix. Existing success fixtures now supply both actual required echoes;
checks were not loosened. Status is still an upstream hint, never settlement proof.
No live funded status response was obtained or claimed.

### P2-4 — Anonymous resource limits are incomplete — OPEN

`apps/web/src/server/mainnet/oneclick/http.ts:38-39` buffers the inbound body before
checking character length. `service.ts:233-281` performs chain reads before its
successful-quote count check. There is no client/global ingress quota in this
service; arbitrary IDs and failed attempts do not consume the per-request quote
counter. This is a source-verified resource-exhaustion exposure when live dry
mode is enabled, not a load-tested production incident. Add streaming inbound
byte/deadline bounds and rate limits before chain work. Same-origin browser checks
are not authentication or protection from direct HTTP clients.

### P2-5 — Live registration preview uses fixture storage amount — OPEN

`apps/web/src/components/mainnet/CreateRequest.tsx:22,134-136` builds the USDC
registration call using `FIXTURE_USDC_REGISTRATION_YOCTO` even in non-fixture mode.
It does not fetch current token storage bounds there. Signing is disabled, so no
incorrect deposit was sent. Use verified live bounds before enabling this path;
also retain the exact bond quote/hash when request terms change rather than
treating an ID alone as a quote cache key (`CreateRequest.tsx:72,115,123-127`).

## Contract, wallet and schema compatibility

- `packages/near-client/src/mainnet.ts:28` deliberately requires
  `intentsRouter:false`, matching `lib.rs:180` and the published interface. It is
  a release-readiness capability, not evidence that the receiver has no router
  code. Dry quote preparation against this candidate is coherent; flipping the
  client schema to `true` would break candidate reads and falsify readiness.
- The exact `customRecipientMsg` remains the shared `{id,expectedTermsHash,action:
  'pay_instant'}` builder. No recipient override. Exact-output principal, refund
  address, asset, recipient, message, request deadline and signature are checked.
  Refund-address syntax does not prove the user's control of that address.
- Mainnet reader checks final-block genesis, account/code identity and candidate
  schema. Build-time root aliases in `apps/web/next.config.ts:24-39` select Mainnet
  providers; unsupported Mainnet Webpack builds fail closed. No runtime switch or
  cross-network RPC fallback was identified in the reviewed Mainnet path.
- The three constants in `apps/web/src/lib/mainnet/release-gates.ts:12,15,22`
  remain **false**: signing approval, funded-quote approval, independent verifier.
  Public quotes still expose `fundingEnabled:false` and `deposit:null`.
- `FINAL_PAID` permits **Payment Recorded**, not **Verified Paid**. 1Click SUCCESS,
  deposits, timeouts and off-chain hints cannot set independently verified payment.

## Evidence: what is real and what is simulated

1. **Actual live API, no funding:** on 2026-11-13 at 13:20:51 UTC, a fixed `dry:true`
   request to `https://1click.chaindefuser.com/v0/quote` returned HTTP 201. The pinned
   SDK 0.1.26 verified its signature with the production manager key. Recipient
   was `devkendinecrypto.near`, principal 1,000,000 USDC base units; amountIn
   1,014,651, minAmountIn 1,004,548, amountOut/minAmountOut 1,000,000. No deposit
   address was returned. Request ID, terms hash and refund address were synthetic.
   Full response: [live-dry-probe.json](evidence/mainnet-audit-2026-11-13/live-dry-probe.json).
   Offline regression accepts that response at its recorded observation time and
   rejects amount tampering and stale replay. It is now an expired quote, not a
   reusable offer. The API echo is not proof that the recipient runs Taply or that
   its message/gas will execute. No live Taply request or merchant payout exists
   in this evidence.
2. **Real local browser, synthetic backend/chain:** 88/88 checks passed on Chromium
   at 390px, 1280px and Turkish 360px. Signing disabled, deposit withheld, unknown
   states and Payment Recorded wording checked. Twenty loaded scripts scanned;
   no active Testnet RPC/contract/vault strings found by the existing scanner.
   The Testnet genesis export remains in shared RPC code; rejected-code-hash
   deny-list strings are intentionally present. These are inert residues, not a
   zero-Testnet-byte claim. All generated chunks/unvisited routes are outside
   this loaded-script scan. Only external browser host observed was
   `raw.githubusercontent.com` (wallet manifest); no RPC or 1Click browser request.
   [Browser results](evidence/mainnet-audit-2026-11-13/browser-qa-results.json).
3. **Local full workspace:** `pnpm check` passed: shared 93, near-client 262, web
   1,376 passed / 7 skipped. Typecheck and builds passed; lint has 0 errors and
   11 warnings. `pnpm build:mainnet` passed in isolated preview fixture settings.
   Initial regression runs intentionally failed on the original defects; an
   incomplete status fixture and recorded-evidence test path/type were corrected
   before the final clean run. No security condition was removed to pass tests.
4. **Sandbox:** completed pinned-commit CI runs real local NEAR with a standard
   test token at the configured token identity. This is stronger than a mocked
   receipt, but is not the live Mainnet USDC/Intents implementation.

## Reproduce and integrate

From a clean checkout of the audit branch with Node 24 and pnpm 11.5.0:

```text
pnpm install --frozen-lockfile
pnpm check
node apps/web/scripts/audit-mainnet-lock.mjs
```

The last command demonstrates an OPEN blocker; it must not be advertised as a
passing concurrency safety test. Recorded live response tests run offline inside
`pnpm check`. To make another explicitly non-funding API observation:

```text
node apps/web/scripts/audit-oneclick-dry.mjs <new-evidence-path.json>
```

Do not overwrite the recorded evidence used by the regression test. The script
hardcodes `dry:true`, synthetic IDs/refund address and no API credentials.

For browser reproduction, load `apps/web/env/mainnet.env.example` into process
environment, override `VERCEL_ENV=preview`, both contract IDs and share origin
to empty, `NEXT_PUBLIC_TAPLY_MAINNET_FIXTURES=on`, `TAPLY_ONECLICK_MODE=fixture`.
Build with `pnpm build:mainnet` in apps/web, start Next locally on port 3113 with
the same environment, then run:

```text
node apps/web/scripts/mainnet-1click-qa.mjs <playwright/index.mjs> <artifact-directory> http://127.0.0.1:3113
```

Use Chromium matching that Playwright installation (the initial local browser
version mismatch was resolved without changing project dependencies).

Claude integration: review this branch's small frontend/server fixes and tests;
keep the current ABI/shared exports and all three gates unchanged. Preserve
`intentsRouter:false`, Payment Recorded/unknown-state wording and unclaimed/manual
recovery limitations. Resolve P1-3, P1-4 and live registration/resource controls
before proposing a separately approved funding rollout. The live signed dry API
sample closes the **real quote compatibility** evidence gap only. Actual Base
funding, live router envelope, deployed code/config verification, merchant USDC
payout and independent receipt verification remain unproven.

Primary SDK/API references consulted: [signature verification](https://docs.agentsonintents.com/integration/distribution-channels/1click-api/verify-quote-signature)
and [swap types](https://docs.agentsonintents.com/integration/distribution-channels/1click-api/swap-types),
checked against the installed pinned SDK's serialization rather than assumed
field coverage. EXACT_OUTPUT buffer/minimum-input semantics do not authorize
automatic retries or imply completed refunds.
