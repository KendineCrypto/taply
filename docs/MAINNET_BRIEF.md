# Taply mainnet port + NEAR Intents: working brief

Save this file in the repository as `docs/MAINNET_BRIEF.md`. Both agents (Codex and Claude Code) work from it. I am the owner. Read all of it before changing anything.

## 0. Values I must fill in before you start

If any of these is still a placeholder, stop and ask me.

| Item | Value |
|---|---|
| Mainnet hostname | `<mainnet.taplyapp.xyz>` |
| Production contract account | `<name I will create>` |
| Staging contract account (keeps its key, deleted afterwards) | `<name I will create>` |
| Recovery account (my own named mainnet account, see 4.3) | `<mine.near>` |
| Per-request cap, USDC | `25000000` (25 USDC) unless I say otherwise |
| Per-request cap, NEAR | `<yoctoNEAR, about the same value>` |
| 1Click API key | none (see 3) unless I give one |

## 1. Mission

Taply is a point-of-sale PWA on NEAR Testnet, submitted to NEAR HACKATHON, track Real-World Money. Judging uses the repository as it stands at **2026-11-14 23:59 UTC**. This brief was written on 2026-11-13 around 07:00 UTC.

Goal: run the whole app on NEAR mainnet as a **second deployment** next to the Testnet one, with requests priced in USDC and payment from other chains through NEAR Intents 1Click.

- taplyapp.xyz keeps serving today's Testnet build, unchanged, until at least 2026-11-25. The submission and all existing evidence point at it.
- The mainnet build comes from the same codebase, selected at build time, on its own hostname and its own Vercel project.
- A feature counts as ported only after it has run on mainnet with evidence under `docs/evidence/`.

`docs/READINESS_2026-11-12.md` section F and `AGENTS.md` ("NEVER ... deploy mainnet") forbid this. **I am overriding that decision.** Record the override, dated, in `docs/DECISIONS.md` and a new `docs/MAINNET.md`, and correct the sentences in `AGENTS.md`, `CLAUDE.md` and the readiness review so the repository does not contradict itself. Keep the earlier reasoning and mark it superseded.

## 2. What cannot be undone, and the rules that follow

The website and the code can be rolled back. Money inside a contract cannot: the contracts are deployed without access keys, they are unaudited, and risk R-2 is open (`docs/R2_REACHABILITY.md`). So:

1. Only I create and fund mainnet accounts, sign mainnet transactions, pay real test payments, configure Vercel and DNS, merge to `main`, and post anything. Ask and wait. If I give a session a key, it is a throwaway deployer key in an environment variable, never one of my wallets. Nothing secret is committed.
2. Do not edit `contracts/payments` (frozen by `contracts/payments/scripts/check-isolation.mjs` and `g1-source-freeze.json`) or `contracts/payments-protected` (its build must keep producing the deployed code hash `963iSEB8XFKeUMY1gmj5bCuA2JMVD55ksjdLfCwiPA84`). The mainnet contract is a new crate.
3. The Testnet build must behave exactly as before. Its existing tests are the proof; they stay unchanged and green.
4. No runtime network switch and no fallback from one network to the other. A misconfigured build fails closed, as it does today.
5. Taply's rule holds everywhere: nothing is shown as paid until the contract reports `FINAL_PAID` at a final block. 1Click's status is a hint.
6. Every claim in README and the docs matches what was proven. Where something is not proven, say so in `docs/VERIFICATION_MATRIX.md`.

## 3. Facts already verified (do not re-derive; do re-check anything you depend on)

Checked on 2026-11-13 against live mainnet RPC (FastNEAR archival and rpc.mainnet.near.org), the live 1Click API, the official SDK and this repository.

