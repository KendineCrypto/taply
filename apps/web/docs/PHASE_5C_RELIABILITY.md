# Phase 5C: frontend reliability hardening

Implements the six frontend instructions in `packages/near-client/PHASE_5B.md`
("Precise frontend integration instructions for Claude"). `apps/web` only. No
contract, code hash, shared package, manifest, lockfile or signing-gate change.
Native Taply Wallet signing stays OFF. No transaction was made and nothing was
deployed. No physical-device testing was done.

## Changes

| # | Area | What changed |
| --- | --- | --- |
| 1 | `lib/payments/use-payment-request.ts` | One read in flight; a refresh requested meanwhile is **queued** (one more read with the newest id/account/reader runs afterwards, never dropped). Results are tagged with id + account + reader + contract and shown only while those are current. Nothing applies after unmount. Re-reads on tab resume. |
| 2 | `lib/near/use-native-balance.ts` | Same account + same client + same generation reads **coalesce**: triggers within 1 s join the in-flight read; later triggers queue exactly one follow-up. Account/provider change or remount never joins; old results are dropped. |
| 3 | `lib/payments/context.tsx`, `freshness.ts`, `CreateRequest.tsx`, `PaymentScreen.tsx` | Finalized blocks older than 90 s or more than 10 s ahead of the device clock are not usable for financial actions (same policy as near-client native signing), shown as "Network data is out of date" or "device clock looks out of sync". `ensureFreshCheck()` re-reads `get_config` when the check is older than 30 s, before building terms and again before opening the wallet. Expiry is anchored to that fresh block. If the chain stalled, the config changed or the reviewed terms expired, the reviewed terms are **dropped, not edited**, and a new review is required. Pay/retry/cancel also require a fresh request read; the pay review (and its checkbox) resets. Aged checks re-verify on tab resume. |
| 4 | `lib/payments/journal.ts`, `journal-lock.ts`, `submit.ts`, `wallet-return.ts` | All journal writes run under ONE exclusive Web Lock named `taply.journal.v1` (the whole blob), re-reading storage inside the lock. `begin` happens under the lock before any wallet prompt, so a concurrent same-attempt in another tab is blocked (one prompt). No Web Locks means no new attempts (`no_journal`, nothing sent); outcome updates still record. A hash that cannot be journaled is reported as unknown. `storage` events from other tabs bump `journalVersion` so screens show the new brakes. UNKNOWN outcomes still block across tabs. |
| 5 | `lib/verify/rpc.ts` | Ported near-client's bounded transport: one timeout over headers + body, raced so a fetch ignoring abort still ends; Content-Length pre-check; streamed byte counting; fatal UTF-8 decoding; reader cancelled on abort/limit. Mapping kept: transport/timeout/mid-body drop are `RPC_UNAVAILABLE` (transient); size/encoding are `MALFORMED`. Verifier logic unchanged. |
| 6 | Tests | 39 new tests: `rpc-bounded` (9), `journal-lock` (8), `use-payment-request` (7), `use-native-balance` (5), `freshness` (8, real near-client + fake chain), `context-sync` (2). |

One existing test changed: the same-nonce resume test now anchors its chain to
the current time. It previously re-signed terms whose funding deadline had
already passed in chain time; the new gate correctly refuses that.

## Verification (2026-11-01, local Windows, Node 24.22.2, pnpm 11.5.0)

- `pnpm install --frozen-lockfile`; `pnpm check`: exit 0 (shared 92/92, near-client 158/158, web 438/438 in 33 files).
- `pnpm build` (apps/web): success.
- Read-only Playwright smoke against `next start` (Chromium 1248, 390px, EN): live pilot receipt
  `/receipt/9b9a5724…?ftx=CrzQ57Jx…` shows **Verified Paid** through the new transport; `/pay/9b9a5724…`
  shows Paid per contract with no stale-chain notice; `navigator.locks` present; 3-item nav and Tap sheet work;
  no page errors. No wallet was connected and nothing was signed.

## Remaining risks (not fully resolved)

1. **Web Locks vs localStorage propagation.** The lock serialises journal writers across tabs, but browsers do
   not formally guarantee that a write made in one tab's renderer is visible to another tab's `getItem` by the
   time that tab acquires the lock. Chromium synchronises localStorage across tabs quickly, but this is not a
   spec guarantee. A durable fix is moving the journal to IndexedDB transactions (needs a migration of
   `taply.journal.v1`). The contract still rejects a duplicate funding/creation nonce, so the worst case is a
   duplicate prompt and gas, not a double payment.
2. **Locks do not span devices or other wallets.** Another device or wallet app using the same account is not
   coordinated (same boundary as the native backend).
3. **Clock policy relies on the device clock.** A wrong device clock pauses signing ("clock out of sync"). It
   never marks a payment failed. Informational balances are still shown with their block height and are not
   age-gated.
4. **No Web Locks means no external signing.** Very old browsers or insecure (non-HTTPS) origins cannot create
   new attempts.
5. Still unverified, as in PHASE_5B: physical iOS/Android wallet redirects, production HTTPS origin and WebKit
   behaviour.
