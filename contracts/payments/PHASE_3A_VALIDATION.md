# Phase 3A technical validation — 2026-11-01

Baseline: `71afa541afa2e0f980cd110446f428c82905524c`, dedicated branch
`feature/pilot-core`. No deployment/signature/funding/signing enablement was
authorized or performed. No live Taply contract ID, transaction or payment
receipt exists in this report. UI components/routes/styles, contract sources,
Cargo manifests/locks, shared schemas and workspace dependency pins are unchanged.

## Proven blocker fixed

The receipt verifier's HTTP transport used JSON.parse and rejected every unsafe
number anywhere in an RPC response. Genuine Testnet blocks contain a legacy
numeric `header.timestamp` above 2^53. That unused field made the mandatory final
block read fail, preventing VerifiedReceipt production.

The near-client package now exports a strict lossless integer parser using its
existing pinned dependency. Safe integer tokens remain numbers; larger tokens
remain exact bigint. The verifier's schemas still reject bigint in numeric fields
they actually use. String amounts/timestamps stay strings. Duplicate JSON keys,
noninteger numeric tokens and malformed JSON are rejected. No amount coercion,
new dependency, signing method, retry or change to settlement authority was added.

Regression evidence: unedited `final-block.json` at height 275747769, hash
`6yyQncsPtVd3LZorBMt2FZMs7vsGFX2aoPLLu6dk1P5q`. Its timestamp is exactly
1793535606670615924. Full synthetic HTTP-to-VerifiedReceipt tests now include
legacy block timestamps; an unsafe **used** height still fails closed. Synthetic
receipts and unrelated public RPC transactions remain explicitly test evidence.

## Commands actually run

Node v24.22.2, pnpm 11.5.0, Windows PowerShell:

| Command / check | Observed result |
|---|---|
| `pnpm install --frozen-lockfile --offline --ignore-scripts` | PASS |
| `pnpm check` | PASS: app production build, types, lint, brand; 92 shared + 118 near-client + 339 web tests, zero failures |
| `pnpm --filter @taply/web test -- src/lib/verify src/lib/payments` | PASS: 154 tests |
| Isolated fresh checkout, frozen offline install, then `pnpm check` | PASS: same 549 tests and production build |
| `pnpm install --frozen-lockfile` in isolated checkout | PASS, lockfile unchanged |
| `git diff --check` | PASS |
| `near.exe --version` (official checksum-verified release) | near-cli-rs 0.30.1 |
| Complete create/fund, faucet-create and deploy/init CLI paths with terminal `--help` | PASS, parser/help only; no key creation or RPC mutation |
| `deploy-preflight.mjs wasm contracts/payments/artifacts/payments.wasm` | **FAIL, exit 1**: ignored local WASM SHA/code hash/size mismatch; exports pass |
| Cargo unit/build/clippy/sandbox commands | Not run: Cargo absent; Docker engine unavailable |

The isolated checkout is inside `contracts/payments/artifacts/phase3a-checkout`.
The original worktree's Git metadata is outside the writable workspace under
`C:/taply/.git`; its `git add` failed with permission denied. Tested changes are
committed/pushed from the isolated checkout. Original checkout files retain the
same changes; no frontend branch ref is moved.

## Remote CI actually inspected

- Baseline workspace check on `71afa54`: [41304788137](https://github.com/KendineCrypto/taply/actions/runs/41304788137), success.
- Contract workflow on `1b5b3ef`: [41304495007](https://github.com/KendineCrypto/taply/actions/runs/41304495007), success. Inspected job steps include fmt, 15 unit tests, clippy, WASM, pinned approved artifact, all 9 sandbox tests and wire schema.
- Contract source/build scripts/Cargo configuration are unchanged from that run.
  These are remote historical results, not newly executed local Rust tests.

## Live read-only infrastructure observations

Both `https://rpc.testnet.near.org` and `https://test.rpc.fastnear.com` returned:

- Synced Testnet identity, pinned genesis, final public `testnet` account reads
  with `assurance: verified_final` and no client error.
- Losslessly parsed final blocks (sample hashes
  `6ctGuAXnkWs3efwtVcqTyuQkPBQ5sjzce1GD3g7mqJ1a` and
  `62yd76VSeKsQr6askAuCzLUsPZDWzwZaXScTRrh7DTJe`).
- HTTP OPTIONS 200 with allow-origin/headers/methods `*` for diagnostic origin
  `http://127.0.0.1:4179`.
- EXPERIMENTAL_tx_status POST 200, allow-origin `*`, FINAL and 6 receipt payloads
  for the pre-existing **unrelated** fixture transaction. It is not Taply proof.

Actual browser CORS/mobile-wallet tests remain unverified: browser access to the
local diagnostic page was declined by browser security review. Node/header checks
do not substitute for browser acceptance. A read-only human-run diagnostic is
included, along with a raw evidence snapshot collector tested to refuse mutation
methods, wrong network, wrong code, unanchored state and non-FINAL references.

## Remaining gates

Reproduce the approved 345,541-byte WASM on the pinned build machine. The existing
local ignored artifact has SHA-256
`15328bc17b0c1cc0c21cf9eb5c13bf01a6d736fd833d1cf5f1755fc4b167c9f1`
and is **not deployable under this approval**. The approved pin stays
`a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2`.

Then obtain the explicit approvals and run [PILOT.md](PILOT.md): dedicated accounts,
funding, atomic deploy/init, chosen phone-accessible HTTPS preview, signing
enablement, request bond and one real two-wallet 0.1 NEAR payment. Verify outgoing
Transfer + callback + FINAL state, recipient funds and independent receipt links
through both providers. Test actual mobile redirect and lost-return handling.

Retained FullAccess authority and permanently unresolved callback stalls remain
material pilot risks. The trust model remains configured RPC. Protected Pay,
Handshake, merchant checkout, FT, sponsorship and social wallets remain disabled.
