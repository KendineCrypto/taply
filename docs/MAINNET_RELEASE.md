# Taply Mainnet release runbook (owner-run)

Status: **implemented and tested; release NOT applied.** Every step that spends, deploys,
creates accounts or switches Production is an OWNER action. Testnet (`taplyapp.xyz`) is unchanged.

## 1. Release mode: device ledger (reviewed alternative to the server authority)

The server authority (Redis + independent freshness witness + mounted HTTP adapter) is the
only remaining Mainnet blocker that has no implementation path within the deadline. The release mode replaces it
with Codex's **unchanged** transaction coordinator on a durable per-browser IndexedDB ledger:

| Protection | Server authority | Device ledger (release) |
| --- | --- | --- |
| Reserve before signing, exact operation hash | yes | yes (same code) |
| Unknown outcome blocks every new payment until FINAL is read | account-wide | on this device |
| Lost response: precomputed hash (Taply Wallet) → FINAL reconciliation | yes | yes |
| Permanent replay tombstone per operation | account-wide | on this device |
| Concurrent tabs | linearizable | IndexedDB readwrite transaction (20-way race: 1 winner, tested) |
| Same request paid twice from two devices | blocked by Taply | blocked **on chain** for contract payments (request is paid once); direct NEAR/USDC sends: not blocked (same as any wallet) |
| Taply Wallet nonce pinning (chain nonce + 1) | yes | yes — two devices cannot both land the same nonce |

Residual risk accepted by choosing this mode: a user who deliberately repeats a *direct send* on
a second device is not stopped by Taply. Codex review requested for the one protocol change:
`MainnetGlobalAttemptStore.scope` now also accepts `'device-local'`
(`packages/near-client/src/mainnet-reconciliation.ts`, tested).

## 2. Switches (all required, all owner-approved)

1. `git apply docs/release/mainnet-signing-release.patch` — flips exactly two compile-time gates
   (`MAINNET_PROTOCOL_SIGNING_RELEASED`, `MAINNET_SIGNING_RELEASE_APPROVED`), allows the signing
   env flag only together with the device ledger, and updates the gate-closed test expectations.
   CI `mainnet-release-candidate` proves the patched tree (near-client suite, web suite, real-browser
   send → FINAL → replay refusal → lost response → UNCERTAIN → block → FINAL).
2. Mainnet Vercel env (Preview first): `NEXT_PUBLIC_TAPLY_MAINNET_SIGNING=on`,
   `NEXT_PUBLIC_TAPLY_MAINNET_LEDGER=device`. Funded 1Click quotes and the independent verifier stay closed.

## 3. Contract artifacts (reproducible; `docs/release/mainnet-wasm.sha256`)

Built with each crate's `scripts/build.sh` (Rust 1.95.0) + Binaryen 132.0.0
`wasm-opt -Oz --strip-debug --strip-producers --mvp-features`. Existing sandbox suites pass on these
exact files (CI run 43530718655: payments 7/7, gift 5/5, protected 4/4 + token 4/4).

| Contract | Account | Bytes | sha256 | NEAR code hash (env pin) |
| --- | --- | --- | --- | --- |
| payments-mainnet | `taply-pay.kendinecrypto.near` (hard-coded in contract) | 267,495 | `4d99af8c…3448` | `6DvKAXmFu1rowy7RuPMzRuvWktzouenmTCXY4n11VNKZ` |
| gift-mainnet | `taply-gift.kendinecrypto.near` (proposed) | 159,675 | `3266e4fb…ae3c` | `4PkPM3kDMMxesZ4HwBrAzJq86oy7i3b7bg1VWCY55N8s` |
| payments-protected-mainnet | `taply-escrow.kendinecrypto.near` (proposed; must differ from payments) | 251,932 | `c01b7a2f…f270` | `DvuaaqZugHBQ9QQWpi1gCxDNLcVnqPr4MY5c2M2RtGjy` |

Initializers (private: must be signed by the contract account itself):

