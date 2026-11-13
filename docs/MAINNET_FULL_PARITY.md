# Taply Mainnet full product integration

Development branch: `codex/mainnet-full-parity`.

Base: hardened `078a722aa8c870bc190e3b8c9d3064ddcb9cc92d`.
Integrated Gift branch: `8a0dbd9ba80fa4c6807a7bc33ff6c87743c40755`.
Release comparison: `6a47a4c1db09d1dce23041d758a41e55147ffd5c` (`release/taplyapp`), already an ancestor of both branches.

**Full product remains the objective. This commit is not full functional parity
or approval for funds.** Navigation, local tools and read-only integration are
development functionality. Disabled workflow explanations and fixture rendering
are not completed financial features. GO for development review; NO-GO for
Mainnet funds. All three release gates and `intentsRouter:false` stay unchanged.

## Integration boundaries

Gift was merged into this isolated development worktree, not into a production
or Claude branch. Its Testnet contract, UI, signing tests and translations are
preserved. Only envelope design constants were extracted to a network-neutral
module; Mainnet never imports Gift's Testnet signer, link-secret decoder or
receipt hook. No Gift contract was ported by renaming accounts or changing a
network literal. The inherited Testnet deployment helper is not executed by this
work or by the new product surface; its account/key operations remain outside
the approved scope.

The build-time root aliases still mount only the selected network's providers.
Mainnet ordinary product URLs redirect to their `/m/` counterpart, never render
the Testnet page. Testnet URLs and behavior remain unchanged. Testnet APIs remain
404 on Mainnet. New Mainnet routes are allowlisted; unknown `/m/` paths are 404.
The original checkout, 1Click server, durable ledger, quota and bounded-body
implementations are reused unchanged. There is no second backend.

## Route-by-route comparison

Mainnet destinations below have `/m` prepended. Read "blocked" literally: the
feature has not reached functional parity even if its destination renders.

| Testnet route / feature | Mainnet destination and implemented behavior | Remaining parity gap / owner |
| --- | --- | --- |
| `/` | `/m`: existing checkout plus full product navigation | Wallet-led landing refinement; frontend |
| `/wallet` | External session connect/disconnect; account lookup with real final-block NEAR/USDC reader | Automated balance refresh, native spendable/storage calculation, internal wallet; client/signing |
| `/wallet/create` | Explains unavailable internal wallet; external connect | Mainnet account creation, custody/backup review, owner-approved funding; signing |
| `/wallet/restore` | External session restoration; no phrase fields or Testnet vault access | Separate Mainnet encrypted vault and restore proof; signing |
| `/send` | Recipient/asset/amount/memo composition; sending disabled | Reviewed native/NEP-141 direct transfer signing, exact preview, uncertain-result reconciliation; client/signing |
| `/receive` | Connected account QR and text; informational only | Safe share UX and receive history; frontend/index |
| `/request/new` | Existing exact-term storage quote and unsigned NEAR/USDC request preview | Deployment pin and approved signer; contract/signing |
| `/pay`, `/pay/[id]` | Same-origin link input and existing chain-state/1Click checkout | Actual merchant settlement, approved funded quotes; contract/client |
| `/scan` | Local camera decoding or link paste; same-origin Mainnet request/merchant links | Real-device camera coverage; frontend QA |
| `/checkout/[accountId]` | Validated merchant identity, explicit fresh-request requirement | Merchant profile reader and unique request-per-sale creation; contract/signing |
| `/merchant` | Track known request IDs; request composer; store identity QR | Complete indexed sales, store registration, register flow; contract/index |
| `/merchant/setup`, `/merchant/register` | Same safe dashboard surface | Dedicated registration UX and reviewed contract interface; contract/frontend |
| `/contacts` | Save/remove contacts locally, per Mainnet account | Edit/import/export polish; frontend |
| `/split` | Exact integer split with remainder conservation; edits invalidate result | Per-contact allocation and unique on-chain request creation; frontend/signing |
| `/recurring` | Save/remove weekly/monthly drafts per account; never auto-debits | Calendar/timezone occurrence IDs, editing and new-request prefills; frontend/shared |
| `/activity` | Track/remove request IDs and open current chain state | Complete Mainnet history index, provenance and account filtering; backend/client |
| `/receipt/[id]` | Explicit independent-verifier unavailable; link to contract state | Receipt graph, exact merchant transfer, code/keys at relevant blocks; client |
| `/protected/new`, `/protected/[id]` | Visible unavailable state, no lock/release/refund controls | Separate reviewed Mainnet escrow/state machine and UI binding; contract/signing |
| `/s/[sessionId]`, Live Handshake | Visible unavailable state; never connects to Testnet API | Network/contract/terms-bound shared session backend and two-device proof; backend |
| `/gift/new` | Personal/Open Gift draft composition, four existing envelope designs, local save/remove | Exact Mainnet direct-transfer or escrow funding/claim interfaces; contract/signing |
| `/gift/p` | Blocked, no trust in fragment as payment evidence | Mainnet direct-transfer verifier and safe payload reader; client |
| `/gift/[id]`, `/gift/[id]/receipt` | Blocked, no claim secrets generated or processed | Reviewed Mainnet Gift contract/config, claim nonce/signature, callbacks, receipt reader; contract/client |
| `/settings` | EN/TR shell, external session, scope/availability information | Internal wallet security/preferences parity; signing/frontend |
| `/demo`, `/demo/handshake` | Redirect to Mainnet home, explicitly labelled existing fixtures | Full Mainnet demo coverage; frontend; never payment evidence |

