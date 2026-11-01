# Taply Instant Pay — controlled Testnet pilot runbook (Phase 2E)

**Status: PREPARED, NOT STARTED, NOT AUTHORIZED.** Every step marked 🔒 needs a
recorded, explicit human approval (section 6) before it is performed. Until the
pilot actually runs and the evidence in section 5 exists, **no Taply payment has
been verified on Testnet** and none may be claimed.

Scope: one dedicated contract account, two dedicated test wallets, one small
native Instant Pay payment (suggested 0.1 NEAR), one duplicate attempt, one
mobile redirect round-trip. NEAR Testnet only. No Mainnet wallet, key, RPC or
account is used at any step.

Related: `TESTNET_DEPLOYMENT_DRY_RUN.md` (procedure and key-risk analysis),
`PHASE_2E_REVIEW.md` (what was reviewed), `contracts/payments/VALIDATION.md`.

## 0. Roles and accounts

| Role | Who | Account | Notes |
|---|---|---|---|
| Operator | one named human | `<contract>.testnet` (dedicated, new) + a separate funding account | holds the retained FullAccess key |
| Recipient | tester 1, desktop browser | `<recipient>.testnet` (dedicated test wallet) | creates the request |
| Payer | tester 2, **mobile**, redirect-style Testnet wallet | `<payer>.testnet` (dedicated test wallet) | pays; validates redirect return |
| Observer | anyone, third device | none | opens the verification link |
| Recorder | operator or lead | — | collects evidence (section 5) |

Never use a personal or Mainnet account for any role. Testers must see `testnet`
in the wallet's network indicator before every signature.

## 1. Readiness checklist (all must be ✅ before 🔒 A1)

| # | Item | Status now |
|---|---|---|
| 1 | Contract CI green: fmt, 15/15 unit, clippy, 9/9 sandbox, exports, wire, pinned artifact | ✅ (see report CI runs) |
| 2 | Web CI green: frozen install + `pnpm check` | ✅ |
| 3 | WASM SHA-256 reproduced across CI runs; code hash pinned in frontend config | ✅ |
| 4 | Independent verifier implemented; RPC format checked on genuine Testnet responses | ✅ (real Taply payment pending) |
| 5 | Redirect recovery implemented; never resubmits (tests) | ✅ (real wallets pending) |
| 6 | Read-only preflight hardened and live dry run done | ✅ |
| 7 | Retained-key risks accepted in writing by the lead | ⬜ approval A0 |
| 8 | Callback-stall limitation accepted for the pilot (not for public beta) | ⬜ approval A0 |
| 9 | Pilot frontend host chosen (non-public preview URL reachable from a phone) | ⬜ approval A6 |
| 10 | Testers have dedicated Testnet wallets; payer wallet is redirect-style on mobile | ⬜ |
| 11 | RPC provider chosen (HTTPS, CORS, not syncing); second provider for cross-checks | ⬜ |

## 2. Operator checklist — dedicated account, minimum funding, deployment

Values from read-only reads on 2026-11-01 (protocol 88). **Re-run D3 on the day:**
the preflight recomputes everything from live chain parameters.

**Funding (exact):**

| Item | Amount |
|---|---|
| Storage after deploy: (345,541 code + 182 account/key + 300 state allowance) bytes × 10^19 | 3.46023 NEAR |
| All gas bought up front by deploy+init (56.23 Tgas × 10^8) — unused part refunded after the storage check | 0.00562 NEAR |
| **Minimum** | **3.46585 NEAR** |
| Buffer (gas-price drift, state estimate) | 0.03 NEAR |
| **Fund the new account with** | **3.5 NEAR** |
| Paid separately by the funding account when creating it: account-creation charge + transaction gas | ≈ 0.007 NEAR + gas |

After deployment about 3.46 NEAR is locked as storage. Per-request storage bonds
are paid by request creators and all call gas by callers, so the contract needs
no further operational balance for the pilot.

| Step | Action | Command / check | Pass condition |
|---|---|---|---|
| D0 | Record approvals A0–A3 (section 6) | written | all present |
| D1 | Build the artifact at the approved commit on the operator's machine | `bash contracts/payments/scripts/build.sh` (Linux) or `contracts/payments/scripts/check-docker.ps1` | build succeeds |
| D2 | Verify the artifact | `node apps/web/scripts/deploy-preflight.mjs wasm contracts/payments/artifacts/payments.wasm` | 5 × PASS (fault build, SHA-256, code hash, size, exports) |
| 🔒 D3a | Create the dedicated account with exactly one new FullAccess key, initial balance 3.5 NEAR (A1, A2) | template: `near account create-account fund-myself <contract>.testnet '3.5 NEAR' autogenerate-new-keypair save-to-keychain sign-as <funder>.testnet network-config testnet sign-with-keychain send` (prefer a hardware wallet; verify flags for your near-cli-rs version) | tx succeeds |
| D3 | Pre-deployment preflight | `node apps/web/scripts/deploy-preflight.mjs account <contract>.testnet --wasm contracts/payments/artifacts/payments.wasm --rpc <rpc>` | all PASS |
| 🔒 D4 | Deploy + init in ONE transaction signed by `<contract>.testnet` (A3). No `DeleteKey` | template: `near contract deploy <contract>.testnet use-file contracts/payments/artifacts/payments.wasm with-init-call new json-args '{}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send` | tx FINAL, success |
| D5 | Post-deployment preflight, first run | `node apps/web/scripts/deploy-preflight.mjs post <contract>.testnet --fresh --rpc <rpc>` | all PASS; note printed `key: <pk>:<nonce>` |
| D6 | Confirm the deploy transaction itself | `EXPERIMENTAL_tx_status` (section 5.2) for the D4 hash: signer = receiver = contract account; actions exactly `DeployContract` + `FunctionCall new {}`; status success | as stated |
| D7 | Record baseline and start monitoring | `post <contract>.testnet --expect-key <pk>:<nonce>` hourly during the pilot | PASS every time |
| D8 | Record evidence in `docs/EVIDENCE.md` (A4) | account, D4 tx hash, D2/D3/D5/D6 outputs with block hashes | committed |