**NEAR mainnet**
- Chain id `mainnet`, genesis hash `EPnLgE7iEq9s7yTkos96M3cWymH5avBAPm3qx3NXqR8H` (same from two providers).
- Native USDC: `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`, symbol USDC, 6 decimals. `storage_balance_bounds` min = max = `1250000000000000000000` yocto (0.00125 NEAR).
- These RPCs answered browser `fetch` calls cross-origin: `https://rpc.mainnet.fastnear.com`, `https://archival-rpc.mainnet.fastnear.com`, `https://rpc.mainnet.near.org`. Explorer: `https://nearblocks.io`.

**1Click** (base `https://1click.chaindefuser.com`, endpoints `/v0/tokens`, `/v0/quote`, `/v0/status`, `/v0/deposit/submit`; official SDK `@defuse-protocol/one-click-sdk-typescript` 0.1.26)
- A dry quote works with no API key. HACKATHON.md Q-006 says no key means a 0.2% fee. Which header a key uses differs between sources; read the docs before sending one.
- `QuoteRequest.customRecipientMsg` exists. The SDK calls it highly experimental and warns that funds are lost if the receiver lacks `storage_deposit` on the token or does not implement `ft_on_transfer`.
- A 183-byte JSON message in Taply's shape (`{"id","expectedTermsHash","action":"pay_instant"}`) was accepted and echoed back unchanged in `quoteRequest.customRecipientMsg`.
- `EXACT_OUTPUT`, 1.000000 USDC to NEAR from USDC on Base: `amountOut` exactly `1000000`, `amountIn` 1.010309 (slippage buffer, unused part is refunded to `refundTo`), estimate 35 s, `withdrawFee` 0.
- 0.10 USDC was refused: "Amount is too low for bridge, try at least 149983". Use at least 0.50 USDC in tests.
- A quote to a NEAR account that does not exist returned HTTP 400. The contract account must exist, and be registered on USDC, before quoting.
- The SDK exports `verifyQuoteSignature(response, managerPublicKey?)` with `ONE_CLICK_MANAGER_PUB_KEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc"`.
- Status values: `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `INCOMPLETE_DEPOSIT`, `PROCESSING`, `SUCCESS`, `REFUNDED`, `FAILED`.
- Origin asset ids used on mainnet by another entry: USDC on Base `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near`, on Arbitrum `nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near`, on Solana `nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near`. Take the live list from `/v0/tokens`.

**A real 1Click delivery to a contract** (mainnet tx `Afo9C89HutErBxJgqU4N9NrhMqEAV5BZLnxNSFddqzWE`, 2026-11-12, Rajista Pay)
- `execute_intents` on `intents.near` with 300 TGas.
- `intents.near` called `ft_transfer_call` on USDC with 278.3 TGas, deposit 1 yocto, args `{"receiver_id", "amount": "850000", "memo": null, "msg": <customRecipientMsg verbatim>}`.
- The receiver's `ft_on_transfer` got **258.8 TGas** and `sender_id: "intents.near"`. Taply's `pay_instant` branch needs 40 TGas, so the existing design fits, on this one measurement.
- `ft_resolve_withdraw` on `intents.near` names a 64-hex internal account as the sender. **Anything `ft_on_transfer` returns or loses by panicking goes back to Intents, not to the customer.** Rajista's contract therefore never refuses a delivery from `intents.near`; it settles or holds. Taply must follow the same rule (4.3).

**This repository**
- `contracts/payments-protected/src/lib.rs` handles native NEAR and NEP-141 tokens, instant and protected, and also has `pay_instant_native`. One mainnet contract can serve the whole app.
- Token funding is `ft_on_transfer` (about line 492) with a strict `FtMessage`. The token path was proven on Testnet: `docs/evidence/testnet-e2e/2026-11-09T08-30-51-426Z-nep141.json`.
- Every payable method calls `direct()` (signer must equal predecessor). Relayed or meta transactions cannot call them. Do not attempt gasless calls.
- `network == "near-testnet"` is hard-coded in `model.rs` `validate()` and in `get_config`.
- The build needs `.cargo/config.toml` (`--cfg near`, `target-cpu=mvp`), Rust 1.95.0, near-sdk 5.30.0. Another entry runs near-sdk 5.30.1 on mainnet.
- Runtime storage of the deployed escrow is about 430 KB, so a mainnet deployment locks about 4.3 NEAR. Each request locks about 0.006 NEAR from the merchant, permanently.
- near-client already has `prepareCreateCandidateInstantRequest`, `prepareTokenFunding`, `prepareTokenStorageDeposit` and `FT_TRANSFER_CALL_GAS` (100 TGas) in `packages/near-client/src/protected.ts`.
- About 95 non-test source files (shared, near-client, web, api) mention Testnet. The hard blockers are literals: `NetworkSchema` (`packages/shared/src/primitives.ts`), `TESTNET_GENESIS_HASH` and `ConfigSchema` (`near-client/src/rpc.ts`), `NearTestnetConfig`, `NetworkSnapshot.chainId` (`types.ts`), `ContractConfigSchema` (`contract.ts`, version `0.4.0`), `ProtectedContractConfigSchema` and `PILOT_CONTRACT_ID` (`protected.ts`), the vault metadata and `NamedTestnetAccountSchema` (`wallet-vault.ts`), `APPROVED_PAYMENT_CODE_HASH` and the swap whitelist (`wallet-backend.ts`), `resolveChainConfig` (`apps/web/src/lib/near/config.ts`), `network: 'testnet'` in `lib/wallet/near-connect.ts`, the faucet in `lib/wallet/testnet-account.ts`, the genesis import in `lib/verify/instant-receipt.ts`, and the `merchantId` prefix in `shared/src/transport.ts`.
- `apps/web/.env.production` is committed and holds **Testnet** Protected Pay values. Hosting-dashboard values override it.
- CSP `connect-src` already allows any HTTPS host (`lib/security/csp.ts`).

## 4. Design decisions

### 4.1 One new contract crate
Create `contracts/payments-mainnet` as a copy of `contracts/payments-protected` at the current commit, including `.cargo/config.toml`, the toolchain file, scripts, unit tests and the sandbox suite. All contract changes happen there.

### 4.2 Changes to the mainnet contract
1. `network` is `near-mainnet` in `validate()` and `get_config`. A distinct `contractVersion` (for example `0.6.0-mainnet`).
2. `new(...)` additionally takes, fixed forever and reported in `get_config`: `routerAccountId` (`intents.near`), `recoveryAccountId`, and a cap per asset.
3. `create_request` and `quote_create_request` refuse an amount above the asset's cap, with its own error code.
4. `protected.reviewStatus` gets a new honest value (for example `UNREVIEWED_OWNER_ACCEPTED_CAPPED`). It must not say reviewed.
5. Router policy, 4.3.
6. Nothing else changes: same state machine, same wire format for requests, same R-2 policy, same events.

### 4.3 Router policy (deliveries where `sender_id == routerAccountId`)
Reason: a refused delivery returns the money to Intents, and the customer may never see it again.

- First check that the caller is an allowlisted token. If it is not, panic as today; no real money is involved.
- After that check, **no code path may panic or return a non-zero unused amount.** Parse and validate without `require!`.
- Settle when all of these hold: the message parses, `action` is `pay_instant`, the request exists, the terms hash matches, the request's asset is this token, mode is instant, status is `OPEN`, the amount is at least the principal, and enough gas remains for the payout and its callback (measure it; 35 TGas is my estimate). Lateness alone does not block settlement: the quote was issued while the request was open. Record the payer as the router and start the payout exactly as the existing branch does.
- Everything else goes to a per-token **unclaimed** bucket: unparseable message, unknown request, wrong hash, wrong asset, protected mode, not open, short amount, low gas, and any surplus above the principal. Emit an event with a reason code, the amount and the request id if it is well-formed. Keep the log bounded.
- `withdraw_unclaimed(token, amount, receiver)`: only `recoveryAccountId`, `direct()`, 1 yocto, `ft_transfer` plus a callback that returns the amount to the bucket on failure. It can touch nothing else. I use it to refund a customer by hand.
- Conservation must cover the bucket (held, in flight, withdrawn), per token, and be asserted where the existing invariant is.
- Deliveries from any other sender keep today's strict behaviour.

This adds one admin-like power, limited to money that never belonged to a request. Say so plainly in `docs/MAINNET.md` and README.

### 4.4 Intents only pays instant USDC requests
A protected refund would go to the router. A NEAR-priced request cannot be delivered through `ft_transfer_call`. The app offers cross-chain payment only on instant USDC requests. Protected Pay stays available to payers with a NEAR wallet.

### 4.5 Taply Wallet on mainnet
There is no faucet. The wallet creates an implicit account (64 hex) from the same 12-word phrase; it becomes usable when it first receives NEAR. Named accounts need a sponsor: tell me the cost and the abuse limits and wait for my decision before building that. External wallets must work on mainnet from the first step.

## 5. Workstream A: contract (Codex)

1. Create the crate (4.1) and apply 4.2 and 4.3. Add it to CI as its own workflow, modelled on `protected-pay-candidate.yml`.
2. Unit and sandbox tests, each named for what it proves:
   - network, version and cap rules; a request above the cap is refused;
   - every existing native and token test still passes in the new crate;
   - router delivery with 250 TGas settles to `FINAL_PAID`, merchant balance up by exactly the principal;
   - router delivery with 20 TGas ends in the unclaimed bucket, request still `OPEN`, nothing lost;
   - router delivery: late but open settles; overpayment settles and holds the surplus; short, duplicate, cancelled, protected, unknown id, wrong hash, wrong asset all end unclaimed;
   - a property test with arbitrary message bytes and amounts from the router never panics and never returns unused funds;
   - non-allowlisted token caller is refused;
   - `withdraw_unclaimed`: only the recovery account, cannot exceed the bucket, restores on a failed transfer;
   - conservation including the bucket after every scenario;
   - unregistered merchant: payout fails, status `PAYOUT_FAILED_RECOVERABLE`, retry works after registration.
3. Write `contracts/payments-mainnet/README.md` and `ABI.md`: every method, argument, error code, event, gas figure, and the exact `get_config` shape.
4. A deployment script with a dry-run mode that prints each transaction. Refuse to run unless the RPC's genesis hash is the mainnet one. Steps: deploy, `storage_deposit` for the contract on USDC, `new`, read `get_config`, then (production only) delete every key and read back code hash and key count. Leave a small NEAR margin above storage in the account; the liquidity guard and the 1 yocto per token payout need it.
5. Publish the interface in `docs/MAINNET.md` **before anything else**, so the web work can start: config shape, new error codes, events, the message format, the gas each call needs.

## 6. Workstream B: shared and near-client (Codex)

1. A network profile chosen at build time: network id, chain id, genesis hash, RPC list including archival, explorer, contract id and pinned code hash, token list, router account, account-name rules. Types such as `NearTestnetConfig` become network-neutral; keep aliases if that keeps the Testnet tests untouched.
2. Schemas accept `near-mainnet` only when the profile is mainnet. A mainnet build must reject Testnet terms and the reverse.
3. A config schema for the mainnet contract, and a problems function in the style of `protectedConfigProblems`: wrong contract id, fault build, missing capability, wrong router, wrong token list, caps missing, gas below minimum. The new review status is accepted only on a mainnet build, and the UI must show it.
4. Builders for the mainnet contract: create (native or USDC, instant or protected), pay native, fund token, protected calls, retry, cancel. Reuse the existing ones where they fit. One exported function must produce the exact `msg` string used both by the wallet path and by the 1Click quote, so the two can never drift.
5. Readers: USDC balance, `storage_balance_of`, `storage_balance_bounds`.
6. Wallet backend: replace the hard-coded code hash with the profile's. Add two reviewed transaction shapes on mainnet: `ft_transfer_call` on the allowlisted token with `receiver_id` equal to the pinned contract and exactly the builder's message, and `storage_deposit` for the signer on that token with a bounded deposit. The Ref/Rhea swap shapes stay Testnet-only.
7. Vault: mainnet metadata and a separate storage key; an implicit account id is valid on mainnet; a Testnet vault must not open in a mainnet build.

## 7. Workstream C: Intents server route (Claude Code)

Server-side only, under `apps/web/src/app/api/`. The browser never calls 1Click.

1. Use the official SDK at the exact version 0.1.26 for types and `verifyQuoteSignature`, or port the verifier with tests against real responses. Add it to `THIRD_PARTY_NOTICES.md`.
2. Quote endpoint. Input: request id, origin asset, refund address. Before asking 1Click:
   - read the request at a final block: `OPEN`, instant, USDC, not expired, expiry later than the quote deadline plus a margin;
   - the contract is registered on USDC;
   - the origin asset is on an allowlist built from `/v0/tokens`; start with USDC on Base, Arbitrum and Solana;
   - the refund address matches that chain's format;
   - at most one live quote per request at a time (a lock in Redis until its deadline) and a small limit of quotes per request, because a second delivery for the same request cannot settle.
3. The quote body: `dry: false`, `swapType: EXACT_OUTPUT`, `amount` = the request's base units, `destinationAsset` = `nep141:<USDC>`, `recipient` = the contract, `recipientType: DESTINATION_CHAIN`, `depositType: ORIGIN_CHAIN`, `refundType: ORIGIN_CHAIN`, `refundTo`, `customRecipientMsg` from the shared function, `deadline`, `slippageTolerance: 100`.
4. Accept the response only if the signature verifies, the echoed `quoteRequest` equals what was sent (recipient, destination asset, amount, message, swap type, recipient type), and `quote.amountOut` equals the amount. Store the signed response with the request id and deposit address. Return only what the customer needs: deposit address, memo if any, amount to send, deadline.
5. Status endpoint by deposit address, returning the status and transaction links. Optionally forward the customer's deposit transaction hash to `/v0/deposit/submit`.
6. Map 1Click errors to plain messages (minimum amount, no liquidity, unavailable). Send `Cache-Control: no-store`.
7. Tests with recorded fixtures: every refusal above, a tampered signature, a changed echo.

## 8. Workstream D: web app (Claude Code)

1. `resolveChainConfig` accepts `near-mainnet` and builds the profile. Add `apps/web/env/mainnet.env.example`. Add a build-time check that fails a mainnet build if any resolved value names a `.testnet` account or a Testnet RPC, because `.env.production` holds Testnet values.
2. On mainnet both the instant pipeline (`lib/payments`) and the protected pipeline (`lib/protected`) talk to the one contract. Today the instant pipeline rejects a contract that reports `protectedPay` or `nep141` (`contractConfigProblems`), and `ContractConfigSchema` only accepts version `0.4.0`. Use the mainnet schema and builders when the profile is mainnet; leave the Testnet path as it is.
3. Merchant: choose NEAR or USDC when creating a request. Before a USDC request, check registration on USDC and offer the `storage_deposit` call. Show the per-sale storage cost and the cap.
4. Customer on a USDC request: "Pay from another chain" (the Intents flow: chain, token, refund address, then address, QR, amount, deadline, live status), or "Pay with NEAR wallet" (`ft_transfer_call`). After 1Click reports success, keep reading the contract and show paid only at `FINAL_PAID`. Show `REFUNDED`, `FAILED` and `INCOMPLETE_DEPOSIT` honestly, with the refund address.
5. Wallet connection: `near-connect` 0.12.0 is configured for Testnet (`network`, `providers`, `features`). Read the package's types for the mainnet options; do not guess them.
6. Labels: both dictionaries say Testnet and test funds in over a hundred places. Make the network label come from the profile. The mainnet build says NEAR Mainnet, real funds, unaudited, capped, on every screen where the Testnet pill is today, in English and Turkish.
7. Live Handshake: use a separate Redis database or key prefix for mainnet. Check join, reconnect and expiry on the mainnet host.
8. Explorer links, share origin, receipts, `/checkout`, contacts, split and recurring: check each on mainnet.
9. CSV export of the merchant's requests, read from the contract: id, time, asset, amount, status, payer, transaction links.
10. CI: add a mainnet production build to `workspace-check`.

## 9. Workstream E: receipt verifier (Claude Code, after the flows work)

1. Native path on mainnet: the profile's genesis hash and code hash instead of the Testnet constants. The receipt shape matches the escrow's `pay_instant_native`.
2. Token path from a NEAR wallet: funding transaction on the token, `ft_on_transfer` on Taply for this id and hash, one `ft_transfer` of the principal to the recipient, the callback returning true, events agreeing, code hash at every block.
3. Token path through Intents: the funding transaction is `execute_intents` on `intents.near`; the payer is the router. Verify from Taply's `ft_on_transfer` receipt onward, and say in the receipt that the origin-chain leg is reported by 1Click and not verified by Taply.
4. Until a path is implemented and tested, that path shows "Payment recorded", never "Verified Paid".

## 10. Deployment runbook (my steps; prepare them for me)

1. I create the staging account and fund it with about 6 NEAR. You give me the exact commands or run the script with the throwaway key I provide.
2. Staging keeps its key. On it: `get_config` reads correctly; a NEAR request paid; a USDC request paid from a NEAR wallet; a USDC request of at least 0.50 USDC paid through 1Click; one deliberate bad delivery (for example a cancelled request) to see it land in the unclaimed bucket and to record what 1Click reports; `withdraw_unclaimed`. Record gas at `ft_on_transfer` for every delivery.
3. If anything fails, fix, redeploy to staging, repeat.
4. I create the production account. Deploy the identical WASM, register on USDC, initialise, delete every key, read back code hash and key count. Pin that hash in the mainnet build.
5. I delete the staging account to recover its NEAR.
6. I create the second Vercel project from the mainnet branch, add the hostname and the environment variables you list (public ones, Redis, 1Click key if any).
7. On the production host, repeat the payments from step 2 as the recorded evidence.

Tell me, before step 1, the total NEAR and USDC I need and on which chains.

## 11. Evidence and documentation

- `docs/evidence/mainnet-<date>/`: one JSON per run in the existing style, with transaction links on NEAR and on the origin chain, the code hash, key count, gas measured, and the 1Click correlation id.
- README: two deployments and their hostnames; what runs on mainnet and what stays Testnet-only; the cap; the recovery account and what it can do; R-2 still open; per-sale cost; a "check it in two minutes" link to a mainnet receipt; a link to the demo post.
- `docs/VERIFICATION_MATRIX.md`: a row per mainnet feature with CI proof, real mainnet proof, production browser proof, or "not proven".
- Move internal process notes that no longer describe the product (for example `NEXT_STEPS.md`, `AGENT_START_PROMPTS.md`) under `docs/archive/` and fix links.

## 12. Order of work, and when to stop

Codex and Claude Code work in separate worktrees and branches, as before. Small commits, each with its test result. `pnpm check` and every contract workflow stay green.

1. Codex: interface in `docs/MAINNET.md`, then the contract with its tests, then the profile and builders. Claude Code in parallel: config, labels, the Intents route against fixtures.
2. Staging deployment and the staging payments (10.2).
3. Mainnet web: external wallet, NEAR request, USDC request from a NEAR wallet, USDC request through Intents.
4. Production contract, mainnet host, recorded evidence for those three payments.
5. Taply Wallet on mainnet, QR and scanner, Live Handshake.
6. Verifier on mainnet: native, then token.
7. Protected Pay on mainnet, merchant pages, tools, CSV export.

Six hours before the deadline, stop adding features. Whatever is fully proven at that point is what the documentation describes; everything else is listed as Testnet-only. I merge only a state where the Testnet build is unchanged and green.

## 13. How to report

At the end of each stage: what you changed, what you verified and how, what you could not verify, what you need from me, and anything in this brief that turned out to be wrong.