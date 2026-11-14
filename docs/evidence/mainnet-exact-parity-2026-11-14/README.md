# NEAR Mainnet ↔ Testnet UI parity — 2026-11-14

Screens: `compare/<viewport>-<state>.png` — Testnet on the left, NEAR Mainnet on the right.
Viewports: 390×844, 375×812 (2×), desktop 1280×900 (1×). Chromium/Playwright, `en-US`.

How they were produced (no wallet, no signing, no RPC writes, no NEAR spent):

- Testnet: local `next build` of this branch with no network env → `next start -p 3198`.
- Mainnet: local `next build` with `env/mainnet.env.example`, `NEXT_PUBLIC_TAPLY_MAINNET_FIXTURES=on`,
  `TAPLY_ONECLICK_MODE=fixture`, `NEXT_PUBLIC_TAPLY_MAINNET_LEDGER=device`, contract ids blank → `next start -p 3199`.
  Fixture build: signing is impossible; the green "FIXTURE DATA" bar exists only in this build.
- `node parity.cjs <name> <base> <prefix> <outdir>` then `python3 sheet.py <viewport> <outdir>`.

Separately, the local Testnet build was compared with the live https://taplyapp.xyz (read-only page loads):
first launch, scan, scanner, send, receive, request and activity were pixel-identical (0 differing pixels);
the tap sheet differed only by animation timing (fixed by waiting 1.5 s).

## Same code on both networks

Shell (header, logo, network pill, account menu, bottom nav, Tap sheet, offline banner), first launch,
Taply Wallet identity card, home shortcuts, Pay entry + fullscreen QR scanner, Send/Receive (no wallet),
Receive card (address + QR), request ticket, review summary, receipt ticket, and the no-wallet states of
Activity, Merchant, Split, Recurring and Settings. Words come from the Testnet dictionary with
`Testnet → Mainnet` adaptations (`lib/i18n/mainnet-dictionaries.ts`).

## Connected states (`connected/`)

`node connected.cjs <testnet|mainnet> <base> <''|/m> <outdir>` then `python3 csheet.py <outdir> <sheets>`.
Testnet = the live release build (release/taplyapp 6a47a4c, same as https://taplyapp.xyz) run locally;
Mainnet = this branch, fixture build. Both get the SAME synthetic fixture data:

- a SYNTHETIC RPC (12.3456 NEAR, 42.5 USDC, final block, FullAccess key) — not on chain;
- an injected read-only external wallet (`alice.testnet` / `alice.near`) whose signing always throws;
- a LOCKED fixture vault record (`fixture-wallet.*`): public metadata only, all-zero "ciphertext",
  and a public key for which no private key exists. No wallet was created, nothing was unlocked,
  signed or sent, no recovery phrase was touched.

States: 01 home with balance · 02 wallet & account · 03 send form · 04 receive (address + QR) · 05 activity ·
06 request · 07 merchant · 08 split · 09 recurring · 10 contacts · 11 gift wizard (Testnet = this branch's
Testnet build; the live build has gifts off) · 12 protected · 13 settings · 21–24 Taply Wallet (locked):
home, wallet page with unlock, receive, send.

Testnet regression: this branch's Testnet build vs the live release with the same fixtures — 0 differing
pixels on every connected screen except the "Updated · hh:mm" clock text, and the gift page (enabled here).

## Remaining differences (and why)

| Area | Difference | Reason |
| --- | --- | --- |
| Safety line | One-line `NEAR Mainnet · real funds · unaudited candidate · max 1 NEAR / 25 USDC` (tap for details) | Required material notice on real-money screens |
| Fixture build only | Green FIXTURE bar, fixture merchant preview on Request, fixture panels under Gift/Protected, fixture list in home details | Labelled QA fixtures; absent from the real Preview |
| Asset choice | NEAR / USDC pill on Request, Send, Split, Recurring, Protected | Mainnet supports USDC; Testnet is NEAR only |
| Send | "From" line and the Mainnet payment-safety (device ledger) card under the form; Mainnet operation review | Kept Mainnet review and safety controls unchanged |
| Activity | Received / Paid / Open filter chips; ledger and tracked-request tools folded under Details | Mainnet history is saved request IDs read from the contract |
| Gift | Personal Gift = exact NEAR transfer review; Open Gift needs the configured Gift contract | Mainnet planner operations |
| Taply Wallet create / restore | Mainnet 12-word device wallet forms | Testnet username + faucet flow does not exist on Mainnet |
| Protected | Availability comes from the escrow contract check (no escrow configured in the fixture build) | Shows real availability only |
