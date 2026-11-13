# Mainnet core implementation report — 2026-11-13

**NO-GO. This is an incomplete, unvalidated contract candidate, not a mainnet
pilot.** No funds moved, accounts created, keys changed, deployments executed,
hosting/DNS modified, branches merged or mainnet receipts claimed.

## Repository and commits

Base: infrastructure `6776cdddca78cfa70ce7e8c9bd98f526e95afd41`, fetched from
`origin/claude/festive-brahmagupta-qkqex1`. Independent branch
`codex/mainnet-core`, worktree `C:/taply-phase7-integration/.worktrees/mainnet-core`.
Interface first: `197af1e08a573e8bab0285cb0fd80284fe993448`, `docs/MAINNET.md`.
Contract draft/planner: `ed3be1efdff26f89f6188bd6210d12c187049411`.
Tested shared/client additions: `5bedb8a2e3beb6a4fc1eb54dbee8033ca1fb0b27`.
Nothing was pushed or merged by this session.

Files: new `contracts/payments-mainnet` reference-derived crate, unit tests,
ABI, README, read-only deployment planner and planner tests; new
`packages/shared/src/mainnet.ts`; new `packages/near-client/src/mainnet.ts` and
mainnet tests; public exports; widened internal RPC transport network type (the
existing Testnet configuration parser stays Testnet-only); new candidate CI.
Documentation includes the owner-approved scoped AGENTS.md/CLAUDE.md notes,
README preparation status, decisions/readiness notes, verification matrix and
this report. Earlier Testnet evidence remains intact.

Existing `contracts/payments`, `contracts/payments-protected`, `apps/web`, root
manifest and lockfile have no diff against the infrastructure base. No changes
were made to Claude's worktree or Testnet deployment.

## Implemented versus missing

Candidate Rust source: fixed mainnet constructor identity/token/router/recovery
and caps, instant-only request creation, native/USDC settlement using inherited
private callbacks, router semantic validation with hold/surplus accounting,
single nonce-bound recovery operation, conservation and truthful pending states.
Protected request creation is disabled. No mainnet on-chain behavior is proven.

Shared/client: separate strict mainnet intent and request schemas, mainnet genesis
and code-hash checks, final-block USDC balance/storage readers, mainnet config
validation, create/native/token/cancel/retry/storage builders and one shared
recipient-message serializer. Existing Testnet parsers are unchanged. Mainnet
internal vault opening throws; external wallet integration is the only initial
path. No runtime network switch or cross-network fallback is exposed.

Missing: actual WASM compilation, complete adversarial Rust/sandbox execution,
mainnet wire fixtures emitted by Rust, measured callback/receiver gas and
storage margins, complete mainnet wallet-backend transaction-review integration,
frontend profile wiring, signed 1Click fixture/quote tests, Base-origin payments,
mainnet receipt-graph verifier and all live evidence. The copied sandbox and
legacy unit files are reference material; the sandbox entrypoint explicitly
refuses to run them as if they proved this mainnet interface.

## Observed checks

| Command | Observed outcome |
| --- | --- |
| `pnpm install --frozen-lockfile` | Exit 0, lock unchanged |
| Final `pnpm check` | Exit 0; shared 93, near-client 262, web 1235 passed / 7 skipped; production Turbopack build passed |
| Earlier targeted `pnpm --filter @taply/near-client test` | 260 passed, 0 failed; final workspace run includes two additional schema tests |
| `node --test contracts/payments-mainnet/scripts/deploy-dry-run.test.mjs` | 5 passed, 0 failed |
| Standalone API TypeScript and ESLint commands from workspace CI | Exit 0 |
| `node --test apps/api/test/*.test.mts` | 69 passed, 3 skipped, 0 failed |
| `pnpm --filter @taply/web exec next build --webpack` | Exit 0 |
| `node contracts/payments/scripts/check-isolation.mjs` | Frozen G1 inputs match |
| `git diff --exit-code 6776cdd -- contracts/payments contracts/payments-protected apps/web package.json pnpm-lock.yaml` | Exit 0 |
| `cargo test --manifest-path contracts/payments-mainnet/Cargo.toml --locked` | BLOCKED: cargo not installed |
| Same cargo command for payments and payments-protected | BLOCKED: cargo not installed |
| Rust fmt, Clippy, WASM and near-workspaces | NOT RUN; Docker backend startup failed, no usable Linux Rust toolchain |

The final full workspace run includes the added mainnet tests. No skipped or
blocked test is a pass.
CI definition is prepared, not an observed CI result.

## Security blockers

1. **Router execution envelope:** retaining semantic rejections is implemented
   in candidate source, but no receiver can ensure zero unused tokens when it
   lacks enough gas even to deserialize/record the delivery. Runtime/storage
   failure also rolls back its state. Returning/panicking can send funds back to
   Intents rather than the customer. The brief's unconditional guarantee is
   not proven. Router quote/signing integration remains disabled.
2. **R-2 remains open:** payout or recovery transfer may succeed while its callback
   fails. The candidate leaves the obligation in flight, never retries it or
   asserts paid. This prevents a blind double payout but can strand funds/state.
3. **Unclaimed custody:** recovery account chooses a receiver after manual
   attribution; the contract does not prove origin-chain ownership. It may only
   withdraw unclaimed held funds, not request principal. Plain FT donations are
   outside the ledger. Lifetime arithmetic overflow is fail-closed, not a
   never-panic guarantee.
4. **No execution review:** unit tests are written but unexecuted; sandbox
   adversarial/conservation/balance/gas tests and a human security review remain
   required. No audited or real-money-safe claim is made.

## Size, funding and deployment

WASM size/hash: **unknown, no build produced**. No measured funding estimate.
The earlier infrastructure estimate is not revalidated by this work.
`deploy-dry-run.mjs` requires a real WASM, reads mainnet genesis/account/USDC
storage/protocol byte cost/gas price, and prints atomic deploy+init and token
registration transactions. Its initial-state allowance and operating margin are
explicit estimates. It has no signer, broadcaster, account creation, funding,
key deletion or account deletion implementation. `--verify` reads code hash,
constructor configuration and registration after separately authorized deployment.

## Exact Claude handoff

Use the interface commit above and exports:

- shared: `MainnetIntentTermsSchema`, `MainnetRequestSchema`,
  `calculateMainnetRequestId`, `calculateMainnetTermsHash`,
  `buildInstantRecipientMessage`, mainnet USDC/cap constants;
- near-client: `MainnetProfileSchema`, `createMainnetReader`,
  `MainnetContractConfigSchema`, `mainnetConfigProblems`,
  `prepareMainnetCreateRequest`, `prepareMainnetPayment`,
  `prepareMainnetTokenStorageDeposit`, `prepareMainnetCancelUnfunded`,
  `prepareMainnetRetryPayout`.

Select the profile at build time. Supply a reviewed actual deployed code hash;
none is provided here. Keep existing Testnet adapters and vaults isolated.
Builders produce unsigned candidates and do not establish fresh chain truth:
re-read final config/request/code immediately before external-wallet review.
Do not use the existing Testnet wallet backend for these mainnet actions.
Keep Protected Pay, internal wallet and router quote/signing flags off.
FINAL_PAID at a final block supports Payment Recorded; Verified Paid is unavailable
until the relevant independent receipt verification path is implemented/proven.

## Approval-review limitation

Automatic approval review initially rejected proposed scoped notes in
AGENTS.md/CLAUDE.md as an unverified governance override. The owner subsequently
explicitly approved those notes. They authorize separate implementation while
preserving owner approval for deployment, funds, account/key permissions,
hosting, DNS and merges. They do not constitute security or deployment approval.
