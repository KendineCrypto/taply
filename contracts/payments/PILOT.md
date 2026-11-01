# Phase 3A: shortest controlled native Instant Pay pilot

Preparation only. No contract account, deployment transaction, real Taply payment
or VerifiedReceipt is claimed. Signing is off. Run commands from the repo root.
The detailed stop conditions and approval IDs remain in
[the pilot runbook](../../apps/web/docs/TESTNET_PILOT_RUNBOOK.md).

## 1. Safe preparation (no signature)

Use Node 24.22.2 and pnpm 11.5.0. Fresh-clone setup is in the root README.
Install official **near-cli-rs 0.30.1** on the operator's machine:

```sh
npm install --global near-cli-rs@0.30.1
near --version
pnpm install --frozen-lockfile
pnpm check
```

Expected CLI: `near-cli-rs 0.30.1`. The complete create-account and deploy/init
command paths below were parsed with that binary using `send --help` only;
none was executed. Official [CLI documentation](https://docs.near.org/tools/cli)
and [pinned release](https://github.com/near/near-cli-rs/releases/tag/v0.30.1).
The Windows release archive was also checked against its published SHA-256:
`f5927854d916a6464e0092b379a6e96d54e40bee91e0dbc483786a6f680b4cbc`.

Build the approved contract, unchanged, with the pinned Linux toolchain:

```sh
bash contracts/payments/scripts/build.sh
node apps/web/scripts/deploy-preflight.mjs wasm contracts/payments/artifacts/payments.wasm
```

Windows alternative (running Docker Desktop Linux engine required):

```powershell
& ./contracts/payments/scripts/check-docker.ps1
if ($LASTEXITCODE -ne 0) { throw 'Contract checks failed' }
node apps/web/scripts/deploy-preflight.mjs wasm contracts/payments/artifacts/payments.wasm
if ($LASTEXITCODE -ne 0) { throw 'Unapproved artifact: STOP' }
```

Require **all five preflight checks PASS**: production SHA-256
`a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2`,
NEAR code hash `BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`,
345,541 bytes and exactly the 12 approved ABI exports. Never deploy the callback
fault WASM. Do not update the pin to make a different artifact pass.

**This workstation's existing ignored WASM is different** (361,529 bytes,
SHA-256 `15328bc17b0c1cc0c21cf9eb5c13bf01a6d736fd833d1cf5f1755fc4b167c9f1`).
Its preflight fails. It was not modified or approved. Cargo is absent and the
Docker engine is stopped here, so the approved build must be reproduced on the
operator's build machine. CI uploads logs/hashes, **not WASM binaries**.

Check browser CORS without connecting a wallet:

```sh
node packages/near-client/scripts/pilot-read.mjs browser
```

Open `http://127.0.0.1:4179`, click **Run read-only checks**, then repeat with
`https://test.rpc.fastnear.com`. This checks browser POSTs for status, final block,
anchored account and FINAL receipt payloads using an unrelated public transaction.
It proves no Taply payment. Stop the server with Ctrl+C. Test again from the
chosen HTTPS pilot origin on both real devices. Browser automation permission
was declined here; only HTTP POST/OPTIONS headers and Node reads were observed.

## 2. STOP: explicit human approval before the following steps

Record the operator, exact dedicated contract/funder/recipient/payer accounts,
HTTPS preview origin and chosen wallet/provider. Accept the retained FullAccess
key risk and permanent callback-stall limitation (A0). Approve account/key creation
and funding (A1/A2), atomic deploy/init (A3), signing enablement/preview hosting
(A5/A6), request storage bond (A7) and one 0.1 NEAR payment (A8).
**No command in sections 3–5 has been executed by the agent.**

Contract key stays in the operator's local OS keychain; never export it into
Taply, chat, CI, env files or evidence. Requester and payer sign only in their
separate Testnet wallets. No private keys or seed phrases are needed from them.

## 3. Human only: dedicated account, funding and atomic deployment

PowerShell values below are placeholders to replace with the approved names:

```powershell
$contract = '<dedicated-contract>.testnet'
$funder = '<separate-cli-funder>.testnet'
$payer = '<mobile-payer>.testnet'
$rpc = 'https://rpc.testnet.near.org'
$wasm = 'contracts/payments/artifacts/payments.wasm'
```

If the operator has no dedicated CLI Testnet funding account, this optional,
separately approved command generates its key locally and requests faucet funding:

```powershell
near account create-account sponsor-by-faucet-service $funder autogenerate-new-keypair save-to-keychain network-config testnet create
```

Faucet availability and balance are not guaranteed. Ensure the separate funder
has at least 3.5 NEAR plus creation/gas charges. The two testers independently
create/fund their own Testnet wallets through their wallet's Testnet flow: recipient
needs storage-bond/gas funds (allow 0.05 NEAR), payer needs 0.1 NEAR plus gas
(allow 0.15 NEAR). These are small **demo funds only**; no Mainnet account.

Create and fund the contract with exactly one new FullAccess key:

```powershell
near account create-account fund-myself $contract '3.5 NEAR' autogenerate-new-keypair save-to-keychain sign-as $funder network-config testnet sign-with-keychain send
if ($LASTEXITCODE -ne 0) { throw 'Account creation failed or unknown: reconcile, do not resend' }
node apps/web/scripts/deploy-preflight.mjs account $contract --wasm $wasm --rpc $rpc
if ($LASTEXITCODE -ne 0) { throw 'Preflight failed: STOP' }
```

The live preflight recomputes funding from storage and gas costs. If it requires
more than 3.5 NEAR, stop and review the new amount. Never reduce its buffer to
force a pass. Deploy and initialize **in one self-signed transaction**:

```powershell
near contract deploy $contract use-file $wasm with-init-call new json-args '{}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
if ($LASTEXITCODE -ne 0) { throw 'Deployment failed or unknown: reconcile, do not resend' }
node apps/web/scripts/deploy-preflight.mjs post $contract --fresh --rpc $rpc
if ($LASTEXITCODE -ne 0) { throw 'Post-deployment check failed: STOP' }
```

Record deploy hash and the printed public `<key>:<nonce>` baseline. Read and save
the raw deploy transaction without signing anything:

```powershell
$deployTx = '<observed-deploy-hash>'
$body = @{jsonrpc='2.0'; id='deploy-evidence'; method='EXPERIMENTAL_tx_status'; params=@{tx_hash=$deployTx; sender_account_id=$contract; wait_until='FINAL'}} | ConvertTo-Json -Depth 6 -Compress
$response = Invoke-WebRequest -Uri $rpc -Method Post -ContentType 'application/json' -Body $body
[IO.File]::WriteAllText((Join-Path (Get-Location) 'contracts/payments/artifacts/deploy-tx.json'), $response.Content)
```

Require FINAL success, signer = receiver = contract, and **exactly** DeployContract
+ FunctionCall `new` with `{}` and zero deposit. Compare deployed code through
post-preflight. No key deletion/addition or other actions. Stop on any discrepancy.
Thereafter monitor hourly, including after the payment:

```powershell
node apps/web/scripts/deploy-preflight.mjs post $contract --expect-key '<public-key>:<baseline-nonce>' --rpc $rpc
```

The contract key signs only the deployment. Any later nonce/key change is an
incident and also prevents independent payment verification.

## 4. Human only: configure the real pilot

Copy `.env.example` to `apps/web/.env.local`. Substitute only the approved contract
and preview/provider configuration; these are public values, never keys:

```dotenv
NEXT_PUBLIC_TAPLY_NETWORK=near-testnet
NEXT_PUBLIC_TAPLY_CONTRACT_ID=<dedicated-contract>.testnet
NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH=BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B
NEXT_PUBLIC_TAPLY_RPC_URL=https://rpc.testnet.near.org
NEXT_PUBLIC_TAPLY_RPC_PROVIDER_ID=near-public-testnet
NEXT_PUBLIC_TAPLY_EXPLORER_BASE_URL=https://testnet.nearblocks.io
NEXT_PUBLIC_TAPLY_FLAG_WALLET=on
NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=off
NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY=off
NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE=off
NEXT_PUBLIC_TAPLY_FLAG_MERCHANT=off
```

First run with signing **off**; confirm contract configuration verifies at a final
block without a wallet prompt. Only after A5 set Instant Pay to `on`, rebuild and
host on the approved **HTTPS preview accessible by phone**:

```sh
pnpm --filter @taply/shared build
pnpm --filter @taply/near-client build
pnpm --filter @taply/web build
pnpm --filter @taply/web start
```

`start` alone provides a local server, not phone HTTPS hosting. The lead must pick
and approve the preview host and set these env values before its build. The API
server is not required for this Instant-only path. Public `NEXT_PUBLIC_*` values
are compiled into the build; changing them requires rebuilding.

## 5. Human only: two wallets, 0.1 NEAR and independent evidence

1. Recipient: open `/request/new` on desktop, connect its dedicated Testnet wallet.
   Payer: a separate account/wallet session on mobile. Confirm both network badges,
   balances and exact account IDs. Use a redirect-capable Testnet wallet offered by
   the connector. Real wallet compatibility is **still an acceptance test**.
2. Recipient: amount `0.1`, payer restriction = the approved payer, Instant mode.
   Review and sign `create_request` to the exact contract with the exact quoted
   permanent storage bond. Copy the request ID, create tx, share link and QR.
3. Before funding, collect an anchored recipient-balance/state snapshot:

   ```powershell
   $requestId = '<observed-request-id>'
   node packages/near-client/scripts/pilot-read.mjs snapshot --contract $contract --request $requestId --out contracts/payments/artifacts/pilot-before --rpc $rpc
   ```

4. Payer scans the QR on mobile. Review recipient, Testnet, Instant, `0.1 NEAR`
   = `100000000000000000000000` yoctoNEAR. Sign **one** `pay_instant_native` call
   to the approved contract, exact principal and terms hash. Return to the **same
   HTTPS origin/browser**. Check recovered hash in Your attempts and URL cleanup.
5. Wait for finalized payout and callback. PAYOUT_IN_FLIGHT is not paid. A
   FINAL_PAID state alone says Paid per contract. Open receipt, require **Verified
   Paid**, and save Copy receipt evidence JSON plus Copy verification link.
6. Read the observed funding tx and state through both providers:

   ```powershell
   $payTx = '<observed-funding-tx-hash>'
   node packages/near-client/scripts/pilot-read.mjs snapshot --contract $contract --request $requestId --tx $payTx --signer $payer --out contracts/payments/artifacts/pilot-after --rpc $rpc
   node packages/near-client/scripts/pilot-read.mjs snapshot --contract $contract --request $requestId --tx $payTx --signer $payer --out contracts/payments/artifacts/pilot-second --rpc https://test.rpc.fastnear.com
   ```

   Raw JSON-RPC bytes are preserved; snapshots are **not VerifiedReceipts**.
   Require successful Transfer of the exact principal to the recipient, successful
   matching private callback, agreeing events, FINAL execution, FINAL_PAID state
   and conserved accounting. In this isolated test let the recipient make no other
   transactions between snapshots: its increase should equal exactly 0.1 NEAR.
   If there are other balance effects, reconcile them individually.
7. Open the verification link on an independent third device (no journal). Repeat
   on a second build using FastNEAR and provider ID `fastnear-testnet`; both must
   independently produce Verified Paid. Save both receipts and raw graphs.
8. Reload `/pay/<id>`: no payment action. Simulate an unknown return only with a
   separately approved new request; do not pay again, clear storage or invent a
   new intent to escape ambiguity. The full runbook E11 is required for pilot pass.
9. Record key-baseline monitoring, app source commit, contract ID, approved WASM
   SHA, actual deploy/create/pay hashes, state blocks, payer/recipient, amounts,
   both receipt JSONs, pre/post balances and mobile video in the evidence review.
   Only after human review add real results to `docs/EVIDENCE.md` / README.

## Troubleshooting / stop conditions

| Symptom | Action |
|---|---|
| Install engine mismatch | Use `.node-version` 24.22.2 and pnpm 11.5.0; never rewrite lockfiles to force install. |
| Missing workspace dist | Build shared, then near-client, before web tests/dev. |
| Different WASM SHA, code hash, or fault build | Stop. Reproduce pinned build; new artifact requires explicit review. |
| No Docker engine/Cargo | Use the documented pinned Linux build machine; no local Rust pass is implied. |
| Wallet missing / wrong network / mobile popup issue | Use connector-listed Testnet wallet, same HTTPS origin and browser; test before payment. Never import keys into Taply. |
| Lost return / RPC timeout / no hash | Preserve journal; reconcile the same ID/hash. No automatic transfer retry. |
| Pay state FINAL_PAID but no Verified Paid | Save reason code, graph and public hash references; investigate. Pilot has not passed. |
| HISTORY_UNAVAILABLE / pruned block | Use a Testnet archival endpoint and rebuild; never skip proof checks. |
| CORS / 429 / RPC outage | Remain unresolved; run browser diagnostic, wait or choose reviewed provider. No Mainnet fallback. |
| Callback stalls >5 chain minutes | Stop all signing. Transfer may already have succeeded; no retry/refund/admin remedy exists. |
| PAYOUT_FAILED_RECOVERABLE | Stop; recipient retry requires separate A10 approval and recorded transfer failure. |
| Key baseline changed / accounting mismatch | Stop pilot and disable signing; retain evidence. |

Authoritative source: [ABI + private callback](ABI.md),
[ADR and limitations](ADR-001.md), [sandbox validation](VALIDATION.md), and
[NEAR transaction RPC / FINAL semantics](https://docs.near.org/api/rpc/transactions).
This is a configured-RPC verifier, not a light client or security audit. Protected
Pay, Handshake, merchant checkout, FT, sponsorship and social wallets stay disabled.
