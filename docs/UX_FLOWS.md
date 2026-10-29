# Taply v0.4 UX — every screen, state and label

## Brand
Use `brand/assets/wordmark-dark.svg` and `brand/assets/icon-dark.svg` as delivered; don't regenerate the t shape. Night `#0B120E`, Forest `#111C15`, Olive `#203226`, Cream `#F4F3E8`, Lime `#C7FC75`. All demo screen compositions 390x844 and 360x780, desktop responsive, contrast tested.

## Global chrome
Top: Taply wordmark, NEAR Testnet badge, wallet account short ID, network indicator. Bottom: Home · Pay · Scan · Activity · Settings. Native-feeling feedback, touch targets >=44px; reduced-motion supported, keyboard and screen-reader equivalents. Never make a cash amount look like a Testnet token's real market value.

## Screen inventory
00 Splash/loading; 01 onboarding/external-wallet connect; 02 optional social-login entry (behind gate); 03 wallet home (balance, assets, Send/Receive/Request); 04 send review + sign; 05 receive address + QR; 06 create request with Instant/Protected selector; 07 request share via link+QR; 08 visitor `/pay/[id]` source verification; 09 merchant `/checkout/[slug]` QR and receipt; 10 live Handshake dual-views (merchant and customer); 11 6-character compare code + immutable amount/recipient; 12 swipe-to-review (never silent send); 13 wallet signature modal/deep-link; 14 payment processing/payout; 15 Protected `LOCKED — NOT PAID` countdown; 16 Protected payer cancel/release states; 17 chain-verified final/refund receipt; 18 merchant dashboard; 19 contacts; 20 split bill; 21 recurring requests; 22 activity detail; 23 security/settings.

## Real-time copy rules
- `OPEN`: 'Ödeme bekleniyor'
- `WALLET REVIEW`: 'Cüzdanda işlemi onayla'
- `PAYOUT_IN_FLIGHT`: 'Ödeme zincirde işleniyor. Sonuç doğrulanıyor.'
- `LOCKED`: 'Tutar kontratta kilitli. **Satıcıya henüz ödenmedi.** İptal hakkı sona erince aktarım yapılabilir.'
- `REFUND_IN_FLIGHT`: 'İadenin zincirde tamamlanması bekleniyor.'
- `RELEASE_IN_FLIGHT`: 'Satıcıya transfer doğrulanıyor. Henüz tamamlanmadı.'
- `FINAL_PAID`: 'Ödeme doğrulandı. Satıcıya ulaştı.'
- `CANCELLED_REFUNDED`: 'Ödeme iptal edildi ve tutar iade edildi.'
- `*_FAILED_RECOVERABLE`: 'Aktarım tamamlanamadı. Para durumu korunuyor; yeniden dene veya destek akışını izle.'
- `RPC_TIMEOUT_UNKNOWN_STATUS`: 'Sonuç belirsiz. Tekrar ödeme yapmadan önce zincir durumunu kontrol ediyoruz.'
- `SESSION_EXPIRED`: 'Canlı oturum sona erdi; yeni oturum oluştur.'
- `SOCIAL_LOGIN_NOT_TESTNET_CAPABLE`: 'Bu giriş yöntemi Testnet cüzdanı için henüz kullanılamıyor. Desteklenen cüzdanla devam et.'

## Protected Pay consent screen
Show exact cancel deadline (UTC and local formatted), who may cancel, what merchant can/cannot do, who triggers release, and whether payer can lose cancel rights even if screen shows seconds. Both parties explicitly accept *before* deposit; refusal routes to Instant only after re-review, never auto-switch.

## Merchant dashboard
Never show green Paid badge for escrow Locked. Use amber Locked/Release pending, lime Final, muted Refunded. Multiple simultaneous intents identified by ID/session; per-intent transaction explorer evidence; stall/retry badge. Merchant permanent QR still creates unique purchase request and invoice number.

## Motion
Brand-first, premium no fake 3D gimmick in core app. Swipe only initiates wallet request. Optional dual-screen reveal animation when both independently verified; motion not an authority. Add reduced-motion alternative. Respect single-signed-transaction user intent.

## Accessibility and failure
Screen-reader payment amounts and account identifiers; tap/click equivalent for swipe; focus trap in confirmation dialog; no color-only status. Distinct states no wallet, insufficient gas, insufficient token, network mismatch, expired request, malicious recipient mismatch, declined signature, app offline, server offline, on-chain pending, payout failed, refund failed, cancelled.