## 3. Frontend configuration

| Variable | Pilot value |
|---|---|
| `NEXT_PUBLIC_TAPLY_NETWORK` | `near-testnet` |
| `NEXT_PUBLIC_TAPLY_CONTRACT_ID` | `<contract>.testnet` |
| `NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH` | `BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B` |
| `NEXT_PUBLIC_TAPLY_RPC_URL` / `_RPC_PROVIDER_ID` | chosen provider (checklist 11) |
| `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY` | `off` for F1; `on` only in the pilot build after 🔒 A5 |
| `NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY`, `_HANDSHAKE`, `_MERCHANT` | `off` |

F1 — build with the flag **off**, open `/pay/<any id>` and the request screen:
the app must show the contract as verified (read-only `get_config` at a final
block, code hash pinned) and must offer no wallet prompt.
🔒 F2 — pilot build with the flag **on**, hosted at the approved non-public URL (A5, A6).

## 4. End-to-end pilot test plan

Use a small amount (suggested 0.1 NEAR). Record every hash; see section 5 for formats.

| Step | Who | Action | Expected result | Evidence |
|---|---|---|---|---|
| E1 | Recipient | Connect the Testnet wallet on desktop | account shown; balance read; "contract verified" | screenshot (no personal data) |
| 🔒 E2 | Recipient | Create an Instant Pay request for 0.1 NEAR, payer restricted to `<payer>.testnet` (A7). Approve in the wallet only if the wallet shows receiver `<contract>.testnet`, method `create_request`, deposit = the quoted storage bond | request page shows OPEN; share link + QR | create tx hash; request ID; `get_request` at final block |
| E3 | Payer | Scan the QR / open the link on mobile; review | recipient account, 0.1 NEAR and exact yocto `100000000000000000000000`, network Testnet, mode Instant Pay | screenshot of review |
| 🔒 E4 | Payer | Tick the confirmation, approve in the redirect wallet (A8). Wallet must show receiver `<contract>.testnet`, method `pay_instant_native`, deposit exactly 0.1 NEAR | wallet redirects back; URL params removed; "Your attempts" shows the tx hash (recovered from the redirect) | funding tx hash; screenshot of the return; journal export (5.4) |
| E5 | System | Wait for FINAL | status passes PAYOUT_IN_FLIGHT, then FINAL_PAID ("Paid per contract") on `/pay/<id>`; no CORS errors in the console | `EXPERIMENTAL_tx_status` FINAL JSON; `get_request`; `get_accounting` (conservation) |
| E6 | Payer | Open the receipt | **Verified Paid** ribbon + evidence card (funding tx, transfer receipt, callback receipt, state block, RPC provider) | "Copy receipt evidence (JSON)" output |
| E7 | Observer | Open the "Copy verification link" URL on a third device, then again with a second RPC provider build/config | Verified Paid on both, without any journal | screenshots; both evidence JSONs identical except `checkedAt`/state block |
| E8 | Payer | Duplicate attempt in the app: reload `/pay/<id>` | no pay control (request is not OPEN) | screenshot |
| 🔒 E9 | Payer | Optional contract-level duplicate (A9): sign a second `pay_instant_native` for the same ID from CLI with 0.1 NEAR | tx FINAL with `NOT_OPEN`; deposit refunded by protocol; request unchanged; receipt still Verified Paid | failed tx hash + JSON; `get_request` revision unchanged; payer balance delta = gas only |
| 🔒 E10 | Payer | Redirect decline: create a second small request (recipient, A7) and **decline** in the wallet | app shows "declined"; journal USER_REJECTED; nothing on chain | screenshot; journal export |
| E11 | Payer | Lost return: start a payment on a third request, close the wallet without returning, reopen `/pay/<id>` | attempt shown as unresolved; no approve control until the chain explains it; never an automatic retry | screenshot; journal export |
| E12 | Operator | `post <contract>.testnet --expect-key <pk>:<nonce>` | all PASS; received = paid + failed-held + in-flight | output |

