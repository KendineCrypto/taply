# Cross-chain Swap — implementation and acceptance

Built on `claude/mainnet-swap` (`429973c`). This adds a separate Cross-chain tab to `/m/swap`; the existing Rhea same-chain runner, payment request 1Click endpoints, contracts and signing policies are unchanged.

## Actual support

| Route | Asset | Funding |
| --- | --- | --- |
| NEAR ↔ Base | canonical USDC | manual transfer from the source wallet |
| NEAR ↔ Solana | canonical USDC | manual transfer from the source wallet |
| Base ↔ Solana | canonical USDC | manual transfer from the source wallet |

NEAR addresses must already have USDC storage registration where they receive output or refunds. The UI accepts recipient and refund addresses and labels the network. The deposit QR contains only an address, not token/network/amount instructions; users select those in their sending wallet. Required memos must be acknowledged before showing the QR. This implementation does **not** provide native NEAR cross-chain input, arbitrary tokens, EVM wallet connection, or automatic Taply Wallet deposit signing. The existing On NEAR tab still supports its original assets.

## Configuration

`TAPLY_CROSSCHAIN_MODE=off|dry|funded` is independent of payment 1Click configuration. Missing means off. Dry permits real signed quotes but creates no deposit address. Funded is accepted only when `VERCEL_ENV=preview`; production funding is disabled in this implementation pending funded acceptance. Existing payment release gates are not loosened.

Funded sessions require project-specific durable Redis (`KV_REST_API_URL` / `KV_REST_API_TOKEN` or the existing Upstash REST variable names). Never point the isolated test project at the production or Testnet store. Optional server-only `TAPLY_ONECLICK_API_KEY` uses the existing bounded client. Without an API key, provider pricing/fees can differ; the displayed quote includes provider fees and Taply adds no app fee.

Evidence RPCs: `TAPLY_BASE_RPC_URL`, `TAPLY_SOLANA_RPC_URL`, `NEXT_PUBLIC_TAPLY_VERIFIER_RPC_URL`. Defaults are public mainnet endpoints; rate limits and outages keep proof pending. NEAR verification additionally requires `NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH`. No credential belongs in a `NEXT_PUBLIC_*` value.

## Quote and recovery invariants

- Verify the official 1Click manager signature, echoed request fields, exact input, deadline, token listing/pins, positive output and integer slippage floor.
- Review the dry quote first. Funded minimum output cannot be below the reviewed minimum. A changed or unverifiable response is never displayed as a payment instruction.
- Reserve an owner slot in Redis atomically **before** dispatching a fundable quote. Active records have no TTL. A lost response or failed persistence leaves the slot blocked, not eligible for an automatic retry.
- A random 256-bit browser capability resumes the record through same-origin POST bodies. It is not a wallet key. Keep browser data; losing this capability loses automatic access to this UI session. It is never put in a URL.
- A pending marker is written locally before dispatch; refreshes and other tabs resume rather than create another payment address.
- Expiry is not proof of non-deposit or refund. Unknown/partial refunds remain blocked. There is no automatic replacement or expiry-based deletion. An operator must investigate unresolved attempts; this version has no operator recovery UI.
- Provider SUCCESS is shown separately from independently checked delivery. Completion requires destination-chain finality, canonical USDC, recipient, amount, transaction identity and quote-time checks. Base checks chain ID and canonical finalized block; Solana requests finalized transactions and checks mainnet genesis and recipient token-balance delta; NEAR checks mainnet genesis, complete rooted outcomes, USDC code pin and successful transfer events.
- This is verification through configured RPCs plus provider-referenced transaction hashes, not a trustless light-client proof. It does not independently prove provider intent or solve arbitrary RPC/provider collusion.
- Explicit Done archives only verified delivery or verified full-input refund through atomic compare-and-delete. Fee-deducted refunds remain unresolved. Verified results are also retained in browser Activity.

## Acceptance status (2026-11-23)

Implemented and tested with 77 targeted server, proof, HTTP boundary and UI checks. The repository-wide `pnpm check` and Mainnet build also passed. A browser visual/regression run could not start because this execution environment denied Chromium socket access and the connected-browser session was unavailable; do not treat browser screenshots or live UI QA as completed. A real signed Base → Solana **dry** quote passed signature, token listing, echo and amount validation. No deposit address was requested for that check and no funds or wallet keys were used. Real funded cross-chain completion is **not yet demonstrated**.

Before enabling funded testing: deploy the exact reviewed commit to the isolated Preview, verify mode and Redis isolation, supply real controlled source/refund/recipient addresses, obtain a current quote, review the actual input/minimum/fees, and fund once from the source wallet. Verify both source transfer and destination finalized delivery; save public hashes and actual costs. Repeat the desired reverse route and refresh/resume. Do not promote this as fully funded-verified or deploy over the live application until this evidence exists.

Automated checks:

```sh
pnpm check
pnpm --filter @taply/web exec vitest run src/server/mainnet/crosschain src/components/mainnet/swap/__tests__/crosschain.test.tsx
# Explicit opt-in, read-only provider request; always dry:
NODE_USE_ENV_PROXY=1 TAPLY_LIVE_CROSSCHAIN=1 pnpm --filter @taply/web exec vitest run src/server/mainnet/crosschain/__tests__/live.test.ts
```
