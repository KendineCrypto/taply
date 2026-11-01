# Phase 5B: payment reliability and wallet security

Based on `origin/feature/frontend` at `f69a8e53efff7052eb0e81f13d0aa5bd9748b313`, fetched 2026-11-01. Branch: `feature/ux-reliability`. The original dirty checkout was preserved; this branch uses a separate worktree. No frontend, contract, shared schema, manifest, lockfile or signing-gate edits. Native signing remains OFF. All signatures in automated tests use disposable synthetic keys, offline.

## Changes and measured scope

- `wallet-chain.ts`: after Testnet identity, FINAL block and account-existence checks, read the key, protocol storage cost and gas price concurrently at that exact block. Six requests still run; sequential network rounds drop from six to four. Missing accounts remain LOCAL_ONLY, and any invalid key/cost/gas/provenance rejects the snapshot.
- `transactions.ts`: fetch distinct receipt blocks in groups of at most four. Retain the 32-block cap, complete rooted graph, FINAL status, hash/height/time consistency and causal ordering checks. No provider switching, new retries or cached success.
- `wallet-backend.ts`: reject a changed finalized block hash at the same height or regressing chain timestamp between review and submission, before signing. Existing nonce, balance, identity, expiry, confirmation and signing gates remain.
- Regression tests cover overlapping reads, bounded fan-out, inconsistent blocks, queued separate backends, unknown-outcome blocking, exact storage bond and immutable review arguments, tampered terms, every existing funded/closed state refusing payment, and independent replay of both saved provider proofs including pruned-history refusal. The public prepare* functions are unchanged.

Synthetic benchmark: five samples per case, 20 ms artificial transport delay, same machine and fixtures, baseline code loaded directly from the base commit. These are local scheduling measurements, **not live payment latency**. Timer scheduling adds overhead.

| Operation | Before median | After median | Requests before/after |
| --- | ---: | ---: | ---: |
| Wallet snapshot | 187 ms | 140 ms | 6 / 6 |
| Transaction with eight distinct receipt blocks | 322 ms | 128 ms | 10 / 10 |

Reproduce after the frozen install and library build:

```sh
node packages/near-client/scripts/benchmark-read-reliability.mjs f69a8e5
node packages/near-client/scripts/reproduce-instant-proof.mjs packages/near-client/evidence/new-observation
```

The proof runner imports the unchanged frontend verifier through Node's TypeScript transformer and maps its protocol import to the same shared package. It records source SHA-256 values and original JSON-RPC response text. It accepts only read methods and starts each provider verification independently. Use pinned Node 24.22.2; its TypeScript transform currently emits an experimental warning. The output directory must be new. Current-state diagnostics are explicitly separate from payout proof.

## Existing payment reproduced using public reads

Evidence: [summary](evidence/phase5b-2026-11-01/summary.json), [public RPC raw responses](evidence/phase5b-2026-11-01/near-public-testnet.json), [FastNEAR raw responses](evidence/phase5b-2026-11-01/fastnear-testnet.json). Both providers returned `verified_final` independently on 2026-11-01. Neither needed a history fallback. This is configured-RPC trust, not light-client verification or a security audit.

- Contract: `taply-pay-pilot-1.testnet`, observed code hash `BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B` at state and execution blocks.
- Request: `9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502`.
- Funding transaction: `CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su`, signer `taply-pilot-funder-1101.testnet`, receiver the approved contract, exactly one `pay_instant_native`, exact `100000000000000000000000` yoctoNEAR = 0.1 NEAR.
- Successful funding receipt `Zyj9hfcEsqZQ4DiDDqyZaVYsEqCkv4ppkshVms9Y1uJ`, height 275767733.
- Successful native payout receipt `3kLbAxp9Q4XC1DCr7BNF6Vcy6XPYmNJyTHADA9R9MTv4`, height 275767734, recipient `taplytest.testnet`, exact principal.
- Successful private callback receipt `3FZ4Eu6JYy9LHikK42hx5E6ZAsrTgcnZ3i4CN7hQgvJp`, height 275767735, nonce 1; transfer/callback dependency and events agree.
- FINAL execution and FINAL_PAID state. Contract access-key lists/nonces agree from immediately before funding through each verifier's state tip; no contract-account signing activity detected in those windows. This does not establish monitoring before that window or after the saved observations.
- Public RPC state block 275770197; FastNEAR state block 275770277. Different live tips are expected in sequential runs; both verified the same historical payment graph. Original evidence in `docs/evidence` is unchanged.

