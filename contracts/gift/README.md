# Taply Gift contract (NEAR Testnet, not reviewed)

Claimable NEAR gifts for Taply. Native NEAR only, no owner, no admin, no upgrade.
Full design, state machine, security limitations and deployment plan: [docs/GIFT.md](../../docs/GIFT.md).

| Method | Who | Deposit | Rule |
| --- | --- | --- | --- |
| `create_gift({gift_id, public_key, amount, lifetime_s, message, design})` | anyone (becomes creator) | exactly `amount + 0.01 NEAR` | 32-hex id (unique), 32-byte ed25519 link public key, 0.01–100 NEAR, 600 s–30 days, message ≤ 280 bytes |
| `claim_gift({gift_id, signature})` | anyone with the link, not the creator | 0 | Before expiry, link-key signature over `taply-gift-claim:v1:<contract>:<id>:<predecessor>`. First accepted claim wins; pays the predecessor only |
| `refund_gift({gift_id})` | creator only | 0 | At or after expiry, still unclaimed. Pays the creator |
| `retry_payout({gift_id})` | the recorded beneficiary | 0 | Only after the callback recorded `FAILED` |
| `on_payout({gift_id, nonce})` | contract only | 0 | Records `CONFIRMED` or `FAILED`. Never transfers. Unknown result: panics and stays `PENDING` |
| `get_gift`, `get_config`, `get_accounting` | view | | `get_gift` returns `null` for unknown or malformed ids |

```sh
cd contracts/gift
cargo fmt --all --check
cargo test --locked --lib            # 23 tests
cargo clippy --locked --all-targets -- -D warnings
FAULT=1 bash scripts/build.sh        # release WASM + TEST-ONLY fault artifact, sha256 + NEAR code hash
bash scripts/sandbox.sh              # 5 tests on a real local NEAR node (near-workspaces)
```

In some containers nearcore cannot raise the open-files limit to 65,535. CI runners have the normal limit. Locally,
an `LD_PRELOAD` shim that reports `setrlimit(RLIMIT_NOFILE)` as successful was used (scratchpad only, not committed).

Never deploy the `sandbox-fail-callback` build. Deploying needs owner approval: see the plan in docs/GIFT.md.
