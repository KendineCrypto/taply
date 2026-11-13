# Taply mainnet infrastructure runbook (prepared, NOT executed)

Prepared 2026-11-13 by Claude Code (frontend/infra owner) from
[`docs/MAINNET_BRIEF.md`](MAINNET_BRIEF.md). Contract, near-client and the
deployment script are Codex's (brief §5–6); this file covers accounts, Vercel,
DNS, environment variables, isolation checks and the owner's approvals.

**Nothing in this file has been executed.** No account was created or funded,
no transaction signed, no Vercel or DNS setting changed, no key touched.
Every step that spends money, signs, changes DNS/Vercel, or deletes anything
is marked **[OWNER]** and listed again in §6.

Owner-confirmed values (2026-11-13):

| Item | Value |
|---|---|
| Mainnet hostname | `mainnet.taplyapp.xyz` |
| Production contract | `taply-pay.kendinecrypto.near` (subaccount; created by `kendinecrypto.near`) |
| Staging contract | `devkendinecrypto.near` (keeps its key; deleted at the end only after re-confirmation) |
| Recovery account | `kendinecrypto.near` — **its access keys are never added, deleted or changed by this plan** |
| Cap, native | 1 NEAR = `1000000000000000000000000` yoctoNEAR per request |
| Cap, USDC | 25 USDC = `25000000` base units per request (USDC has 6 decimals) |
| Testnet production | `taplyapp.xyz` on Vercel project `taply`, branch `release/taplyapp` — **unchanged** |

What this sandbox could and could not check: the mainnet RPCs, Vercel and DNS
are not reachable from here (the egress proxy refuses them), so the account
state of the three names above is **not verified**. §1.1 gives you a read-only
script to run. near-cli-rs 0.31.1 (latest on crates.io today) was built here
and every command below was checked against its parser (no network, nothing signed).

---

## 1. NEAR CLI: production subaccount through an owner-approved signature

### 1.0 Principles

- The signature that creates `taply-pay.kendinecrypto.near` must come from
  `kendinecrypto.near` (only a parent can create its subaccount). You approve it
  on your own device. No agent ever sees a phrase or a private key of
  `kendinecrypto.near`.