Each proof used 12 reads: approximately 37,440 ms public RPC versus 1,373 ms FastNEAR, as the sum of recorded request durations in this single sample. No fresh signature, broadcast, account creation, funding, deployment or Mainnet call occurred. The original payment was CLI initiated; this is not mobile-wallet redirect acceptance.

## Journey audit

| Step | Current behavior and finding |
| --- | --- |
| Connect | External connector is lazy, Testnet-only, explicit connect, no sign-in key addition. The single connector promise avoids repeat SDK initialization. Manifest/physical-wallet latency was not measured by signing. |
| Finalized balance | Public balance = status + final block + anchored account (3 reads). Refresh on visibility/account change; never substitute zero on an RPC failure. Native snapshot is 6 reads, now 4 sequential rounds. |
| Prepare amount/request | Exact integer values, shared canonical terms and one creation nonce. No network needed for pure prepare*. Keep payer restriction, expiry, full recipient and bond review when options move into the simplified UI. |
| Quote | 4 reads: status, final block, contract account/code, quote. Config is separately verified (another 4). The repeated network/code checks bind separate observations to their own blocks; caching them across reviews would weaken safety. |
| Authorization | Explicit external wallet request or hard-disabled native signer. Native review has 60-second TTL, exact action/deposit/nonce/block, explicit confirmation and fresh checks afterward. Do not remove this revalidation as duplicate work. |
| Submit | One native send_tx attempt; hash and unsigned public bytes durably persisted beforehand. No SDK Account convenience methods or retrying provider. External redirect uses its existing journal. Failure/timeout is an unknown outcome, never authorization for a second payment. |
| Observe FINAL | Poll reads, backoff 4–20 seconds, visibility aware; no socket authority. Transaction observer's block reads now overlap. Backend execution success deliberately remains NOT_VERIFIED for settlement. |
| Verify independently | Separate payout graph verifier checks actual receipt actions, native transfer, callback, events, times, approved code and account activity. Duplicate transaction reads in native reconciliation serve different validators and were retained. |

No internal settlement states were collapsed: OPEN, in-flight, contract-paid and independently verified have different meanings. Reducing their number would obscure uncertainty rather than make the engine faster.

## RPC reliability and browser results

Both providers passed Chromium 156.0.8078.4 desktop and Pixel 7 emulation CORS tests from a local browser origin: status/genesis, final block, anchored approved contract account, FINAL receipt payloads. [Browser evidence](evidence/phase5b-2026-11-01/browser-cors.json). Public RPC calls were roughly 3.1 seconds each after the first request; FastNEAR about 80–248 ms. This observation suggests a provider latency issue worth monitoring, not a universal provider ranking.

```sh
# Point to an isolated playwright@1.64.1 index.mjs; no workspace dependency change.
node packages/near-client/scripts/check-rpc-cors.mjs <new-browser-results.json>
```

Set `TAPLY_PLAYWRIGHT_MODULE` for that command. Production HTTPS origin, physical iOS/Android, WebKit CORS and real interruption/redirect acceptance still require device checks. Local Chromium emulation does not establish those results.

No automatic provider fallback was introduced. A future fallback must restart the entire logical read/verification against one provider, recheck exact Testnet genesis and sync state, preserve each query's block anchor, and retain provider provenance. Never splice receipt/block/state responses from different providers or reuse a cached identity across a switch. Never fail over a broadcast, infer payment failure from RPC failure or automatically resubmit an ambiguous hash.

Read transports already enforce credentials omission, refused redirects, no-store, bounded streaming bodies, timeouts including body reads, strict duplicate-aware lossless JSON and matching RPC IDs. Native SDK transport is separately one-shot. General account/contract reads prove finalized provenance but do not enforce a wall-clock age limit; `stale:false` means this operation read successfully, not that a provider's finalized tip is recent. Native signing rejects snapshots older than 90 seconds or more than 10 seconds in the future. A stalled but non-syncing provider and stale UI config remain frontend integration risks below.

## Native wallet security review

