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

## Remaining differences (and why)

| Area | Difference | Reason |
| --- | --- | --- |
| Safety line | One-line `NEAR Mainnet · real funds · unaudited candidate · max 1 NEAR / 25 USDC` (tap for details) | Required material notice on real-money screens |
| Request (fixture build) | Shows the fixture merchant preview | Fixture QA needs it; the real build shows the Mainnet create form |
| Request form (connected) | Mainnet form (NEAR/USDC choice, contract caps) | Testnet form is wired to the Testnet wallet/contract client |
| Gift | Mainnet gift page, not the 5-step Testnet wizard | Personal Gift needs a direct-transfer verifier; wizard is Testnet-coupled |
| Protected / Handshake | Mainnet pages with escrow state notices | Different escrow contract and states; Testnet components are Testnet-bound |
| Contacts | Mainnet local list | Testnet contact validation accepts only `.testnet` accounts |
| Activity / Merchant / Split / Recurring (connected) | Mainnet lists | Read Mainnet contract state; Testnet versions read the Testnet journal |
| Wallet page | Mainnet Taply Wallet manager | Mainnet 12-word device wallet differs from the Testnet username wallet |