Pilot passes only if E1–E8, E11 and E12 pass, E6 and E7 show Verified Paid,
and no stop condition fired. E9 and E10 are recommended and need their own approvals.

## 5. Stop conditions and evidence

### 5.1 Stop immediately (do not sign anything further) if

| # | Condition | Action |
|---|---|---|
| S1 | Any preflight FAIL (D2, D3, D5, D7) | stop; investigate; do not deploy/continue |
| S2 | App shows contract unverified / code mismatch / fault build | stop; flag off |
| S3 | Wallet shows a different receiver, method, amount, deposit or network than the app review | **decline in the wallet**; stop |
| S4 | PAYOUT_IN_FLIGHT longer than 5 minutes of chain time ("Transfer unresolved") | stop; **do not pay again, do not retry**; collect 5.2 |
| S5 | PAYOUT_FAILED_RECOVERABLE | stop; recipient retry only with separate approval A10 |
| S6 | Verifier returns a non-transient failure on FINAL_PAID (`TRANSFER_MISMATCH`, `CALLBACK_MISMATCH`, `CODE_HASH_MISMATCH`, `CONTRACT_ACCOUNT_ACTIVITY`, …) | stop; collect 5.2 including the reason code |
| S7 | `get_accounting` conservation fails or balance < storage cost | stop; flag off |
| S8 | Retained key nonce/key list changed (`--expect-key` FAIL) | incident; flag off |
| S9 | Wallet outcome unknown (no hash, no decline) | do not pay again; wait for reconciliation (journal blocks re-attempts) |
| S10 | Any Mainnet indication in a wallet, RPC or explorer | abort the session |

### 5.2 Evidence to collect for a callback failure or any ambiguous result

All read-only. Replace placeholders; use the pilot RPC and a second provider.

```sh
RPC=<rpc-url>
# Full receipt graph at FINAL (save the whole JSON)
curl -s $RPC -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":"e","method":"EXPERIMENTAL_tx_status","params":{"tx_hash":"<tx>","sender_account_id":"<signer>","wait_until":"FINAL"}}' > tx-<tx>.json
# Final block reference for the state reads below
curl -s $RPC -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":"b","method":"block","params":{"finality":"final"}}' > final-block.json
# Contract state at that block (args are base64 of {"id":"<request id>"} or {})
curl -s $RPC -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":"r","method":"query","params":{"request_type":"call_function","account_id":"<contract>.testnet","method_name":"get_request","args_base64":"<base64>","block_id":"<final block hash>"}}' > get-request.json
# Repeat with get_receipt, get_accounting ({} = e30=) and view_account / view_access_key_list
```

Plus: the app journal (`localStorage` keys `taply.journal.v1` and
`taply.wallet-return.v1`, public data only), the receipt screen's reason code or
evidence JSON, wall-clock time, RPC provider IDs, and wallet/app screenshots
without personal data. Never collect seed phrases, private keys or wallet
backups. For S4 additionally record whether the transfer receipt to the
recipient succeeded and `inFlightMayAlreadyHaveTransferred` from `get_accounting`.
There is no on-chain remedy for S4; the record stays in flight.

### 5.3 Ambiguity rules

- An RPC timeout or missing hash is never proof of failure. Re-read the same
  transaction and request; never create a new request or payment because of it.
- "Paid per contract" without Verified Paid is not a pilot pass.
- A payment is reported as verified only with the E6 evidence JSON and the E5
  receipt graph saved.

### 5.4 Journal export (payer/recipient devices)

In the browser console on the pilot origin:
`copy(JSON.stringify({journal: localStorage.getItem('taply.journal.v1'), returns: localStorage.getItem('taply.wallet-return.v1')}))`.

## 6. Actions requiring explicit human approval

| ID | Action | Moves funds / signs | Approver |
|---|---|---|---|
| A0 | Accept retained-key risks and the callback-stall limitation for the pilot | no | human lead |
| A1 | Create the dedicated contract account (name chosen) | signs, account-creation charge | human lead |
| A2 | Fund it with 3.5 Testnet NEAR | moves Testnet funds | human lead |
| A3 | Sign and send the deploy + init transaction | signs | human lead |
| A4 | Commit pilot evidence to `docs/EVIDENCE.md` | no | human lead |
| A5 | Build the pilot frontend with `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=on` | enables signing | human lead |
| A6 | Host the pilot build at a non-public preview URL | no | human lead |
| A7 | Recipient creates request(s) (storage bond ~0.006 NEAR each) | signs, moves funds | human lead |
| A8 | Payer pays 0.1 NEAR | signs, moves funds | human lead |
| A9 | Contract-level duplicate funding attempt | signs, gas | human lead |
| A10 | Recipient retry after a recorded failure | signs | human lead |
| A11 | Any use of the retained FullAccess key after deployment (incident only) | signs | human lead |
| A12 | Lock the contract (delete key), move to multisig, or retire the account | signs | human lead |
| A13 | Any public or beta exposure; resolving the callback-stall gate | — | human lead + security review |
| A14 | Merge `feature/frontend` into `main` | — | human lead |

Agents never perform A1–A3 or A5–A12; they may prepare commands and read-only checks.