- Browser Web Locks serialize vault writes and submissions; absent locks fail closed. A queued separate backend rechecks the shared journal after obtaining the lock, before confirmation. It cannot send behind an UNKNOWN operation. Locks do not coordinate another device/external wallet using the same key.
- Locked/replaced vaults, backgrounding, five-minute expiry and lock/reunlock invalidate signing leases. Tests prove revoked leases cannot reach transport. Snapshot nonce is rechecked; the last finalized journal nonce prevents signing the same bytes after stale reads. New finalized hash/time guards close the reviewed inconsistency gap.
- Hash, public unsigned transaction bytes, identity and operation phase persist before transport; signed bytes and secrets are excluded. One shot includes HTTP, RPC, timeout and response-body interruption cases. Reload recovery queries only the same hash and independently reconciles the complete FINAL graph. Missing/pruned evidence stays unknown and blocks new local spends indefinitely.
- AES-256-GCM with authenticated metadata; PBKDF2-SHA256 600,000 iterations, random salt/IV, nonextractable unlocked Ed25519 key, bounded passphrase policy. Backup restore authenticates identity/private-key correspondence, refuses overwrite and starts locked. Encrypted backup is not a pending-transaction-journal backup: recovery on another profile cannot prove there are no unresolved transactions on the original device. Do not activate native signing until that recovery boundary has an approved operational procedure.
- Encryption protects storage, not unlocked keys from same-origin XSS, malicious extensions or a compromised build. Current browser UI and confirmation callbacks share that origin. No guaranteed JavaScript secret erasure, hardware isolation, custody service or password-reset key escrow is claimed.
- Inspected installed near-api-js 7.4.0: `sendTransactionUntil` calls sendJsonRpc once; ordinary JsonRpcProvider uses retryConfig and SDK Account has transaction retry paths. The overridden OneShotWalletProvider is necessary; do not replace it with convenience Account/FallbackProvider methods. Production dependency audit reported 0 advisories across 165 production/optional dependencies on this date; this is not a supply-chain audit. No dependency version changed.

## Precise frontend integration instructions for Claude

These files were inspected only; no `apps/web` edits were made.

1. `use-payment-request.ts`: dependency changes while a read is in flight currently skip the new read and can allow the old request/account result to populate state. Invalidate the old generation on cleanup; tag results by request ID/reader/account; queue the newest read when the prior request finishes. Test switching A→B and payer accounts during delayed RPC, including unmount and visibility resume.
2. `use-native-balance.ts`: visibility/manual refresh can overlap identical reads. Coalesce only the same in-flight account+provider read, retaining account/generation tags. Do not cache balances across account/provider changes or drop the resume refresh after an interruption.
3. `context.tsx` and `CreateRequest.tsx`: config time is captured at provider mount; a long-lived tab can build an already-expired request or retain an outdated capability check. Refresh the verified config/final block before constructing new terms when aged or after resume. Never mutate already-reviewed terms/nonce on a quote timeout; require an explicit new review.
4. External adapter (`near-connect.ts`) does not have the native backend's cross-tab Web Lock around its journal/signing operation. Preserve all existing journal brakes; before adding cross-tab coordination, scope the lock to account/network/request/method and re-read the journal under it. Contract idempotency already rejects duplicate funding, but duplicate prompts/gas are still possible.
5. Public account/contract reads have no final-tip wall-clock age gate. Treat old observed timestamps as unavailable/stale for financial actions and label informational balances accordingly. Choose a reviewed clock-skew policy and test stale-but-not-syncing nodes; do not equate recently checkedAt with fresh chain time. A clock problem should stop signing, not claim payment failure.
6. `verify/rpc.ts`: production independent verifier currently loads the entire body with response.text() before checking its size; its abort depends on fetch honoring the signal. Port the bounded streaming/timeout race used by near-client, preserving VerifierRpcError mapping and integer parser. Test a hanging body, oversize streaming and UTF-8 byte limits. Keep the verifier's rooted payout logic unchanged.

Keep full exact terms, permanent bond, permitted payer, expiry and contract identity in the compact review. `get_receipt` remains CONTRACT_FACTS_NOT_FINALITY_PROOF. No auto-second-payment or auto-retry after reload, timeout, connection loss or elapsed time; the existing deliberate same-intent re-review path is distinct from automatic retry. New UI animations must depend on the independent verifier result.

## Validation and remaining gates

Frozen install passed (Node 24.22.2, pnpm 11.5.0). Full `pnpm check` passed with 92 shared, 155 near-client and 379 web tests before three additional regression tests; the final package/CI counts are recorded in the delivery. Existing jsdom scroll/navigation warnings are unchanged. Focused final tests passed 19/19. `pnpm audit --prod --json` returned zero advisories. Rust/WASM were unchanged and not rebuilt or redeployed for this package-only change.

Remote workspace and offline wallet-browser CI results are recorded after pushing this branch. Physical wallet redirect, HTTPS-device interruption behavior, browser XSS/build isolation, native recovery/journal portability and contract retained upgrade authority/callback stall remain unresolved. This phase grants no new signing or deployment approval.

Current documentation checked: [NEAR transaction RPC](https://docs.near.org/api/rpc/transactions), [block queries](https://docs.near.org/api/rpc/block-chunk), [near-api-js 7.4.0 release](https://github.com/near/near-api-js/releases/tag/near-api-js%407.4.0). The wire methods were also checked against the installed SDK source.
