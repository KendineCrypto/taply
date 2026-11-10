# Autonomous progress log

Newest first. Each entry: what changed, exact commands, real outcomes, open items.
Plan: [AUTONOMOUS_MASTER_PLAN.md](AUTONOMOUS_MASTER_PLAN.md).

## How to resume on any machine

```sh
git fetch origin && git checkout claude/kind-cerf-c4n261
# Node 24.22.2 and pnpm 11.5.0 are required (engines are strict).
pnpm install --frozen-lockfile
pnpm check                                   # whole workspace
cd contracts/payments-protected && cargo test --locked --lib -- --test-threads=1
```

## Current checkpoint (keep updated)

- **Production:** `release/taplyapp` = `main` = `8817673` (PR #12 merged), verified live on taplyapp.xyz
  (Verified Request chip, receipt Verified Paid via the archival fallback, Protected routes present but disabled,
  no secret patterns in public JS). Previous production rollback target: `22765d7` / `dpl_mybW8sqwKCNc8uMQETrQMsTeEPEv`.
- **Dev branch:** `claude/kind-cerf-c4n261` (ahead of main by docs only).
- **Handshake progress:** `apps/api/src/redis-store.mts` (encrypted, atomic MGET + Lua CAS, TTL, Upstash REST via
  KV_REST_API_URL/KV_REST_API_TOKEN, key from TAPLY_SESSION_ENCRYPTION_KEY) — tested on a real redis-server.
- **Next (in order):** (1) async variant of `SessionEngine` transactions on `RedisDurableStore` (sessions.mts is
  synchronous today); (2) Next.js route handlers under `apps/web/src/app/api/handshake/*` (server-only env, Preview);
  (3) merchant/customer UI on `/s/[sessionId]` with ≤2 s polling; (4) two-browser test + G2 sale on
  `taply-e2e-9c2eeea4.testnet`; (5) token Instant UI on the candidate; (6) owner G1 acceptance.
- Local Redis for tests: `redis-server` binary (tests skip if absent).

## DONE on `claude/beautiful-gates-c6fhhh` (not yet merged): onboarding = external wallet OR `username.testnet` Taply Wallet

Status 2026-11-09 (see "Increment 8" below): steps 1, 2, 3 and the browser part of 5 are done and proven on real
Testnet. **Still open:** step 4 (Taply Wallet signing stays hard-off: `TAPLY_WALLET_SIGNING_ENABLED = false`
needs the documented human signer review, so the new account can receive and show its balance but not send);
step 5 PR → main → release/taplyapp → taplyapp.xyz verification (no PR opened; needs the owner's go-ahead).

Original spec:

Owner decision: **no gasless/sponsored gas** (Testnet). First launch must offer exactly two choices:
(1) connect an external wallet (existing near-connect flow), (2) pick a username → a real `username.testnet`
account is created instantly and becomes the user's Taply Wallet. Owner said: no approvals needed, finish it.

Verified facts for the implementation:
- `helper.testnet.near.org/account` (POST `{newAccountId, newAccountPublicKey}`) creates a funded top-level
  `.testnet` account (10 test NEAR); CORS preflight from `https://taplyapp.xyz` returns 204 with
  `access-control-allow-origin: https://taplyapp.xyz` → callable directly from the browser (no server, no secret).
  Proven in `packages/near-client/testnet-e2e/lib.mjs#createFaucetAccount`.
- Vault today only supports implicit accounts: `wallet-vault.ts` schema refines `accountId === publicKeyHex`
  (line ~26) and `create(password)` sets `accountId: publicKeyHex`.

Steps:
1. near-client `EncryptedTestnetVault.create(password, accountId?)`: allow a named `*.testnet` accountId
   (AccountIdSchema, ends with `.testnet`, 2–64 chars); relax the refine to "implicit ⇒ equals pubkey"; keep AAD
   binding of metadata; add `provisioning: "ON_CHAIN"` once the account is confirmed by a final `view_account`
   whose access keys include the vault's public key (`view_access_key`). Tests in near-client.
2. web: availability check (`view_account` → UNKNOWN_ACCOUNT = available), username rules (lowercase a-z0-9 _ -,
   2–40 chars + `.testnet`), create vault (password + encrypted backup download) → POST faucet with
   `ed25519:<base58 pubkey>` → poll final `view_account` + `view_access_key` → mark provisioned → mode `taply`.
   Handle: name taken, faucet 4xx/5xx/rate limit (keep local vault, offer retry; never claim the account exists).
3. First-launch chooser on `/` when no wallet is connected and no vault exists (EN/TR copy), reusing
   `ConnectWalletButton` and `components/wallet/taply/CreateWalletFlow.tsx`.
4. Native signing: `TaplySend` already uses the reviewed wallet backend; verify a real transfer from the new
   account with a disposable run; keep Instant Pay signing on the single shared review path.
5. Tests (vitest + near-client), local production build browser test creating a real `*.testnet` account, PR →
   main → release/taplyapp, verify on taplyapp.xyz.

## Owner action to make Instant Pay usable on taplyapp.xyz (verified blocker)

Production sets `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=off` in Vercel (Production scope). An explicit `off`
is a kill switch that code cannot override (lib/flags/features.ts), so public G1 signing can only be enabled in
Vercel: Project `taply` → Settings → Environment Variables → Production → set
`NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=on` → Redeploy the current production deployment (8817673).
Evidence supporting activation: automated G1 Testnet proof 2026-11-09 (FINAL_PAID, exact payout, duplicate
refused, Verified on 2 providers); signing path unit/browser CI green. NOT verified by an agent: a real
browser-wallet (wallet selector) signature — run TESTNET_ACCEPTANCE_PLAN.md once after enabling.
Rollback: set the variable back to `off` and redeploy (or Instant Rollback to the previous deployment).

## 2026-11-10

### Increment 13 — Taply Wallet stays unlocked (owner: "her işlemde şifre istiyor, açık kalsın")

- near-client vault: optional `VaultSessionStore` + `unlockMs`; unlock saves the NONEXTRACTABLE signing CryptoKey,
  the exact vault record and the expiry; `resume()` accepts it only for the current record, unexpired, a
  nonextractable Ed25519 sign key that signs a fresh challenge verified by the record's public key (else cleared);
  `lock()` clears it, `release()` (teardown) does not; long unlocks skip the setTimeout overflow. 3 new tests.
- near-client backend: a new prepare first settles an unexplained earlier attempt from FINAL chain data (same hash,
  full reconcile) — fixes "stuck after paying and leaving the page", which the real browser run exposed. 1 new test.
- web: IndexedDB session store, 30-day unlock, no lock on hide/pagehide, resume on load, auto-connect when unlocked;
  Taply pre-sign failures show "Not sent" (no longer "Different wallet account"). EN/TR copy, README.
- Real browser + Testnet (local production build, `stay-unlocked-e2e.mjs`): password asked for payment A and after
  Lock now (C) only; B on a fresh page load and a reload stayed connected; 3× FINAL_PAID, exact payouts.

## 2026-11-09 — cloud session 2

### Production proof after PR #18 (`abd101b`)

- Same real-browser script against **https://taplyapp.xyz**: wallet `taply-pay-7ab603.testnet` created on production,
  paid 0.2 NEAR in NEAR and 0.25 NEAR with test USDC (5 confirmation dialogs); both FINAL_PAID, INSTANT_PAYOUT
  SUCCEEDED, merchant deltas exactly 0.2 and 0.25 NEAR (`docs/evidence/production-taply-wallet-2026-11-09/`).

- Same day, production: wallet `taply-shop-699fb0.testnet` created a 0.05 NEAR request in the app (create_request via
  the confirmation dialog) and `taply-buyer-8a52a2.testnet` paid it from another browser context: FINAL_PAID, payout
  exactly 0.05 NEAR (`create-request-result.json`). README brought up to date (signing on, onboarding, other assets,
  G1 met on Testnet, judge steps, disclosure). `pnpm check` exit 0.

### Increment 12 — Taply Wallet signing ON for NEAR Testnet (owner decision, no independent review)

- Owner answered "Testnet'te aç" (2026-11-09). `TAPLY_WALLET_SIGNING_ENABLED = true`; README states the missing
  independent security review.
- near-client `wallet-backend.ts`: `prepareSwapTransaction` + `checkedSwapTransaction` (exact register / buy / sell
  shapes of the curated routes, signer-only account args, deposits ≤ 0.05 NEAR for storage, gas ≤ 300 Tgas, no extra
  actions); multi-action transactions journaled and reconciled action-by-action at FINAL. 3 new tests (15 refused
  mutations), signer fixture maps all actions. near-client 240/240.
- web: `ConfirmTransactionDialog` (exact receiver, action lines, attached NEAR, fee reserve) before every signature;
  `UnlockDialog`; `WalletOverride` makes every `useWallet()` screen use Taply Wallet when it is the active wallet;
  Taply send enabled; a Taply decline is `WalletDeclinedError` → "rejected, nothing was sent" (non-blocking).
- **Real browser + real Testnet** (`docs/evidence/taply-wallet-signing-2026-11-09/`): wallet `taply-pay-805157.testnet`
  created in Chromium, paid 0.2 NEAR in NEAR and 0.25 NEAR with test USDC (register → buy → convert → pay, 5 confirmations);
  both requests FINAL_PAID with INSTANT_PAYOUT SUCCEEDED for the exact amount.

### Production check after PR #17 (`98d2039`)

- Owner screenshot: Vercel Production `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=on` (changed ~4 h before; earlier notes
  saying "off" are stale). Live check: a fresh 0.1 NEAR request `634da878…5e8f07` on taplyapp.xyz shows
  "Ready to pay" with Connect wallet and no "Payments not enabled yet" (`docs/evidence/production-2026-11-09-onboarding/20-pay-page.png`).
  The asset selector appears after a wallet connects; a real browser-wallet payment is still to be done by the owner.

### Increment 11 — Any curated asset, merchant still asks only for NEAR (owner request)

- Owner: "If I request NEAR, the payer should pay with whatever asset they want, not only USDC."
  The merchant already picks nothing extra (a normal NEAR request); the payer chooses on the pay screen.
- `TESTNET_SWAP_ROUTES`: USDC (pool 1103), USDT (1084), NST (602), LNC (395), PEM (461): the deepest Ref Testnet
  pool vs wNEAR per token, no public mint, symbol/decimals pinned and re-checked on every read (all 5 read OK live).
  Arbitrary tokens are refused (a fake or illiquid token could quote any price).
- Web: "Pay with: NEAR | USDC | USDT | NST | LNC | PEM"; `TokenPay` is route-generic; EN/TR copy uses the symbol.
- Real Testnet: USDT run `docs/evidence/testnet-e2e/2026-11-09T18-19-47-447Z-usdt-pay.json` — 0.3765 USDT converted,
  request FINAL_PAID, merchant delta exactly 0.3 NEAR (script `packages/near-client/testnet-e2e/token-pay.mjs <SYMBOL>`).

### Increment 10 — Live release + pay a NEAR request with test USDC (owner request)

- **Release:** PR #15 merged (`01dc5de`), `release/taplyapp` fast-forwarded; verified on https://taplyapp.xyz with the
  real-browser phrase script: `taply-srp-a43816.testnet` created on production and re-imported in a second browser.
  Instant Pay on production is still OFF (Vercel `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=off`, owner action).
- **Research:** NEAR Intents has no Testnet (official FAQ). Ref/Rhea Testnet `ref-finance-101.testnet` (v1.9.19, 2,930
  pools) is live. Publicly mintable test USDCs have drained pools with absurd prices; `usdc.itachicara.testnet`
  (24 decimals, no public mint) pool 1103 has ~27k wNEAR, ~2.1 USDC/NEAR.
- **near-client `ref-swap.ts`:** pinned route, final-block reader (pool, metadata, payer balance/registration,
  storage bounds), exact-NEAR-out quote (reserve math + 0.5% buffer, `min_amount_out` = wanted NEAR), price-impact
  cap (5% of reserve), builders: register, buy (one wrap.testnet tx: storage_deposit + near_deposit + ft_transfer_call),
  sell (ft_transfer_call with `skip_unwrap_near: false` → native NEAR). 5 tests; quotes equal the real swap logs.
- **web:** pay screen "Pay with: NEAR | USDC" (NEAR requests only, only when signing is allowed). USDC: step 1 convert
  (separate wallet approval, FINAL outcome without failed receipts = converted; failure says USDC was returned;
  unknown blocks a blind retry), step 2 = the unchanged reviewed NEAR payment. "Enable test USDC" / "Get test USDC".
  WalletCall gained optional same-receiver `actions`; the Taply Wallet adapter refuses them. EN + TR.
- **Real Testnet proof** (`packages/near-client/testnet-e2e/token-pay.mjs USDC`, evidence
  `docs/evidence/testnet-e2e/2026-11-09T17-43-37-563Z-usdc-pay.json`): merchant asked 0.3 NEAR; payer registered,
  bought 0.662 test USDC, converted 0.6376 USDC → 0.3015 NEAR (Ref log equals the predicted output), paid; request
  FINAL_PAID, merchant delta exactly 0.3 NEAR. Not a browser-wallet run (external wallets cannot run headless).

### Increment 9 — Phantom-style Secret Recovery Phrase replaces the backup file (owner request)

Owner: "Phantom has no encrypted-backup-file step; make ours the same."

- near-client: `recovery-phrase.ts` (BIP-39 English 12 words + SLIP-10 Ed25519 at NEAR path m/44'/397'/0',
  Web Crypto only; wordlist checked against the standard SHA-256). Vault record **v2** stores only the 16-byte
  entropy, AES-GCM encrypted, derivation authenticated in AAD. `create` now makes v2; new
  `revealRecoveryPhrase(password)` and `restoreFromRecoveryPhrase(phrase, password, accountId?)`;
  `recoveryPhrasePublicKeyHex` preview. v1 (random key + file backup) vaults still unlock, rebind and restore.
  Unlock never exports a private key (the signer fixture's export guard caught a first draft that did).
- Unlock password minimum is now **8 characters** (Phantom-style); recovery is the phrase, not the password.
- web: create flow = understand → username → password → 12 words (hidden until tapped, copy, "I saved it")
  → faucet + FINAL proof → Finish. No file download. `/wallet` has "Show recovery phrase" (password first);
  older wallets keep the encrypted-file backup. Restore page = "Import recovery phrase" (+ username; a FINAL
  read must show the phrase's key on that account before anything is stored), legacy file restore under a
  disclosure. EN + TR copy.

| Command | Result |
| --- | --- |
| `pnpm check` | **exit 0**: shared 93, near-client 232, web 1,182 passed + 1 skipped |
| near-client vectors | 3 phrases derive exactly the keys near-seed-phrase 0.2.1 (MyNearWallet/Meteor) derives |
| Local prod build + Playwright, **real Testnet** (`phrase-e2e.mjs`) | `taply-srp-3d91fc.testnet` created: vault v2, 12 words, copy matched, 0 file downloads, key `ed25519:Vp6gFtY5…kQN` FullAccess on chain; a fresh browser imported the same phrase → same key, "Active on NEAR Testnet"; that phrase cross-checked with near-seed-phrase → same key. Phrase never committed. |

`onboard-e2e.mjs` / `result.json` / screenshots 01–04 are the earlier file-backup flow (superseded).

### Increment 8 — First launch: external wallet or `username.testnet` Taply Wallet (no gasless)

Branch `claude/beautiful-gates-c6fhhh` (from `main` 9788d8c + the spec commit).

- near-client `wallet-vault.ts`: `create(password, accountId?)` binds a named `*.testnet` ID
  (`NamedTestnetAccountSchema`, AAD-authenticated); implicit IDs must still equal the key;
  `rebindAccount(password, accountId)` re-seals the same key under another name (fresh salt/IV, stays locked).
  `LocalWalletIdentity.provisioning` is `LOCAL_ONLY | ON_CHAIN`; the vault itself only reports LOCAL_ONLY.
- near-client `wallet-chain.ts`: `accountExists` and `provisioning` (`view_account` + `view_access_key_list`
  at ONE final block → `ACCOUNT_NOT_FOUND` / `KEY_NOT_ON_ACCOUNT` / `ON_CHAIN`, FullAccess required).
- web `lib/wallet/testnet-account.ts`: username rules (a-z0-9, `_`/`-` only between, 2–40 + `.testnet`),
  faucet POST (no credentials/referrer/redirects, 30 s timeout, coarse outcome only).
- web controller: `isAccountAvailable`, `createNamed`, `activate()` (one faucet call per tab, then FINAL polling;
  faucet success alone is never success → `PENDING`), `rebindName` (refused once ON_CHAIN or if the new name exists);
  `read()` reports `nameTaken` when the name exists under another key.
- UI: create flow = understand → username (FINAL availability) → passphrase → faucet + on-chain proof →
  mandatory encrypted backup → home in Taply mode. `/wallet` shows "Finish account setup" / "Choose another
  username" for unconfirmed or pre-username wallets. `/` shows the two-way chooser when no wallet is connected
  and no vault exists. EN + TR copy. Receive no longer says a transfer creates a named account.

| Command | Result |
| --- | --- |
| `pnpm check` (Node 24.22.2) | **exit 0**: shared 93, near-client 226, web 1,180 passed + 1 skipped |
| near-client `node --test test/wallet-vault.test.mjs test/wallet-chain.test.mjs` | 19/19 (new: named bind, ID refusals, rebind, cancel, provisioning, accountExists) |
| web new tests | `testnet-account.test.ts`, controller activation (6), UI create/rate-limit/name-taken/receive, `first-launch.test.tsx` (4) |
| Local production build + Playwright (390×844) against **real Testnet** | created `taply-onb-535271.testnet` from the browser: 1 faucet call, FINAL `view_access_key_list` shows the vault key `ed25519:CaHhae12…R7Hp` as FullAccess, balance 10 NEAR at block 276941373, home shows "Active on NEAR Testnet"; backup file has no private fields |

Evidence: `docs/evidence/onboarding-2026-11-09/` (screenshots, `result.json`, `onboard-e2e.mjs`).
One flaky timing test (`coming back to the tab re-verifies an aged contract check`, 5 s timeout) failed once
under load in a parallel run and passed alone and in the next full run; unrelated to this change.

## 2026-11-09 — cloud session 1

### Starting point (inspected, not assumed)

- `main` = `release/taplyapp` = `22765d7` (nightly report). Production unchanged since `b67b278`.
- PR #11 merged; PRs #1–#10 still open against old phase branches (all their heads are ancestors of `main`).
- `docs/AUTONOMOUS_MASTER_PLAN.md`, `AUTONOMOUS_PROGRESS.md`, `PRODUCT_COMPLETION_MATRIX.md`
  did **not** exist on any branch: no work from a previous "autonomous completion sprint"
  was pushed beyond what is on `main`. Old `feature/frontend`, `feature/wallet-*`,
  `feature/pilot-core`, `feature/ux-reliability` are superseded by `main`.
- Baseline `pnpm check` on `22765d7` (Node 24.22.2): **exit 0** — shared 92/92,
  near-client 207/207, web 1,112 passed + 1 skipped (73 files).

### Increment 7 — Integration round

- `f92465e` R-1 fix (token payout result length) + `docs/SECURITY_REVIEW_2026-11-09.md` (AI review, not audit).
- `974ce74` reviewed-fix candidate `taply-e2e-ce38a238.testnet` re-proven (NEP-141 + native refund/release).
- `0cf93a2` Verified Request chip (live check on the real pilot sale).
- `4f0c1d1` Handshake deployment decision + README dev-branch evidence table.
- Draft PR #12 to `main` (CI via pull_request triggers).
- QA env for Protected: contract `taply-e2e-ce38a238.testnet`, code hash `963iSEB8XFKeUMY1gmj5bCuA2JMVD55ksjdLfCwiPA84`.

### Increment 6 — Token web, Protected QA against live Testnet, G2 sale, final report

- `4640e9d` token-aware Protected screens (asset selector, verified symbols/decimals, ft_transfer_call journal).
- `06086cd` local production build with QA env read the live token candidate (screenshots in `docs/evidence/qa-2026-11-09/`).
- `cc58cbb` G2 merchant-bound sale on real Testnet (session commitment matches, replay refused, Verified).
- CI on `cc58cbb`: workspace-check 42582870958 success, wallet-browser-check 42582874420 success,
  instant-pay-sandbox 42582878091 **success** (frozen G1 + merchant sandbox suites and wire check pass with shared v1.1).
  protected-pay-candidate 42579962510 success on `b9b76eb` (7 sandbox tests).
- Local `pnpm check` on `cc58cbb`: exit 0 (shared 93, near-client 219, web 1,153 + 1 skipped).
- Final Turkish report: [TAPLY_FINAL_PRODUCT_COMPLETION_REPORT.md](TAPLY_FINAL_PRODUCT_COMPLETION_REPORT.md).

### Increment 5 — Real Testnet proofs, NEP-141, verifier fallback (master mandate)

- Network: created personal environment `taply` (Testnet RPCs, faucet helper, taplyapp.xyz,
  later archival-rpc.testnet.near.org). Faucet gives 10 test NEAR per disposable account.
- `66eec39` G1 automated proof on the frozen pilot: FINAL_PAID, exact +0.01, duplicate refused,
  Verified on both providers.
- `f7ad5d3` G3 candidate on its own locked account: real refund and real release, 4 refusals.
- `b9b76eb` NEP-141: TEST-ONLY token crate, token support in the candidate (allowlist at init,
  ft_on_transfer, ft_transfer payouts, per-token ledgers), shared schema v1.1 (`nep141:<account>`,
  `FT_TRANSFER_FAILED`; native hashes unchanged), near-client token builders, sandbox 4/4.
- `29a762a` NEP-141 on real Testnet: token instant payment exact, duplicate returned, protected refund.
- `cecc48a` Receipt verifier: whole-proof fallback to FastNEAR archival after a transient failure.
  Live root cause: ~12 sequential reads at ~3.5 s each on archival-rpc.testnet.near.org.

### Increment 4 — Pushed to GitHub; Protected error states

- 2026-11-09 06:44 UTC: GitHub App write access fixed by the owner. The four
  commits `b4286f1`, `983c456`, `3d9d7c8`, `c1a7c9f` were pushed unchanged to
  `origin/claude/kind-cerf-c4n261` (verified: remote head = local head
  `c1a7c9f`; `main` and `release/taplyapp` still `22765d7`).
- CI on `c1a7c9f` (all **success**):

  | Workflow | Run | Result |
  | --- | --- | --- |
  | protected-pay-candidate (push) | 42574928267 | success — G1 isolation, fmt, 24 unit tests, clippy, WASM, sandbox clippy, **sandbox 3/3 on the GitHub runner (no local shim)**, wire check (unit + sandbox records) |
  | workspace-check (dispatch) | 42575006152 | success |
  | wallet-browser-check (dispatch) | 42575009603 | success |

- CI on `56b16c4` (latest code head): workspace-check run 42575469782 **success**
  (pnpm check, standalone API tests, production Webpack build). Run 42575348658 on
  `9cda935` was auto-cancelled by the workflow's concurrency rule when 56b16c4 was dispatched.
  Local `pnpm check` on 56b16c4: exit 0 (shared 92, near-client 216, web 1,145 + 1 skipped).

  Only `protected-pay-candidate` runs on push for this branch; the others are
  branch-filtered to `main`/`feature/*`, so they are dispatched manually.
- Protected screen, CLAUDE.md required error states:
  - **Cancellation window passed**: a cancel this device sent that lost the race
    (still LOCKED at a final block at/after the cutoff, or release committed) now
    shows "Cancellation window closed".
  - **Insufficient balance/gas** before locking: verified balance < amount + 0.01 NEAR shows
    the existing "Balance may be too low" notice.
  - **Wrong payer**: a signed payer restriction to another account shows
    "Different payer required" and disables locking.
  - Tampered terms (hash mismatch) fail closed (test added).
- `/protected/new` payer field: "Choose from contacts" (existing local picker;
  copies the exact account ID) + exact-match / look-alike hint.
- `apps/web` tests: 1,144 passed, 1 skipped (was 1,140); eslint and tsc clean.

### Increment 3 — Protected Pay on a real local NEAR node (sandbox)

- `contracts/payments-protected/sandbox/` (near-workspaces 0.24.0, near-sandbox 2.14.0):
  real refund, real release, consent/exact-principal enforcement. 3/3 pass.
  Payer refund delta is **exactly** principal − 1 yoctoNEAR − gas burnt;
  recipient release delta is **exactly** the principal.
- **Bug found and fixed:** the candidate crate was missing `.cargo/config.toml`
  (`--cfg near`, `target-cpu=mvp`). Without it near-sdk silently compiled
  pure-Rust fallbacks (no `panic_utf8`/`sha256` host imports), so every error
  became a bare `unreachable` trap. Unit tests could not see this. Copied G1's file.
- New WASM: 372967 bytes, sha256 `93489848…e69b` (replaces the increment-1
  build, which lacked the flag). Candidate, not approved.
- Gas burnt (local node): create 3.11 Tgas, fund 2.75 Tgas, cancel 5.96 Tgas,
  release 5.93 Tgas. Storage record 612 bytes (0.00612 NEAR bond).
- `scripts/sandbox.sh`, `check-wire.mjs sandbox` (3 real-node records parse with
  the frozen shared schema); CI workflow runs the sandbox suite.
- Local-only workaround: the container caps open files at 20,000; nearcore wants
  65,535. A scratchpad `LD_PRELOAD` shim (not in the repo) reported the limit
  change as successful. CI runners do not need it.

| Command | Result |
| --- | --- |
| `cargo test --locked --lib` (candidate) | 24 passed |
| `bash scripts/sandbox.sh` (with local shim) | **3 passed** |
| `node scripts/check-wire.mjs` / `… sandbox` | 8 / 3 records valid |
| `cargo clippy` (crate + sandbox), `cargo fmt --check` | clean |

### Increment 2 — Protected Pay web flow (flag off) + NEP-141 change request

New / changed (all behind `protectedPay`, default OFF; production sets no Protected variables):

- `packages/near-client/src/protected.ts`: `createProtectedReader` (candidate
  `get_config` read anchored to one final block after the code-hash check;
  refuses the G1 pilot). 2 more tests (9 total in `protected.test.mjs`).
- `apps/web/src/lib/protected/`: `buildProtectedView` (cancel window, release
  eligibility and retry derived from chain time of a fresh final read, validated
  by the frozen `PaymentIntentResponseSchema`), `resolveProtectedSetup` +
  `protectedSigningGate` (flag + separate contract + code hash; the
  UNREVIEWED_CANDIDATE problem is waivable only with `NEXT_PUBLIC_TAPLY_PROTECTED_QA=on`),
  `buildProtectedTerms`, data hooks. Countdown helpers in `lib/format/countdown.ts`
  (indicative only; never gates an action).
- Journal: `fund_protected_native`, `cancel_protected`, `release_protected`.
  `reconcile()` explains them from finalized reads (a cancel still LOCKED at/after
  the cutoff can never execute; release is explained only by a committed branch;
  retry covers refund/release failures). Wallet-return matching: release matches on id alone.
- Screens: `/protected/[id]` (consent with the signed window, LOCKED - NOT PAID
  banner, on-chain cutoff, approximate countdown, payer-only cancel, release
  after cutoff, beneficiary retry, refunded vs released wording, no Verified
  claim) and `/protected/new` (amount, window 60 s / 5 min / 15 min / 1 h,
  optional payer). EN + TR copy (`protected-en.ts`, `protected-tr.ts`).
  `/request/new` links to it only when the Protected setup is complete.
- Env (documented in `env.d.ts`, `.env.example`): `NEXT_PUBLIC_TAPLY_PROTECTED_CONTRACT_ID`,
  `NEXT_PUBLIC_TAPLY_PROTECTED_CODE_HASH`, `NEXT_PUBLIC_TAPLY_PROTECTED_QA`.
- `docs/NEP141_CHANGE_REQUEST.md`: token wire format and contract design for
  lead approval. No token code: freeze v1 keeps `near:native` only.

Results:

| Command | Result |
| --- | --- |
| `npx vitest run src/lib/protected src/components/protected` | 13 + 14 tests pass (view, reconcile, gate, countdown, screen, create) |
| `npx vitest run src/lib/payments/__tests__/wallet-return.test.ts` | 33/33 (incl. new protected matching test) |
| `pnpm --filter @taply/web test` | 76 files, **1,140 passed**, 1 skipped (was 1,112) |
| `npx eslint .` / `npx tsc --noEmit` (apps/web) | clean |
| `pnpm check` (whole workspace, Node 24.22.2) | **exit 0**: shared 92/92, near-client 216/216, web 1,140 passed + 1 skipped; Next build lists `/protected/[id]` and `/protected/new` |

### Increment 1 — Protected Pay G3 candidate (contract + near-client)

New, additive only:

- `contracts/payments-protected/` — copy of the frozen G1 source plus
  `fund_protected_native` (explicit consent echo), `cancel_protected` (payer,
  before chain cutoff), `release_protected` (anyone, at/after cutoff),
  branch-aware `retry_native_transfer` and callback, `locked`/`refunded`
  accounting in the conservation check and liquidity guard. README lists ABI,
  invariants and open security gates.
- `packages/near-client/src/protected.ts` — config schema for the candidate
  (always reports `UNREVIEWED_CANDIDATE`; refuses the G1 pilot account), and
  builders for create / fund / cancel / release / retry that mirror contract guards.
- `.github/workflows/protected-pay-candidate.yml` — fmt, tests, clippy, WASM, wire check, G1 isolation check.

Results observed in this session:

| Command | Result |
| --- | --- |
| `cargo test --locked --lib -- --test-threads=1` (payments-protected, Rust 1.95.0) | **24 passed** (15 inherited G1 + 9 Protected) |
| Mutation: allow cancel at exact cutoff | caught (1 test fails) |
| Mutation: don't count locked principal | caught (8 tests fail) |
| `cargo clippy --locked --all-targets -- -D warnings` | clean |
| `bash scripts/build.sh` | WASM 385,149 bytes, sha256 `244f5d66…2df5` — **superseded in increment 3** (built without `--cfg near`) |
| `node contracts/payments-protected/scripts/check-wire.mjs` | 8 records, states OPEN, LOCKED, REFUND_IN_FLIGHT, REFUND_FAILED_RECOVERABLE, CANCELLED_REFUNDED, RELEASE_IN_FLIGHT, RELEASE_FAILED_RECOVERABLE, FINAL_PAID — all parse with the **unchanged** shared schema |
| `node contracts/payments/scripts/check-isolation.mjs` | frozen G1 inputs unchanged |
| `node --test test/protected.test.mjs` (near-client) | 7/7 |

Not done / open:

- (Resolved in increment 3: sandbox run, gas measured.)
- Not deployed anywhere. Needs Codex/lead review (files outside `apps/web`) and human escrow review.