- **Do not** use `near account import-account using-web-wallet` for
  `kendinecrypto.near`: it works by *adding a new full-access key* to the
  account, which the brief forbids ("never modify access keys on
  `kendinecrypto.near`").
- The new account gets **one fresh key that you generate on your own machine**.
  It is a throwaway deployer key: it lives only until the contract is deployed,
  initialised and verified, then it is deleted (§1.6). If you choose to let a
  Codex session run the deploy script, this key — and only this key — may be
  given to it as an environment variable. It can never touch `kendinecrypto.near`.

### 1.1 Read-only preflight (run first; no signature)

```bash
near account view-account-summary kendinecrypto.near network-config mainnet now
```

```bash
near account view-account-summary taply-pay.kendinecrypto.near network-config mainnet now
```

```bash
near account view-account-summary devkendinecrypto.near network-config mainnet now
```

```bash
near account list-keys devkendinecrypto.near network-config mainnet now
```

```bash
near tokens devkendinecrypto.near view-ft-balance 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 network-config mainnet now
```

Expected: `kendinecrypto.near` exists with enough balance (§5);
`taply-pay.kendinecrypto.near` **does not exist** (if it exists, stop and tell
me: someone else cannot create it, so it would mean it was created earlier);
for `devkendinecrypto.near`, note whether it exists, its keys, any contract
code, USDC and other token balances (also check nearblocks.io → Tokens and
Staking). It must hold nothing you want to keep before it is ever deleted.

### 1.2 Choose the signing path

near-cli-rs signs with a key it can reach locally; it cannot drive a browser
wallet. Pick the row that matches where the full-access key of
`kendinecrypto.near` lives:

| Where the key is | Path | Phrase or key leaves your device? |
|---|---|---|
| **Ledger** | §1.3 with `sign-with-ledger` (recommended) | No — approved on the Ledger screen |
| Already in your OS keychain from an earlier near-cli login | §1.3 with `sign-with-keychain` | No |
| Only in a browser/mobile wallet (Meteor, HOT, MyNearWallet, …) | §1.4 (the wallet signs the same three actions) | No |

Typing your phrase into a CLI (`sign-with-seed-phrase`,
`import-account using-seed-phrase`) is **not** part of this plan.

### 1.3 Create the account with near-cli-rs [OWNER signs]

Run on **your** machine. It generates the deployer key pair, stores the private
key in your OS keychain, and asks `kendinecrypto.near` to sign one transaction:

```bash
near account create-account fund-myself taply-pay.kendinecrypto.near '6 NEAR' autogenerate-new-keypair save-to-keychain sign-as kendinecrypto.near network-config mainnet sign-with-ledger --seed-phrase-hd-path "44'/397'/0'/0'/1'" usb send
```

- Replace the HD path if your Ledger account uses another index
  (`44'/397'/0'/0'/1'` is the near-cli default).
- `usb` can be `bluetooth` (Ledger Nano X). In near-cli-rs 0.31.1 the
  transport word is required.
- If the key is in your keychain instead, replace
  `sign-with-ledger --seed-phrase-hd-path "44'/397'/0'/0'/1'" usb` with
  `sign-with-keychain`.
- `save-to-keychain` stores the new deployer key in the OS keyring; on a machine
  without one, use `save-to-legacy-keychain` (`~/.near-credentials/mainnet/`).
- To **inspect before broadcasting**, replace the final `send` with `display`:
  the CLI signs and prints the transaction but does not send it. Then run the
  command again with `send`.
- The CLI shows the transaction before it is signed. It must be exactly:
  signer `kendinecrypto.near`, receiver `taply-pay.kendinecrypto.near`, actions
  `CreateAccount`, `Transfer 6 NEAR`, `AddKey <new public key> FullAccess`.
  Anything else (a `DeleteKey`, `AddKey` on `kendinecrypto.near`, another
  receiver): **reject**.

`6 NEAR` covers ~4.3 NEAR of contract storage (brief §3: ~430 KB at 1 NEAR per
100 KB), the USDC storage deposit (0.00125 NEAR), deployment and init gas, and
the liquidity margin the contract needs for payouts. Codex must re-measure the
mainnet WASM size before funding; if it grew, raise the amount accordingly.

### 1.4 Same transaction from a browser/mobile wallet [OWNER signs]

If `kendinecrypto.near` only lives in a wallet app, the wallet must sign one
transaction with these exact fields (any NEAR wallet that accepts raw actions
through NEAR Connect / wallet-selector can do it):

```json
{
  "signerId": "kendinecrypto.near",
  "receiverId": "taply-pay.kendinecrypto.near",
  "actions": [
    { "type": "CreateAccount" },
    { "type": "Transfer", "params": { "deposit": "6000000000000000000000000" } },
    { "type": "AddKey", "params": { "publicKey": "ed25519:<DEPLOYER_PUBLIC_KEY>", "accessKey": { "permission": "FullAccess" } } }
  ]
}
```

Generate the deployer key pair on your machine first
(`near account create-account fund-later use-auto-generation save-to-folder ./taply-pay-deployer`
prints and saves an implicit-style key pair without any transaction), and put
only its **public** key in the action above. I have not built a signing page
for this; if you want one, tell me and I will add a small owner-only page that
builds exactly this transaction and nothing else, for review before use.

### 1.5 Verify the result (read-only)

```bash
near account view-account-summary taply-pay.kendinecrypto.near network-config mainnet now
```

```bash
near account list-keys taply-pay.kendinecrypto.near network-config mainnet now
```

Expect: balance ≈ 6 NEAR, code hash `11111111111111111111111111111111` (no
code yet), **exactly one** FullAccess key equal to your deployer public key.
Record the creation transaction hash in `docs/evidence/mainnet-<date>/`.

### 1.6 Later steps on the production account (Codex's script prints them)

Codex's deployment script (brief §5.4) refuses to run unless the RPC genesis
hash is mainnet `EPnLgE7iEq9s7yTkos96M3cWymH5avBAPm3qx3NXqR8H`, has a dry-run
that prints every transaction, and runs: deploy → `storage_deposit` on USDC →
`new(...)` → `get_config` → (production only) delete every key → read back code
hash and key count. For reference, the irreversible step is equivalent to:

```bash
near account delete-keys taply-pay.kendinecrypto.near public-keys ed25519:<DEPLOYER_PUBLIC_KEY> network-config mainnet sign-with-keychain send
```

**[OWNER, irreversible]** After it, the code and ~6 NEAR on the account are
fixed forever: no upgrade, no withdrawal of the storage NEAR, no bug fix. The
`list-keys` read-back must show zero keys; the code hash read back is what goes
into `NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH` / `..._PROTECTED_CODE_HASH`.

### 1.7 Staging account `devkendinecrypto.near`

- If §1.1 shows it **does not exist**: it is not a subaccount of
  `kendinecrypto.near`, so near-cli-rs builds a different transaction — signer
  `kendinecrypto.near`, receiver `near`, one `FunctionCall create_account`
  (`new_account_id`, `new_public_key`), 30 TGas, deposit 6 NEAR (checked in the
  0.31.1 source, `fund_myself_create_account/sign_as`). Same command shape
  [OWNER signs]:

  ```bash
  near account create-account fund-myself devkendinecrypto.near '6 NEAR' autogenerate-new-keypair save-to-keychain sign-as kendinecrypto.near network-config mainnet sign-with-ledger --seed-phrase-hd-path "44'/397'/0'/0'/1'" usb send
  ```

- If it **exists** and its only key is a key you also use elsewhere, add a
  throwaway deployer key to `devkendinecrypto.near` (not to
  `kendinecrypto.near`) before any session deploys to it [OWNER signs]:

  ```bash
  near account add-key devkendinecrypto.near grant-full-access autogenerate-new-keypair save-to-keychain network-config mainnet sign-with-ledger --seed-phrase-hd-path "44'/397'/0'/0'/1'" usb send
  ```

- Staging keeps its key for the whole test cycle (brief §10.2).
- Deleting it at the end [OWNER, irreversible] — only after you re-confirm it is
  disposable, `withdraw_unclaimed` has emptied the unclaimed bucket, its USDC
  balance is 0, and every Vercel Preview variable naming it is removed (once
  deleted, **anyone** can register the name again):

  ```bash
  near account delete-account devkendinecrypto.near beneficiary kendinecrypto.near network-config mainnet sign-with-keychain send
  ```

  Deleting an account returns only NEAR to the beneficiary. Tokens it still
  holds on the USDC contract are lost.

---

## 2. Isolated Vercel mainnet project

The Testnet project `taply` is **not modified**: same settings, same
environment variables, production branch `release/taplyapp`, domain
`taplyapp.xyz`. The mainnet build is a second project on the same repository.

### 2.1 Project settings [OWNER creates the project]

| Setting | Value |
|---|---|
| Team | `kendinecryptos-projects` (same team as `taply`) |
| Project name | `taply-mainnet` |
| Git repository | `KendineCrypto/taply` |
| Production branch | `release/mainnet` (new branch, see §2.3) |
| Framework preset | Next.js |
| Root Directory | `apps/web`, "Include files outside the root directory" **on** |
| Node.js | 24.x |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `cd ../.. && pnpm --filter "@taply/web^..." run build && pnpm --filter @taply/web run build:mainnet` |
| Ignored Build Step | `bash scripts/vercel-ignore-mainnet.sh` |
| Output | Next.js default |
| Deployment Protection | Vercel Authentication on **Preview** (staging uses real mainnet funds; keep it private). Production public. |
| System environment variables | "Automatically expose" **on** (default; the guard reads `VERCEL_ENV`) |
| Environment variable `ENABLE_EXPERIMENTAL_COREPACK` | `1` (all scopes; same as `taply`) |
| Domain | `mainnet.taplyapp.xyz` (Production) |

Why each isolation setting matters:

- **Build command** runs `scripts/check-mainnet-env.mjs --require-mainnet`
  before `next build`. It resolves the env exactly as Next.js will (dashboard
  values first, then `.env.production.local`, `.env.local`, `.env.production`,
  `.env`) and refuses the build if anything is Testnet (§4.3). `next.config.ts`
  repeats the same checks for any mainnet production build, so even the Testnet
  build command cannot produce an unchecked mainnet bundle.
- **Ignored Build Step** `apps/web/scripts/vercel-ignore-mainnet.sh` builds only
  `release/mainnet` → Production and `staging/mainnet` → Preview. Every other
  push (main, `release/taplyapp`, feature branches) is skipped, so a Testnet
  branch can never be built with mainnet variables. Configure it on
  `taply-mainnet` only.
- **No `vercel.json`** is added: both projects share Root Directory `apps/web`,
  so a `vercel.json` there would change the Testnet project too.
- Pushes to `release/mainnet` / `staging/mainnet` also create *Preview*
  deployments in the Testnet project `taply`. Those are Testnet builds (the
  `taply` project only has Testnet variables), behind Vercel Authentication,
  and its own Ignored Build Step already keeps them off production. No change
  to `taply` is needed.

### 2.2 Environment scopes

| Scope | Branch | Contract | Share origin |
|---|---|---|---|
| Production | `release/mainnet` | `taply-pay.kendinecrypto.near` + code hash read back after key deletion | `https://mainnet.taplyapp.xyz` |
| Preview | `staging/mainnet` only (branch-scoped variables) | `devkendinecrypto.near` + staging code hash | unset (Preview uses its own origin) |
| Development | — | none | — |

### 2.3 Branches [OWNER approves creating them]

My session may only push `claude/festive-brahmagupta-qkqex1`. You (or an agent
you authorise) create `staging/mainnet` and `release/mainnet` from a reviewed
commit. `release/mainnet` must contain only commits that already passed
`pnpm check` and the contract workflows, the same rule as `release/taplyapp`.

---

## 3. DNS records for Vercel

DNS for `taplyapp.xyz` is at Unstoppable Domains (docs/EVIDENCE.md). The
existing records stay exactly as they are:

| Keep unchanged | Type | Name | Value |
|---|---|---|---|
| apex | A | `@` | `216.198.79.1` |
| apex | A | `@` | `64.29.17.1` |
| www | CNAME | `www` | `23943aca11e4c7b4.vercel-dns-017.com` |

### 3.1 Records to add [OWNER, DNS change]

| Type | Name (host) | Value | When |
|---|---|---|---|
| CNAME | `mainnet` | the value Vercel shows for `mainnet.taplyapp.xyz` in `taply-mainnet` → Settings → Domains | always |
| TXT | `_vercel` | `vc-domain-verify=mainnet.taplyapp.xyz,<code shown by Vercel>` | **only** if Vercel shows "Verification Needed" |

Why the values are not written out here: Vercel generates both when the domain
is added to the project, and Vercel is not reachable from this sandbox, so
writing them down now would be a guess. What to expect:

- **CNAME**: this team's existing `www` record uses a project-specific target
  of the form `<16 hex>.vercel-dns-0NN.com`; Vercel will show a value of that
  form (it may or may not equal the `www` one). Vercel's generic
  `cname.vercel-dns.com` is also accepted, but use the exact value Vercel shows.
  At Unstoppable Domains the host field is just `mainnet`.
- **TXT**: Vercel asks for it when the name (or its apex) is claimed by another
  Vercel project/team and it needs proof of control. Because `taplyapp.xyz` is
  already on `taply` in the same team, it may well not ask; if it does, add
  exactly the value it shows, wait for "Valid Configuration", and you can keep
  or remove the TXT afterwards.
- To read the exact records without the dashboard (owner machine, logged-in
  Vercel CLI):

  ```bash
  vercel domains inspect mainnet.taplyapp.xyz --scope kendinecryptos-projects
  ```

- If a CAA record exists on `taplyapp.xyz`, it already allows Let's Encrypt
  (the apex certificate is Let's Encrypt), so the subdomain certificate needs
  no CAA change.

### 3.2 DNS checks after the change (read-only)

```bash
dig +short CNAME mainnet.taplyapp.xyz
```

```bash
dig +short A taplyapp.xyz
```

```bash
curl -sSI https://mainnet.taplyapp.xyz | head -5
```

Expect the CNAME to equal the Vercel value, the apex A records **unchanged**,
and HTTP 200 with a valid certificate for `mainnet.taplyapp.xyz`. Also re-check
`https://taplyapp.xyz` still serves the Testnet build (NEAR Testnet pill).

---

## 4. Environment variables and network isolation

### 4.1 Production scope (`taply-mainnet`)

Template: [`apps/web/env/mainnet.env.example`](../apps/web/env/mainnet.env.example).
Set **every** key explicitly in the dashboard; a key left unset falls back to
the committed `apps/web/.env.production` (Testnet values) or to a Testnet
runtime default.

| Variable | Production value | Why it must be explicit |
|---|---|---|
| `NEXT_PUBLIC_TAPLY_NETWORK` | `near-mainnet` | selects the network at build time |
| `NEXT_PUBLIC_TAPLY_RPC_URL` | `https://rpc.mainnet.fastnear.com` | default is `rpc.testnet.near.org` |
| `NEXT_PUBLIC_TAPLY_RPC_PROVIDER_ID` | `fastnear-mainnet` | default names Testnet |
| `NEXT_PUBLIC_TAPLY_VERIFIER_RPC_URL` | `https://archival-rpc.mainnet.fastnear.com` | receipts need archival |
| `NEXT_PUBLIC_TAPLY_VERIFIER_RPC_PROVIDER_ID` | `fastnear-archival-mainnet` | |
| `NEXT_PUBLIC_TAPLY_VERIFIER_FALLBACK_RPC_URL` | `off` | default is a **Testnet** archival node |
| `NEXT_PUBLIC_TAPLY_EXPLORER_BASE_URL` | `https://nearblocks.io` | default is `testnet.nearblocks.io` |
| `NEXT_PUBLIC_TAPLY_CONTRACT_ID` | `taply-pay.kendinecrypto.near` | |
| `NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH` | read back after key deletion | set only then |
| `NEXT_PUBLIC_TAPLY_PROTECTED_CONTRACT_ID` | `taply-pay.kendinecrypto.near` | `.env.production` has a `.testnet` id |
| `NEXT_PUBLIC_TAPLY_PROTECTED_CODE_HASH` | same hash | `.env.production` has the Testnet hash |
| `NEXT_PUBLIC_TAPLY_PROTECTED_QA` | `off` | `.env.production` has `on` |
| `NEXT_PUBLIC_TAPLY_SHARE_ORIGIN` | `https://mainnet.taplyapp.xyz` | QR links must open on the mainnet host |
| `NEXT_PUBLIC_TAPLY_FLAG_WALLET` | `on` | |
| `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY` | `off` until mainnet evidence | |
| `NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY` | `off` until mainnet evidence | `.env.production` has `on` |
| `NEXT_PUBLIC_TAPLY_FLAG_MERCHANT` / `_HANDSHAKE` / `_CONTACTS` / `_SPLIT` / `_RECURRING` | `off` until each has mainnet evidence | |
| `TAPLY_CSP_MODE` | `enforce` | |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` | pnpm 11.5.0 from `packageManager` |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` (server only) | from a **new** Upstash database created inside `taply-mainnet` → Storage | must not be the Testnet project's database |
| `TAPLY_ONECLICK_API_KEY` (server only, optional) | only if you issue one | never `NEXT_PUBLIC_` |

Flag rule (brief §1): each signing flag turns on only after its flow has
mainnet evidence under `docs/evidence/`. Today the mainnet code paths do not
exist yet (§7), and a `near-mainnet` build fails closed at runtime
(`resolveChainConfig` → `wrong_network`): no chain reads, no signing.

### 4.2 Preview scope (branch `staging/mainnet` only)

Same as Production except: `NEXT_PUBLIC_TAPLY_CONTRACT_ID` and
`NEXT_PUBLIC_TAPLY_PROTECTED_CONTRACT_ID` = `devkendinecrypto.near` with the
staging code hash; `NEXT_PUBLIC_TAPLY_SHARE_ORIGIN` unset. Use a separate
Upstash database (or at least not the Production one) if Handshake is tested.

### 4.3 Automatic isolation checks (in the repository now)

`apps/web/scripts/check-mainnet-env.mjs`, run by `pnpm build:mainnet` and
repeated in `next.config.ts` for every `near-mainnet` production build. Tests:
`apps/web/src/lib/deploy/__tests__/mainnet-env.test.ts`. A mainnet build
**fails** when:

1. the network is not `near-mainnet` (with `--require-mainnet`);
2. any `NEXT_PUBLIC_TAPLY_*` / `TAPLY_*` value contains `testnet`, a
   `test.rpc.` host or a `.test` name, from any source (the message names the
   key and the file it came from);
3. a contract code hash is one of the Testnet hashes
   (`963iSEB8…`, `BrR6bioU…`);
4. the RPC is unset or not one of `rpc.mainnet.fastnear.com`,
   `rpc.mainnet.near.org`, `archival-rpc.mainnet.fastnear.com`; the verifier
   fallback is unset (its default is Testnet) instead of a mainnet host or `off`;
5. the explorer is not `https://nearblocks.io`;
6. a contract id is the recovery account `kendinecrypto.near` (any scope);
   on Production, a contract id other than `taply-pay.kendinecrypto.near`
   (so the staging contract can never reach Production); an id without its
   code hash;
7. a signing flag is on without a pinned contract; Protected QA on in Production;
8. the share origin is `https://taplyapp.xyz` or `www` (the Testnet host), or on
   Production is not exactly `https://mainnet.taplyapp.xyz`;
9. Handshake is on without its own Redis URL/token;
10. a `NEXT_PUBLIC_*` name looks secret (`TOKEN`, `SECRET`, `API_KEY`, `SEED`, …).

Server-only values are never printed. A Testnet build never enters the guard.

### 4.4 Manual isolation checks [OWNER, read-only, after first deploy]

1. `taply-mainnet` → Settings → Environment Variables: no variable shared with
   `taply` (Vercel "shared" team variables off for both).
2. Storage: the Upstash database connected to `taply-mainnet` is a different
   database from the one connected to `taply` (compare the database names/IDs
   in Vercel → Storage, not the tokens).
3. Build log of the first Production deployment shows
   `check-mainnet-env: all checks passed.` and lists every key with its source
   `process env (hosting dashboard)`.
4. In the live bundle on `mainnet.taplyapp.xyz`, the string
   `taply-e2e-ce38a238.testnet` (only present via `.env.production`) is absent,
   and the page shows the NEAR Mainnet label (labels are workstream D.6).
5. `https://taplyapp.xyz` still shows NEAR Testnet and the same deployment ID as
   before (`vercel ls taply --scope kendinecryptos-projects`).

---

## 5. Funds needed (estimate; re-check after Codex measures the WASM)

| Purpose | Chain | Amount | Recoverable? |
|---|---|---|---|
| Staging account (storage ~4.3 + USDC registration + gas + margin) | NEAR | 6 NEAR | Yes, by deleting staging at the end (minus gas) |
| Production account (same) | NEAR | 6 NEAR | **No** — locked once keys are deleted |
| Test payments, NEAR requests (staging + production, ≤1 NEAR cap; use 0.1) | NEAR | ~0.5 NEAR | Paid to your own merchant account, minus ~0.006 NEAR storage per request, kept by the contract |
| USDC storage registration for payer and merchant test accounts | NEAR | 0.00125 NEAR each | Recoverable with `storage_unregister` |
| USDC requests paid from a NEAR wallet (staging + production) | NEAR | ~3 USDC | Paid to your own merchant account |
| USDC requests paid through 1Click (≥0.50 USDC each; quote adds ~1% buffer, refunded) | Base (or Arbitrum / Solana) | ~3 USDC + a little ETH for Base gas | Arrives as USDC on NEAR at your merchant account, minus the 0.2% no-key fee |
| Gas buffer | NEAR | 0.5 NEAR | — |

Total up front: **≈ 13 NEAR + ≈ 3 USDC on NEAR + ≈ 3 USDC and gas on Base**.
Permanently committed: **≈ 6 NEAR** (production account) plus ~0.006 NEAR per
request ever created.

---

## 6. Owner approvals and irreversible actions

Each line is a separate approval. Agents do none of them.

| # | Action | Who signs / where | Reversible? |
|---|---|---|---|
| A1 | Create (if absent) and fund `devkendinecrypto.near` with ~6 NEAR (§1.7) | `kendinecrypto.near`, your device | Funds recoverable by A10 |
| A2 | Add a throwaway deployer key to `devkendinecrypto.near` (only if its current key is used elsewhere) | `devkendinecrypto.near` | Yes (delete the key) |
| A3 | Hand the staging deployer key to a session as an env var (optional) | you | Rotate by deleting the key |
| A4 | Staging deploy, `storage_deposit`, `new(...)` (Codex script, dry-run reviewed first) | staging deployer key | Staging only; redeployable |
| A5 | Real staging payments: NEAR, USDC from NEAR wallet, USDC via 1Click (≥0.50), one deliberate bad delivery, `withdraw_unclaimed` | your wallets | Real money moves |
| A6 | Create and fund `taply-pay.kendinecrypto.near` with 6 NEAR (§1.3 / §1.4) | `kendinecrypto.near`, your device | Account creation is permanent; funds locked after A8 |
| A7 | Production deploy, USDC `storage_deposit`, `new(...)` with router `intents.near`, recovery `kendinecrypto.near`, caps 1 NEAR / 25 USDC | production deployer key | Until A8 |
| A8 | **Delete every key on `taply-pay.kendinecrypto.near`** and read back zero keys + code hash | production deployer key | **Irreversible**: code and ~6 NEAR fixed forever |
| A9 | Create branches `staging/mainnet`, `release/mainnet`; create Vercel project `taply-mainnet` (§2); set variables (§4); create its Upstash database | you, Vercel/GitHub | Yes |
| A10 | Add DNS CNAME `mainnet` (+ TXT `_vercel` only if asked) at Unstoppable Domains (§3) | you | Yes (remove record) |
| A11 | Pin the production code hash in Production variables; turn each flag on only after its mainnet evidence | you, Vercel | Yes |
| A12 | Production evidence payments on `mainnet.taplyapp.xyz` (brief §10.7) | your wallets | Real money moves |
| A13 | Delete `devkendinecrypto.near` (after re-confirming it is disposable, bucket and USDC empty, Preview vars removed) | staging key | **Irreversible**; the name becomes registrable by anyone |
| A14 | Merge to `main`, publish posts/README claims | you | — |

Never part of any step: a phrase or private key of `kendinecrypto.near`; any
`AddKey`/`DeleteKey` on `kendinecrypto.near`; any change to the Testnet project
`taply`, the `release/taplyapp` branch, or the apex/`www` DNS records.

---

## 7. What is still missing before a mainnet build can do anything

The infrastructure above can be set up today, but a `near-mainnet` build
currently fails closed at runtime by design. Remaining work (brief §5–9):

| Item | Owner | Blocks |
|---|---|---|
| `contracts/payments-mainnet` crate, router policy, caps, tests, deploy script with dry-run | Codex | A4, A7 |
| Interface in `docs/MAINNET.md` | Codex | web integration |
| Network profile in `@taply/shared` / `@taply/near-client` (genesis, schemas, builders, readers, wallet backend) | Codex | `resolveChainConfig` accepting `near-mainnet` |
| `resolveChainConfig` mainnet branch, near-connect mainnet options, labels EN/TR, merchant USDC flow, Intents UI | Claude Code | mainnet UI |
| Intents quote/status server routes with recorded fixtures | Claude Code | needs `1click.chaindefuser.com` reachable for fixtures |
| Override record in `docs/DECISIONS.md`, correct `AGENTS.md` / `CLAUDE.md` / readiness review | lead / coordination | consistency |

---

## 8. Verification of this increment (2026-11-13, this sandbox)

| Check | Command | Result |
|---|---|---|
| Whole repository, branch | `pnpm check` (Node 24.22.3, pnpm 11.5.0) | exit 0; shared 93/93, near-client 253/253, web 1241 passed / 1 skipped |
| Whole repository, Testnet baseline worktree (`release/taplyapp` @ `6a47a4c`, untouched) | `pnpm check` | exit 0; shared 93/93, near-client 253/253, web 1216 passed / 1 skipped (1241 − 25 new guard tests) |
| Testnet client bundle unchanged | sha256 of all 55 JS/CSS files in `.next/static`, baseline vs branch, default Testnet env | identical |
| Guard unit tests | `vitest run src/lib/deploy/__tests__/mainnet-env.test.ts` | 25/25 |
| Mainnet build that only sets the network (Testnet values leak from `.env.production`) | `NEXT_PUBLIC_TAPLY_NETWORK=near-mainnet VERCEL_ENV=production next build` | refused in `next.config.ts`, 9 named failures |
| Same through the CLI guard | `node scripts/check-mainnet-env.mjs --require-mainnet` | exit 1, each leak attributed to `.env.production` |
| Mainnet build with the staging-Preview env shape (no contract yet) | `pnpm run build:mainnet` | guard all PASS, build exit 0; `taply-e2e-ce38a238.testnet` absent from the bundle |
| Vercel ignore script | 7 branch/scope combinations | builds only `release/mainnet`→Production and `staging/mainnet`→Preview |
| near-cli-rs commands in §1 | parsed by near-cli-rs 0.31.1 (`--help` at each leaf; no network) | all parse; Ledger needs `usb`/`bluetooth` |

Not verified here (egress proxy refuses these hosts): any mainnet RPC read
(account existence, keys, balances), Vercel, DNS, 1Click.