```json
payments  new {"tokens":[{"accountId":"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","decimals":6,"symbol":"USDC"}],"routerAccountId":"intents.near","recoveryAccountId":"kendinecrypto.near","nativeCapYocto":"1000000000000000000000000","usdcCapBaseUnits":"25000000"}
gift      new {"network":"near-mainnet","contract_id":"taply-gift.kendinecrypto.near","min_amount":"10000000000000000000000","max_amount":"2000000000000000000000000","fee":"10000000000000000000000"}
escrow    new {"network":"near-mainnet","contractId":"taply-escrow.kendinecrypto.near","tokens":[{"accountId":"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","decimals":6,"symbol":"USDC"}]}
```

Gift min 0.01 / max 2 / fee 0.01 NEAR are the sandbox-tested values — owner approves or changes them.

Commands (near-cli-rs, on the owner's machine; keys never leave it). For each contract
`C` (account), `W` (wasm), `B` (initial balance), `ARGS` (above):

```bash
near account create-account fund-myself C 'B NEAR' autogenerate-new-keypair save-to-keychain sign-as kendinecrypto.near network-config mainnet sign-with-keychain send
near contract deploy C use-file W with-init-call new json-args 'ARGS' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
near contract call-function as-read-only C get_config json-args '{}' network-config mainnet now
```

USDC registration for payments and escrow (0.00125 NEAR each):

```bash
near contract call-function as-transaction 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 storage_deposit json-args '{"account_id":"C","registration_only":true}' prepaid-gas '30.0 Tgas' attached-deposit '0.00125 NEAR' sign-as kendinecrypto.near network-config mainnet sign-with-keychain send
```

Then pin in the Mainnet env: `NEXT_PUBLIC_TAPLY_CONTRACT_ID`/`..._CODE_HASH`,
`NEXT_PUBLIC_TAPLY_GIFT_CONTRACT_ID`/`_CODE_HASH`/`_MIN_YOCTO`/`_MAX_YOCTO`/`_FEE_YOCTO`,
`NEXT_PUBLIC_TAPLY_MAINNET_ESCROW_CONTRACT_ID`/`_CODE_HASH`, and the USDC code pin
`DVJx7F3dHEHJYwpYPwXHu8K9Uo7h4kXFcALucY5oNX8q`. The app re-reads the code hash at every review and
refuses on mismatch. Gift/escrow ids are refused on **Production** builds by `check-mainnet-env.mjs`
until the separate Production switch (Preview is allowed).

Keeping the deployer keys leaves the contracts upgradable by the owner (an upgrade changes the code
hash, so the app fails closed until re-pinned). Deleting them (infra runbook A8) is irreversible.

## 4. Budget (available ≈ 8.3 NEAR)

| Item | Locked | Suggested initial balance |
| --- | --- | --- |
| taply-pay (code 2.675 + state/account + USDC reg) | ≈ 2.69 | 2.75 |
| taply-gift (code 1.597 + state) | ≈ 1.61 | 1.65 |
| taply-escrow (code 2.519 + state + USDC reg) | ≈ 2.53 | 2.60 |
| Gas for 3 create + 3 deploy/init + 2 registrations | burned ≈ 0.02 | — |
| Test Taply Wallet (0.01 NEAR send + gas headroom 0.06) | — | 0.10 |
| **Total** | **≈ 6.85** | **≈ 7.12** → ≈ 1.2 NEAR spare |

Users pay their own request/gift storage deposits (escrow: 0.00612 NEAR per protected request).

## 5. Real Mainnet test ladder (each step separately owner-authorized)

1. **0.01 NEAR native send (no contract needed):** Preview build with §2 → `/m` → create Taply
   Wallet → owner sends 0.1 NEAR to its implicit account → Send 0.01 NEAR to `kendinecrypto.near`
   → Confirm → expect "Executed at a FINAL block (success)" + nearblocks link; Send the same again
   → "already executed"; Payment safety shows the permanent record.
2. Deploy taply-pay (§3) → payment request 0.01 NEAR → pay from a second wallet → FINAL + receipt.
3. Merchant checkout + Handshake with the same contract (0.01 NEAR).
4. USDC: register, 0.1 USDC send, USDC request.
5. Deploy gift → Personal/Open Gift 0.01 NEAR create → claim → refund path.
6. Deploy escrow → Protected Pay 0.01 NEAR create → fund → cancel (refund) and a second → release.
7. Only after 1–6 pass: Production switch for `mainnet.taplyapp.xyz`.