The five-item navigation links Wallet, Activity, Tap/tools, Contacts and Settings.
Tools exposes all product workflows, including the unavailable financial ones.
English/Turkish copy uses the existing typography, spacing, colors and envelope
design system. Local data has no Testnet migration or fallback.

## Exact integration interfaces

Existing ABI remains `docs/MAINNET.md`: contract version `0.6.0-mainnet`,
`create_request`, `quote_create_request`, `get_request`, `pay_instant_native`,
`ft_on_transfer`, reviewed callbacks/recovery; instant NEAR/USDC only today.
`protectedPay:false` and `intentsRouter:false` are schema requirements, not UI
preferences. Do not widen the schema to get a screen past validation.

Existing shared exports remain `MainnetIntentTermsSchema`,
`calculateMainnetRequestId`, `calculateMainnetTermsHash`,
`buildInstantRecipientMessage`, and the Mainnet request/config schemas.
Existing near-client unsigned builders and `createMainnetReader` are reused.

New near-client export: `createMainnetAccountReader({ network:'near-mainnet',
rpcUrl, rpcProviderId, timeoutMs?, maxResponseBytes? }).readBalances(accountId)`.
It validates the allowlisted RPC, chain ID, genesis, account, and strict amounts.
Both assets are read at the same final block. Result fields: `accountId`,
`native`, `locked`, `usdc`, `blockHash`, `timestampNs`, `source:'rpc'`,
`finality:'final'`, `network:'near-mainnet'`, `providerId`. It requires no Taply
deployment. It does not claim independent receipt verification or a spendable
balance. Failed/malformed reads reject, never yield fabricated zero balances.

Local product data: `taply.product.near-mainnet.v1:<validated accountId>`;
bounded, schema-validated contacts, drafts and tracked request IDs. No keys,
mnemonics, Gift secrets, quote deposits or payment-success markers are stored.
Corrupt/unavailable storage refuses writes; account switching hides prior data.
These local preferences are not a concurrent financial ledger.

Required contract/signing work is explicitly assigned in the table. No duplicate
Handshake, Gift escrow or receipt implementation should be built in the frontend.
Before implementing any of those transactions, freeze its typed interface and
unknown-outcome policy with the contract/client owner and test it independently.

## Network scope

- NEAR native and NEAR USDC: existing unsigned request/payment builders; no signing.
- Base USDC / 1Click: integrated in the existing request payment screen. The prior
  live signed dry quote demonstrates API compatibility only. Funded quotes remain off.
