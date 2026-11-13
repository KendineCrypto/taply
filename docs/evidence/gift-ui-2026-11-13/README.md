# Taply Gift UI — visual QA (2026-11-13)

**SYNTHETIC RPC. This folder proves layout, animation and state rendering only. It proves nothing about the chain.**

- Build: local production build (`pnpm build && pnpm start`) of `feature/taply-gift`, with
  `NEXT_PUBLIC_TAPLY_FLAG_GIFT_CLAIMABLE=on` and a placeholder gift contract id
  (`taply-gift-ui-mock.testnet`), which does not exist on chain.
- Every JSON-RPC answer came from `gift-ui-visual-qa.cjs` (Playwright `page.route`): `status`, `block`, `view_account`
  and the `get_config`/`get_gift` views. Real Testnet runs need the contract deployed first (owner approval).
- Viewports: 360, 390 and 430 px, `deviceScaleFactor: 2`, touch. `visual-qa.json` reports a horizontal overflow of **0 px**
  at every width. With `reducedMotion: 'reduce'` the flap's computed transform is **`none`** (a cross-fade, no 3D).
- The only console error is the deliberate HTTP 503 of the "verification unavailable" scenario.
- Full-page screenshots repeat the sticky top bar in the middle of long pages. That is how Playwright captures
  sticky elements; it does not happen in the app.

| File | Shows |
| --- | --- |
| `tap-sheet-send-a-gift-390.png` | Central Tap sheet with **Send a Gift** |
| `create-1-type-390.png` … `create-4-review-390.png` | Type → amount → envelope + message + claim window → exact review (gift, fee, total attached, network fee, contract) |
| `open-gift-closed-{360,390,430}.png` / `open-gift-unwrapped-*.png` | Sealed envelope, then unwrapped. The status reads **Available**; unwrapping claims nothing |
| `open-gift-already-claimed-390.png` | The winner's account and **Already claimed**, no claim button |
| `open-gift-expired-390.png` | **Expired**, nobody can claim |
| `open-gift-rpc-unavailable-390.png` | **Verification unavailable** while the RPC is down |
| `gift-receipt-390.png` | Receipt read at a final block (contract, code hash, winner, payout) |
| `open-gift-unwrapped-reduced-motion-390.png` | Reduced-motion variant |
