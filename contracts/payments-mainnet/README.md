# Mainnet instant candidate — NOT APPROVED FOR DEPLOYMENT

Independent source copied from payments-protected at 6776cdd. Existing contracts
are unchanged. See ABI.md and ../../docs/MAINNET.md for the protocol.

Rust 1.95.0 compilation, unit tests, Clippy and WASM builds run in GitHub Actions.
The Windows authoring host has no Cargo and its Docker backend failed to start.
See ../../docs/MAINNET_CI_HANDOFF.md for the exact verified commit, CI outcomes,
artifact size/hash and remaining blockers. A compiled artifact is not deployment
approval or live settlement evidence.

Mainnet-only constructor identities, fixed 1 NEAR/25 USDC caps, exact native/USDC
instant funding, router hold accounting and nonce-bound manual recovery are
implemented as candidate source. Protected creation is disabled. Router integration
is release-gated (intentsRouter:false). Do not enable quote or signing UI from this
source alone.

R-2 remains open: unknown callback outcome stays in flight, with no retry or admin
override. Recovery has the same limitation. Receiver deserialization/out-of-gas
can still return funds to Intents: the unconditional non-panicking requirement is
not proven and cannot hold for arbitrary gas inputs. Even honest bounded router
inputs need sandbox measurement before approval. Lifetime u128 ledger overflow is
also fail-closed, not a non-panicking guarantee. No audit has occurred.

Unit tests: cargo test --locked --lib -- --test-threads=1
Build: bash scripts/build.sh
Real local sandbox: bash scripts/sandbox.sh
Shared wire check after building @taply/shared: node scripts/check-mainnet-wire.mjs
The active suites are src/mainnet_tests.rs and sandbox/tests/mainnet.rs.
Inherited src/tests.rs, src/token_tests.rs, src/protected_tests.rs,
sandbox/tests/protected.rs, sandbox/tests/token.rs and check-wire.mjs remain
unexecuted reference material. The new sandbox uses an explicitly local standard
test token, not live USDC or the live Intents verifier. Fixed production account
guards are unchanged; accounts are injected only into the local sandbox.
The callback-fault WASM is separate from the production candidate and is never
uploaded as a deployment candidate. Production and fault builds assert their
testFaultBuild configuration in the sandbox.

Read-only deployment planner (no signing/broadcast/key removal implementation):

    node scripts/deploy-dry-run.mjs --dry-run --account devkendinecrypto.near --rpc https://rpc.mainnet.near.org --wasm artifacts/payments-mainnet.wasm

It reads mainnet genesis, account, protocol gas/storage prices and USDC storage.
It prints atomic deploy+new then token registration, all arguments and budgets.
--verify instead checks observed code hash, constructor configuration and USDC
registration after a separately owner-approved deployment. It refuses existing
contract code for deployment; migration is not supported. It never deletes keys
or staging. Neither plan nor verification constitutes approval to move funds.

    node --test scripts/deploy-dry-run.test.mjs

Token trust: allowlisted native USDC only. Unknown-token calls fail. Failed router
semantic validation is held rather than returned, but this does not guarantee
upstream customer recovery. Recovery account kendinecrypto.near controls only
unclaimed funds and chooses their recipients after manual attribution; no contract
proof binds those funds to an origin-chain customer. Plain ft_transfer donations
are outside the accounting and are not recoverable through this API.