- Solana and Tron: retained in the full product scope, unavailable until origin
  asset IDs, supported routes, authentication, refund accounts, expiry and actual
  integration evidence are independently verified. No invented route is offered.

## Verification and release decision

Reproduction: `pnpm install --frozen-lockfile`, `pnpm check`; Mainnet preview uses
`apps/web/env/mainnet.env.example` with fixture mode and no contract pin. Existing
`mainnet-1click-qa.mjs` checks remain required. Product tests cover route isolation,
account-scoped local storage, corrupt storage, cross-origin QR rejection, exact
split conservation, disabled send/restore, Gift preview without funding, and
final-block account reads. New browser coverage must be distinguished from live
chain execution; fixtures are never evidence of actual merchant payment.

Local Windows verification:

- `pnpm check`: passed; shared 93, near-client 278, web 1,457 passed / 14
  skipped. Typechecking and build passed; lint has warnings, no errors.
- Standalone API types/lint passed; tests 69 passed / 3 Redis-dependent skipped.
- Guarded Mainnet preview built. Existing checkout browser suite: **88/88**;
  new full-product browser suite: **98/98**. English/Turkish, 390px mobile and
  1280px desktop, disabled sending, Gift preview, exact split remainder,
  route isolation and loaded-script leak checks. The additional final draft
  validation is covered by unit tests; CI reruns both browser suites on its SHA.
- The new route test initially caught Next streaming a 200 response for unknown
  paths. Proxy validation now rejects these before rendering; both browsers
  observed HTTP 404 on the rerun.
- No Testnet RPC/contract/explorer/vault in loaded product scripts. The inherited
  inert Testnet genesis export remains, as previously documented.
- Local Rust and redis-server are unavailable. Mainnet and Gift Rust/sandbox
  tests, real Redis and final-SHA browser tests are delegated to the existing
  GitHub workflows. Run links and final conclusions belong in the delivery
  report; the base commit's successful CI does not certify this commit.

Browser evidence is [checkout results](evidence/mainnet-full-parity-2026-11-13/checkout-results.json)
and [product results](evidence/mainnet-full-parity-2026-11-13/product-results.json).
Screenshots and local browser tests use synthetic checkout fixtures; they prove
UI behavior only. Camera hardware, actual Gift settlement, real-money signing
and a Base-funded Taply checkout are not proven.

The successful-read regression found and corrected an inherited Mainnet reader
bug: `createRpc` returns lossless numeric tokens, while the previous return-byte
schema expected JavaScript numbers. Both Mainnet readers now use the existing
`CallResultSchema` decoder and reject result block hashes that differ from the
final anchor. A real-shaped JSON-RPC response regression covers successful
decoding and wrong-block rejection; no amount coercion was relaxed.

Live read-only probing independently found a second inherited bug: Mainnet's
genesis height is **9820210**, not 0. Both FastNEAR normal and archival endpoints
returned the existing pinned hash `EPnLgE7iEq9s7yTkos96M3cWymH5avBAPm3qx3NXqR8H`
at that height; both refused block 0. The two readers and read-only deployment
planner now query the correct height and retain the exact hash check. Tests
assert that requested height. This agrees with the provider's
[historical data documentation](https://github.com/fastnear/neardata-server).
No provider fallback or genesis-check bypass was introduced.
The corrected reader subsequently returned a successful live final-block read
for the existing staging account: observed native and USDC balances were both
zero. See [exact read evidence](evidence/mainnet-full-parity-2026-11-13/live-balance-read.json).
This proves the read path against that RPC, not deployment or any payment.

Unchanged release blockers: unproven upstream router gas, durable production
ledger configuration, R-2 unknown callbacks (no blind retry/admin override), no
deployed candidate or exact live merchant payout, no independent Mainnet verifier.
Gift escrow and Mainnet internal-wallet signing add their own separate review
requirements. All real-money gates remain closed. **NO-GO for funds and NO-GO
for claiming complete functional parity. GO for reviewing this full-product
development integration and continuing the explicitly listed gaps.**
