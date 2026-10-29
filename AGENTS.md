# Codex — Taply v0.4 NEAR PAYMENTS + BACKEND owner

You own the security-critical Rust NEAR Testnet contracts, payment settlement state machine, Handshake service and backend. Build a **working, reproducible, signed Testnet proof**, not a mocked on-chain integration.

## Mandatory context
Read `README.md`, `docs/PRODUCT.md`, `docs/PAYMENT_STATE_MACHINE.md`, `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/UX_FLOWS.md`, `docs/MILESTONES.md`, `docs/TEST_PLAN.md`, `docs/DEMO_AND_JUDGING.md` in full before code.

## Ownership
`contracts/payments/**`, `apps/api/**`, `packages/near-client/**`, own tests/deploy scripts. Branch `feature/core`. Do not change `apps/web/**`. Request lead approval for shared schemas, root package manifests/lockfiles or shared docs. Use pinned, currently maintained near-sdk, near-workspaces, near-cli/RPC tools; confirm installed APIs against current docs before implementation.

## Required gates and order
0. Produce a concise `ADR` to lead for native NEAR exact-deposit handling, async payout callback, refund, gas/storage budget, operation nonce, idempotency, and escrow conservation. **Require security approval before escrow deployment.**
1. Testnet native wallet neutral reads, account/config verification and contract API typed fixtures; no private keys in server.
2. Build `create_request`, `cancel_unfunded`, `get_request`, `pay_instant_native`, actual recipient payout with private callback. Keep PAYOUT_IN_FLIGHT until verified; test every transition and replay.
3. Verify live Testnet transaction + final recipient funds; event proof + receipt read; add API index and provenance.
4. Merchant reusable QR profile must bind exact account and create new unique on-chain intent each time; anti-tamper and storage ownership.
5. Handshake API: unpredictable session tokens, short-lived join, canonical hash/comparison-code fixture, merchant and payer identity boundaries, WS/SSE status hints only; session service cannot settle transactions. Per-user/session rate limiting, auth, expiry and token leak controls.
6. **Protected Pay contract:** consent and immutable cancelUntilNs before funding; funded escrow `LOCKED`; payer-only `cancel_protected` before chain cutoff; `release_protected` after cutoff; atomically reserve outgoing operation state prior to async transfer; callback verifies success/failure and operation nonce; recoverable retries without double spend. Detailed conservation invariants in state-machine spec. Demonstrate both refund and release on live Testnet.
7. Production-quality read-oriented API with verification source/finality, actual chain based receipts, optional SSE watch stream, safe RPC outage behavior and CI tests.
8. Optional NEP-141 mock token via approved standard `ft_transfer_call`/`ft_on_transfer`, token allowlist, exact amounts, storage registration, unused amount return and async payout; disable unproven modes.
9. Optional Invisible Wallet/NEAR Auth investigation: explicit demonstration of Testnet account provisioning, valid Testnet signature, account recovery and logout. Mainnet availability does not establish Testnet support. Only integrate after lead security review; external wallet fallback always works.
10. Optional sponsored gas via verified NEAR standard, restricted delegate action relay, budgets and abuse rate limits. Contacts local-first; Split exact integer sums and individual intents; Recurring idempotent new requests without unattended debit. Milestone Pay **not active** without separately reviewed acceptance/dispute rules.

## Required security tests
All cases in `docs/TEST_PLAN.md` including instant payout failure, wrong caller, duplicate, replay, exact amount, forgery, protected cancel/release race, cutoff, refund callback failure, FT fake sender, merchant slug account substitution, socket spoof, auth session token replay, ambiguous RPC timeout, balances/liability conservation and resource/gas exhaustion.

## NEVER
- Mark payments FINAL on deposit alone; treat off-chain socket as truth.
- Store customer seeds/server custodial keys, deploy mainnet, pretend mock receipts are verified, autocharge recurring payments, say social OAuth is a blockchain signing key, add unrestricted relayer, ship unaudited escrow as safe for real funds.

## Deliverables per gate
Commit tested code on own branch; report exact `cargo test`/build/CLI outcomes and actual Testnet tx ids, contract ID and WASM version hash only when observed; publish ABI + callbacks + source of truth; describe unresolved security risks and API dependencies. Do not fabricate evidence.
