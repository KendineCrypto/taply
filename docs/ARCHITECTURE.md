# Taply v0.4 architecture — contract boundaries

## Components
- `apps/web` (Claude): mobile-first Next.js PWA, wallet/adaptor browser, request/checkout pages, merchant register, paired session UX, explicit signing, verified receipts.
- `apps/api` (Codex): canonical session handshake (WebSocket/SSE), rate-limited join/leave, merchant profile auth, request index and chain watcher, relayer experiment, recurrence templates, optional social login orchestration. **No server side customer keys**.
- `contracts/payments` (Codex): Rust NEAR Testnet request registry, native NEAR settlement, Protected escrow and promise/callback payout/refund, optional NEP-141 adapter.
- `packages/near-client` (Codex): RPC reading, finality/provenance verification, transaction preparation and link to explorer. Separate signing adapter in browser.
- `packages/shared` (Lead): canonical TS contract models, state enums, canonical hashing and validation schemas; keep in sync with Rust fixtures.

## Trust boundaries
1. Web displays; doesn't decide settlement. User must review and sign exact chain transaction.
2. Session server authenticates display sessions, doesn't authenticate merchants' physical identity or alter immutable payment terms.
3. Merchant profile authentication binds merchant slug to Testnet account; staff views use role-based access. Merchant slug isn't on-chain account ownership proof unless signed registration/verification performed.
4. Chain contract accepts signed on-chain calls and actual attached deposit/allowlisted FT message; strict access checks.
5. Chain watcher verifies finality and terminal payout/refund outcomes; SSE is a hint to re-fetch; UI should re-query on notification.
6. Relayer, if shipped, pays fees only for tightly bounded signed delegate actions (verify currently supported standard), per-account/session rate limits, quotas and auditable sponsorship.
7. Identity provider (Google/Apple/passkey) authenticates a person, not necessarily a spendable NEAR Testnet account. Wallet must demonstrate real Testnet key/signature and recovery.

## Network & signing
Hardcode the *logical environment* to `near-testnet` via validated configuration; avoid automatic mainnet fallback. All contract account IDs, RPC endpoints, token contracts, merchant accounts are env-controlled and verified during startup. Avoid relying on the ability to have arbitrary named testnet accounts created for free.

## Contract design choices — decision record before code
`ADR-001`: One contract receiving native NEAR into escrow; explicit payout vs deposit; no false "instant" promise.
`ADR-002`: per-intent id uses collision-resistant on-chain counter or hash+nonce, with canonical serialized fields. If counter is used, map frontend id to tx outcomes.
`ADR-003`: storage funding, cleanup, refund rules, fees, gas reserves, ext promise callback versioning, retries and liability conservation.
`ADR-004`: token standard and allowance; NEP-141 requires receiver registration and 1 yoctoNEAR on ft_transfer_call. Testnet stablecoin names must not imply real USD.
`ADR-005`: Protected Pay cancel cutoff interpretation and merchant consent attestation; impossible to retroactively extend cutoff or change protected conditions.
`ADR-006`: No special on-chain Handshake authority unless session commitment is included in signed request. A shared short code is visual comparison only.
`ADR-007`: social wallet/relayer provider; only enable if Testnet availability, account provenance and recovery can be end-to-end validated.

## Realtime topology
Customer -> QR `/checkout/slug` -> unique checkout intent/session -> payer joins via opaque join token -> verified on-chain payment request created/signed -> both clients receive `payment.update` hint -> both fetch chain authoritative status -> display `OPEN`, `LOCKED`, `REFUNDING`, `RELEASING`, `FINAL_PAID`, or refund/failure. Poll fallback every few seconds with backoff; `SSE/WebSocket disconnected` must not imply a payment failed.

## Split/recurring interaction
Each Split participant pays distinct immutable request; group status aggregates confirmed child payouts. Recurrence scheduler creates distinct UNPAID requests; **no autopay**. Keep optional features decoupled from escrow correctness.

## Deployment and observability
App and API can use managed host; contract deployed NEAR Testnet with publicly documented account id; reproducible deploy scripts and verified manifest of version+WASM hash. Env `.env.example` contains only placeholders. Never log keys, JWTs, auth cookies or session join secrets. Contracts log structured events; redact user-sensitive fields where possible. Health checks and monitoring separate `RPC_DOWN`, `SESSION_DOWN`, `CHAIN_PENDING`.
