# NEAR Intents / 1Click — non-spending evidence, 2026-11-16

Everything here is **read-only or dry**: no deposit address was requested, nothing
was signed, no funds moved. Collected from this branch's code in a cloud sandbox.

| File | What it shows | How it was produced |
| --- | --- | --- |
| `token-list-usdc.json` | Live 1Click token list (231 tokens). Base USDC = `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near`, 6 decimals, contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` — identical to Taply's allowlist. NEAR USDC = `nep141:17208628…36133a1`. | `GET https://1click.chaindefuser.com/v0/tokens` |
| `live-dry-quote-1usdc.json` | A **real dry quote** built by Taply's own `buildQuoteRequest` (recipient `taply-pay.kendinecrypto.near`, synthetic request id / terms hash in `customRecipientMsg`), sent by Taply's bounded client and accepted by `verifyQuoteResponse` with the production 1Click manager key `ed25519:reYaWhvw…Vifc` (signature, echo of every field, `amountOut = minAmountOut = 1.000000`, no deposit address). `amountIn 1.010213`, `minAmountIn 1.000110`, estimate 35 s. | `node apps/web/scripts/oneclick-live-dry.mjs <out> '<json>'` (see script header) |
| `live-dry-quote-0.5usdc.json` | Same at Taply's minimum principal 0.50 USDC: `amountIn 0.505155`, `minAmountIn 0.500103`, verified. | same |
| — | **Tamper check on the real signed response**: original verifies; changing `amountIn` by 1 unit, `recipient`, `customRecipientMsg`, `timestamp`, or using another key → all rejected. | SDK `verifyQuoteSignature` via `apps/web/src/server/mainnet/oneclick/sdk.ts` |
| `contract-state.txt` | Code hashes of `taply-pay` (`9VpaiMp3…2wX6`), `taply-gift`, `taply-escrow` match their pins; `routerAccountId = intents.near`; both payment contracts are registered on USDC. | `view_account`, `get_config`, `storage_balance_of` at final |
| `pay-config-accounting.txt` | Full `get_config` (gas table: `ftOnTransfer` 40 Tgas) and `get_accounting`: USDC `received = routerReceived = unclaimedHeld = 0` (no router delivery has ever happened), NEAR liquidity above the `LOW_LIQUIDITY` threshold. | `get_config`, `get_accounting` |
| `intents-gas-*.txt` | Two **live mainnet** `intents.near` withdrawals with a `msg` (ft_transfer_call): the router signs `execute_intents` itself, attaches ~278 Tgas to `ft_transfer_call`; the receiver's `ft_on_transfer` got 222–270 Tgas. | `EXPERIMENTAL_tx_status` |
| `near-intents-source-commit.txt` | near/intents commit read for the withdrawal semantics: `FtWithdraw::min_gas` (ft_transfer_call default 50 Tgas, hard minimum 30 Tgas, plus a weight-1 share of unused gas) and `ft_resolve_withdraw` (refund to the intents account when the receiver uses less; no refund only if the result cannot be read). | `git clone --depth 1 https://github.com/near/intents` |

What this evidence does **not** show: a funded quote, a deposit, a router delivery to
Taply, or a Base transaction. Those need the owner-approved real test in
`docs/MAINNET_1CLICK_RUNBOOK.md` §6.
