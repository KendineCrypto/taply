# Taply v0.4 judging, README and demo proof playbook

> The storyboard below is the original product target, not shipped scope. Live on 2026-11-11: username wallets, request and pay (NEAR or test tokens via Ref), and the live two-phone Handshake session (coordination only; contract-bound sessions are not live), and Protected Pay on Testnet since 2026-11-11 (cancel window 1 minute to 1 hour; not audited). Current facts: [README](../README.md) and [submission package](HACKATHON_SUBMISSION_PACKAGE.md#what-is-live-today-2026-11-11).

## Judging positioning
**Compared to payment-link tools (e.g., PingPay):** Taply doesn't claim better cross-chain routing. It differentiates on **human-verifiable live merchant Handshake**, explicit settlement states and consent-based Protected Pay, all proven on NEAR Testnet. Do not claim exclusive invention of escrow, QR or wallets. Be honest that existing products cover adjacent capabilities.

## 55–60s final film storyboard
0–5s 3D `taply.` logo reveal using approved brand geometry; no fake morphs.
5–12s friction: address copying / confusion (tasteful product story).
12–21s merchant QR -> customer scan -> matching live Handshake code, two synchronized phones.
21–30s Instant wallet-sign + real chain transaction -> verified receipt on both screens.
30–40s Protected mode selection + consent -> funds locked *not paid*, visible timer.
40–48s split-screen: one Protected demo cancelled and refunded; separate case releases and pays, both actual Testnet tx proofs.
48–55s view real contract/receipt evidence with readable tx IDs (factual, no invented data).
55–60s logo + 'Payments with confidence. Powered by NEAR.'

## Voiceover
'Bir ödeme, sadece para göndermek değildir. Doğru kişiye, doğru tutarı, doğru koşullarla ulaştırmaktır. Taply ile QR'ı okut, aynı ödeme oturumunu birlikte doğrula, cüzdanından onayla. Anında öde. Ya da korumalı ödemeyi seç: paran belirlenen süre boyunca kontratta güvende kalsın, koşullar tamamlanınca aktarılsın. Her adım, NEAR üzerinde doğrulanabilir. Taply. Ödemenin kontrolü sende.'

Adjust narration to actual shipped features. Never voice 'Protected Pay live' if not implemented. Clips of real app/Testnet transfers are primary proof; cinematic overlays secondary.

## README at submission
Above fold: real app link + actual screenshots/video + testnet contract + what shipped/what disabled. Then problem/solution, differentiator, network, architecture diagram, install (`.env.example`), test script, two-wallet reproduction steps, merchant QR and escrow tests, explorer proofs, threat model, limits, contributions, license.

## External proof collection
Actual deployment Testnet account, WASM hash, release commit/tag, 3–5 real Testnet transaction links (instant pay, protected lock, cancelled refund, protected release), contract test logs, CI status, screenshots with accurate labels. If no observed proof, do not fabricate it.

## Independent AI reviewer instruction (run after implementation)
'Act as a skeptical NEAR Hackathon reviewer. Treat every README claim as untrusted until verified in source or Testnet execution. Identify broken install paths, fake/mock data presented as production, unsafe contract transition races, unbounded gas sponsorship, escrow refund failures, and lack of NEAR-specific work. Score reproducibility and list exact code/test evidence.'

## Deadline
Official: https://nearhackathon.com/ ; Nov 14 2026 at 23:59 UTC. Verify submission form and relevant track on submission day. Public repository and X demo link required.
