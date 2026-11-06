# Phase 6B independent review

Reviewed 2026-11-01, starting at `8884e43` on `feature/phase6b-review`.
Scope: Phase 6A scanner, payment sharing, wallet return, receipt follow-up,
related concurrency, dependencies and regression coverage. The worktree was clean.
Changes are confined to `apps/web`. No root manifest/lockfile, shared schema,
contract, signing gate, `main`, or `feature/frontend` was changed. No deployment,
real transaction, push or merge was performed. This is not a contract audit.
Tested fixes and reproduction scripts: commit `56d2b9e`.

## Findings and fixes

| ID | Severity | Confirmed issue / reproduction | Fix and regression evidence |
| --- | --- | --- | --- |
| H1 | High | Reuse a receipt screen for another request while its read is pending: the previous request's terminal facts and Verified Paid presentation could remain visible. A returned facts object was checked against the contract, but not the route ID. | Key reads by route ID, reject facts for another ID, and bind verifier results to contract/version, terms, operation and references. `receipt-verification.test.tsx` covers both delayed navigation and wrong-ID facts. |
| H2 | High | After an attempt is resolved and replaced, delayed work targeting only request/method/signer could update the newer attempt, including resolving its duplicate brake or attaching an old hash. Concurrent recovery could overwrite a known hash or downgrade its phase. | Submission bookkeeping carries the original attempt's `startedAt`; updates reject superseded snapshots. Consecutive attempts get distinct timestamps even in one millisecond. Preserve known hashes and submitted/resolved phases against late error/decline updates. `journal-lock.test.ts` exercises these races. Contract replay protection remains required; this finding does not establish a double spend. |
| M1 | Medium | Hidden/pagehide cleanup relied on a later React effect; close/paste relied on parent unmounting. A persistent shell could retain the scanner across navigation. Playback rejection was swallowed, leaving a camera open without a usable preview. | Stop tracks and decoding synchronously on dismissal, pagehide/visibility loss and browser back; dismiss on route change. Cancel delayed success navigation. Handle playback rejection and externally ended tracks; dispose late decoder loads. `qr-scanner.test.tsx` covers late permission/decoder results, hidden initial mount, lifecycle events, races and disposal. |
| M2 | Medium | The real `jsqr@1.4.0` throws for `onlyInvert`: the scanner silently swallowed every fourth pass, and could never decode inverted codes. Its API declaration alone did not reveal this. | Use `attemptBoth` on every fourth pass. The real-library inverted QR round trip and emitted-worker Chromium smoke pass. The issue is also documented in [upstream PR 148](https://github.com/cozmo/jsQR/pull/148). Native `NotSupportedError` now switches to the bundled decoder; canvas initialization errors cannot reject into the scan loop. |
| M3 | Medium | Synthetic noise at the existing 640px limit produced UI-thread decode stalls exceeding one second in the review benchmark. Throttling between synchronous passes did not prevent a long task. | Move jsQR to a bundled, local dedicated worker; transfer the pixel buffer, permit one pending frame, terminate stalled work after 1500ms, and terminate on scanner teardown. Retain the 640px cap and 140ms interval after completion. Worker transport/watchdog/disposal tests and a real emitted-worker smoke cover the change. |
| M4 | Medium | An RPC pass replaced an old inbox snapshot, losing callbacks arriving while it awaited RPC. Concurrent passes could resurrect consumed items. The old 60-pass limit discarded hashes after about five minutes, even if the RPC was merely delayed. Saturated queues evicted older evidence. | Lock short inbox mutations, commit only unchanged snapshot items, preserve concurrent arrivals/decisions, retain references for the 24h age window, and preserve the URL if capture fails/full. Avoid stripping a newer callback after an asynchronous capture. Bound each pass to four cached RPC lookups, rotate deferred work, and back off to 30s. Wallet-return tests cover these cases, delayed availability, duplicates and expiry. |
| M5 | Medium | Attacker-controlled `?errorCode=userRejected` could mark a waiting attempt USER_REJECTED and remove its duplicate brake. | Unsigned redirect declines/errors leave OUTCOME_UNKNOWN until reconciliation. Chain matching additionally checks terms hashes or retry operation nonce; duplicate JSON arguments are rejected. Direct wallet rejection behavior remains separate. Forged-return and matching regressions pass. |
| M6 | Medium | A receipt with a known hash made one verification attempt; transient RPC/finality lag required manual intervention. An unrelated pending return also blocked automatic follow-up despite known funding evidence. | Retry transient verification failures at 1s, 3s and 10s, with a bounded total and visibility-aware scheduling. Never auto-resubmit. Known funding evidence can follow through independently of unrelated inbox items. Mobile-receipt regressions preserve unverified states before valid proof arrives. |
| L1 | Low | Share-origin validation accepted malformed origin-only configuration after URL normalization erased dot-segment paths, backslashes or internal control characters. | Check raw HTTPS origin syntax before URL normalization. Add malformed-origin and alternate IPv4/IPv6/localhost representation regressions. Existing public-origin selection and one canonical URL for QR/copy/share remain intact. |

No critical issue was identified within this review's scope. A receipt still
requires the independent chain verifier: a deposit, contract state, wallet hint,
query parameter, journal entry or socket message cannot produce Verified Paid.
Transfer/callback/finality/code-hash verification was not weakened.

## Dependency and data-flow review

- Phase 6A's lockfile delta contains only the `jsqr@1.4.0` importer, package
  integrity and empty dependency snapshot. It introduces no runtime transitive
  dependencies. The registry integrity matches the lockfile:
  `sha512-dxLob7q65Xg2DvstYkRpkYtmKm2sPJ9oFhrhmudT1dZvNFFTlroai3AWSpLey/w5vMcLBXRgOJsbXpdN9HzU/A==`.
- Registry metadata reports 1.4.0 as latest, published 2021-04-24. Its age and
  the reproduced inversion bug are maintenance limitations; latest does not
  establish active maintenance or security assurance. It remains pinned.
- The camera opens only from an explicit scanner choice. Pixel extraction is
  local canvas work; jsQR executes in a browser worker loaded on demand.
  Neither the worker nor decoder contains upload/network code. Pixel buffers
  pass through `postMessage`, not HTTP. No frame persistence or image export is
  added. The browser smoke recorded zero POST requests; all external requests
  were blocked. Static JavaScript worker/chunk GETs are expected.
- `pnpm audit --prod --json`: exit 0, zero reported vulnerabilities.
- `pnpm audit --json`: exit 1, one **moderate existing development dependency**
  finding: `minimatch@10.2.6`, via ESLint/typescript-eslint,
  [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
  The advisory reports patched versions `>=11.0.1`. It is not introduced by
  jsQR and is not in the production graph. Remediation remains open: changing
  the shared lockfile/dependency graph requires lead coordination, and a major
  override should not be assumed compatible. No dependency files were changed.

## Validation

Environment: Windows, Node `v24.22.2`, pnpm `11.5.0`.

| Command / layer | Observed result |
| --- | --- |
| `pnpm check` | Exit 0. Brand assets byte-identical; production Turbopack build, type checks and ESLint pass. Shared 92/92, near-client 158/158, web 515/515 tests across 39 web files. Total 765 tests. |
| `pnpm --filter @taply/web exec next build --webpack` | Exit 0. Production compilation, TypeScript, page generation, optimization and build traces completed. |
| `git diff --check` | Pass. |
| Production Webpack browser smoke | Chromium 156.0.8078.4, 390x844, generated canvas camera streams, bundled worker path. Inverted QR, single local navigation, untrusted host rejection, close/success/pagehide cleanup and explicit resume pass. Zero page errors and POSTs; four external requests blocked. |
| Noise responsiveness in that smoke | A 10ms UI timer ticked 25 times over 250.5ms while noise was decoded off-thread. This is one synthetic desktop observation, not a mobile performance guarantee. |

The existing jsdom suite emits notices for unimplemented navigation, scroll and
media playback APIs. Those notices are not physical browser evidence. Early
review runs exposed the inversion failure and import allowlist update; the
final passing suite retains the explicit no-signing recovery guard. New
integration assertions allow synthetic async reads to finish under suite load.

Raw dependency audit output, the synthetic Node diagnostic and browser smoke
result are preserved in [phase6b/](phase6b/). The Node diagnostic ran while other
review checks were active: its noise median/p95/max were 479.15/1255.65/1409.73ms.
These values establish a reproduced long-task risk; they are not typical-device
timings. The post-fix browser timer observation above checks UI responsiveness
with that work in a separate thread.

Reproduce the optional runtime smoke without changing workspace dependencies:

1. Install `playwright@1.64.1` in an isolated tools directory outside the repo;
   install its Chromium browser (`chromium-1248`).
2. Build with Webpack, then run
   `pnpm --filter @taply/web exec next start -p 3206 -H 127.0.0.1`.
3. Run `node --no-warnings --experimental-transform-types apps/web/scripts/phase6b-browser-smoke.mjs <absolute-playwright-index.mjs>`.
   An optional `TAPLY_REVIEW_CHROMIUM` selects another installed executable.
   This script blocks external requests and checks generated frames only.
4. The synchronous decoder diagnostic is reproducible with
   `node --no-warnings --experimental-transform-types apps/web/scripts/phase6b-qr-benchmark.mjs`.
   Its Node/V8 timings exclude camera capture, browser composition, mobile CPU
   and thermal conditions. It is not a test of the post-fix UI thread.

## Remaining limitations and recommendation

**GO for controlled, read-only real-device QR testing** with signing disabled,
using an operator-controlled HTTPS origin reachable by both phones. This does
not certify physical browser compatibility or authorize a financial pilot.

- No physical iPhone/iOS Safari or Android/Chrome was tested. The deterministic
  runtime smoke substitutes canvas streams; headless fake-hardware playback was
  intermittent and cannot establish real-camera behavior.
- Check real permission allow/deny/reset, camera indicators on close/paste/back,
  navigation, successful scan, app switch and screen lock; foreground return
  must require Resume. Test both the bundled worker path and native detector.
- On both device families test normal/inverted/low-contrast QR, noise, rapid
  duplicate detection, navigation during the success hold, reduced motion,
  VoiceOver/TalkBack, keyboard focus, large text and landscape. Record OS,
  browser version, viewport, decode latency and long tasks before claiming support.
- Public-looking DNS syntax is not proof of public DNS resolution, valid TLS,
  internet reachability or correct deployment. IP literals and known local
  suffixes are rejected, including normalized IP forms, but a DNS alias can
  resolve privately. Operators must test the chosen host from an independent
  phone/network. The app does not navigate to a scanned foreign origin.
- Wallets can fail to return a hash; history can be pruned; storage can be lost;
  receipt retry references can be incomplete. These remain honest unverified
  states. Inbox retention is 24h and automatic own-payment follow-up is bounded
  by the existing 30-minute window. No indexer/history recovery was invented.
- The configured RPC remains the verifier's trust model. No live transaction,
  recipient balance, contract deployment or WASM evidence was collected here.
- The moderate development-only minimatch advisory remains open as described
  above. No production dependency advisory was reported at review time.
