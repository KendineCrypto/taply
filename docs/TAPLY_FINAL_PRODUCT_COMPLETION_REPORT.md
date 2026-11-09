# Taply — Ürün Tamamlama Raporu (9 Kasım 2026)

Dal: `claude/kind-cerf-c4n261` · Üretim (taplyapp.xyz): `release/taplyapp` = `22765d7` (**değişmedi**) · Ağ: yalnızca NEAR **Testnet**.

## A. Ürün özeti

Taply, NEAR Testnet cüzdanını bir ödeme uygulamasına çeviren mobil öncelikli bir PWA. Ana farkı: ödeme durumunu
güvenilir ve bağımsız doğrulanabilir yapması. "Kontrata göre ödendi" ile "Doğrulanmış Ödeme" ayrı durumlar;
cüzdan dönüşü, sunucu mesajı veya geri sayım hiçbir zaman bir ödemeyi "ödendi" yapmaz. Bu sprintte vizyonun
en zor parçaları — Protected Pay (emanet), NEP-141 token ödemeleri ve oturuma bağlı mağaza satışı (G2) —
gerçek Testnet işlemleriyle kanıtlandı.

## B. Özellik matrisi

Ayrıntılı tablo: [PRODUCT_COMPLETION_MATRIX.md](PRODUCT_COMPLETION_MATRIX.md). Özet:

| Durum | Özellikler |
| --- | --- |
| **LIVE** | Cüzdan bağlama, kesinleşmiş bakiye, alma adresi + QR; gerçek talep/ödeme sayfaları; bağımsız makbuz doğrulayıcı; mağaza kayıt/QR/POS arayüzü (imza kapalı); Kişiler; Bölüşerek Öde (hazırlık); Tekrarlayan şablonlar (otomatik çekim yok); EN/TR |
| **QA VERIFIED (Testnet, otomasyon hesapları)** | G1 Anında Ödeme; G2 oturuma bağlı satış kontratı; G3 Protected Pay iade + aktarım; NEP-141 token ödemeleri (Anında + Korumalı iade) |
| **CODE COMPLETE (bayrak kapalı)** | Protected Pay web akışı (token destekli); makbuz doğrulayıcı yedek sağlayıcısı; paylaşılan şema v1.1 |
| **PARTIAL** | Taply yerel cüzdanı (imza kapalı); doğrudan NEAR gönderimi; Doğrulanmış Talepler (kontroller var, ayrı rozet yok) |
| **BLOCKED** | Canlı iki cihazlı Handshake servisi (kalıcı depolamalı barındırma gerekli); sahibin fiziksel cüzdanıyla kabul turu |
| **NOT IMPLEMENTED** | Farklı tokenla ödeme (swap); sosyal giriş; sponsorlu gas; Milestone Pay; NFC |
| **DEMO ONLY** | `/demo` yolculuğu (sentetik olarak etiketli) |

## C. Gerçek Testnet ödemeleri

Tüm hesaplar musluktan (faucet) oluşturulan tek kullanımlık otomasyon hesapları; anahtarlar repoda değil.
Kanıt dosyaları `docs/evidence/testnet-e2e/`. Dizin: [RELEASE_EVIDENCE_INDEX.md](RELEASE_EVIDENCE_INDEX.md).

| Akış | Kontrat (kod özeti) | Varlık / tutar | Talep ID | İşlemler | Son durum | Doğrulama |
| --- | --- | --- | --- | --- | --- | --- |
| G1 Anında | `taply-pay-pilot-1.testnet` (`BrR6bioU…`, dondurulmuş, sadece çağrıldı) | 0,01 NEAR | `d4edcbfb…8022` | oluştur `A5xd9ak9…`, öde `7Ajta5Tu…`; tekrar ödeme reddedildi (`NOT_OPEN`) | FINAL_PAID, alıcı +0,01 tam | **Verified** (near-public-testnet + fastnear) |
| G3 iade | `taply-e2e-6a6a1fc6.testnet` (`Auw8pZ1T…`, 0 anahtar) | 0,02 NEAR | refundFlow | fonla `8PwUPWtd…`, iptal `9mGVhXBK…` | CANCELLED_REFUNDED, ödeyene 0,02 transfer makbuzu | 4 saldırı çağrısı reddedildi |
| G3 aktarım | aynı | 0,02 NEAR | releaseFlow | fonla `3zbo2exy…`, aktar `UZg8dQYU…` (kesimden sonra, üçüncü hesap) | FINAL_PAID, alıcıya 0,02 | geç iptal / çift aktarım reddedildi |
| NEP-141 Anında | token `taply-e2e-826c3e79.testnet` (`4WtMAoc8…`), kontrat `taply-e2e-6cdaf61b.testnet` (`Ea5REQGA…`), ikisi de 0 anahtar | 2,5 tUSD-TEST (değersiz test tokenı) | `ae7f6c76…40e1` | `ft_transfer_call` `HhXDEW5f…` | FINAL_PAID; ödeyen −2,5, alıcı +2,5 tam; kontratta 0 kaldı; tekrar transfer tam iade | muhasebe tutarlı |
| NEP-141 Korumalı iade | aynı | 2,5 tUSD-TEST | `6687e98a…c7d4` | fonla `FuFnF5cK…`, iptal `B43XpNWH…` | CANCELLED_REFUNDED, ödeyen tam geri aldı | |
| G2 mağaza satışı | `taply-e2e-9c2eeea4.testnet` (0 anahtar) | 0,015 NEAR | dosyada | oluştur `J51nUgZs…`, öde `379pZmM4…` | FINAL_PAID, mağaza +0,015 tam; aynı oturum için ikinci satış reddedildi (`SESSION_ALREADY_USED`); karşılaştırma kodu `2RB15M` iki tarafta aynı | **Verified** (2 sağlayıcı) |

## D. Handshake

- **Kontrat tarafı (G2):** oturuma bağlı satış gerçek Testnet'te çalıştı (yukarıda). Oturum taahhüdü kontrat ve
  istemcide birebir aynı; tekrar oynatma kontrat tarafından engelleniyor; ödeme otoritesi kontrat.
- **Canlı oturum servisi:** `apps/api` şifreli SQLite + NEP-413 kimlik doğrulama ile yazılmış, test edilmiş, ama
  dinleyici (listener) başlatmıyor ve üretim kimlik doğrulaması (F-06) kapalı. Vercel serverless kalıcı SQLite
  barındıramaz. **BLOCKED:** kalıcı diskli bir sunucu (ör. tek küçük VM) ve F-06 incelemesi. Bu oturumdan barındırma
  hesabına erişim yok.

## E. Protected Pay

- Ayrı, versiyonlu G3 aday kontratı (`contracts/payments-protected`); G1'e dokunulmadı (`check-isolation` geçiyor).
- **İade** ve **aktarım** gerçek Testnet'te ayrı ayrı kanıtlandı; muhasebe: alınan 0,04 = ödenen 0,02 + iade 0,02.
- Yerel sandbox 3/3; GitHub CI'da da 3/3 (yerel geçici çözüm olmadan).
- Web akışı tamam (rıza, "KİLİTLİ — ÖDENMEDİ", yaklaşık geri sayım, iptal/aktarım/yeniden deneme, iade ≠ ödeme
  ifadeleri, hata durumları). Gerçek Testnet kontratına karşı yerel üretim derlemesinde okundu (ekran görüntüleri
  `docs/evidence/qa-2026-11-09/`).
- **Herkese açık değil:** emanet kontratı insan güvenlik incelemesinden geçmedi; bilinen açık kapı: "transfer başarılı +
  callback başarısız" durumunda fon süresiz rezerve kalır (yönetici müdahalesi bilinçli olarak yok).

## F. Çoklu token

- Desteklenen: yerel NEAR + kontratın init sırasında sabitlenen allowlist'i. Testnet tokenı: `taply-e2e-826c3e79.testnet`
  (**Taply Test Dollar, TEST ONLY, değeri yok**, 6 ondalık). Gerçek USD değildir.
- Güvenlik: `ft_on_transfer` yalnızca terimlerde yazan allowlist'teki tokendan kabul edilir (sahte token reddedildi,
  sandbox'ta kanıtlı); tam tutar; `msg` alıcı belirleyemez; her hata panik → token tamamını iade eder; kayıtsız alıcıya
  ödeme bekletilir ve kayıt sonrası yeniden denenir (sandbox'ta kanıtlı).
- **Farklı tokenla ödeme (swap):** uygulanmadı. Doğrulanmış bir Testnet swap/intents yolu bulunamadı; sahte kur
  gösterilmedi.

## G. Tüketici özellikleri

Kişiler (yerel, Gönder ve Korumalı talepte seçici), Bölüşerek Öde (pay başına ayrı talep; grup yalnızca her pay
doğrulanınca tamam), Tekrarlayan şablonlar (yalnızca formu doldurur, otomatik çekim yok) canlı. Doğrulanmış
Talepler: sözleşme/kod özeti/terim kontrolleri ve makbuz doğrulayıcı var; ayrı kompakt rozet henüz yok.

## H. Üretim

- taplyapp.xyz: `22765d7`, salt-okunur, imza kapalı. Bu sprintte **dağıtım yapılmadı** (bu bulut oturumunun Vercel
  erişimi yok; ayrıca finansal özellikler herkese açılmadı).
- Canlı teşhis: makbuz sayfasındaki "Could not reach the RPC" hatasının kökü bulundu — doğrulayıcı ~12 ardışık
  arşiv okuması yapıyor ve `archival-rpc.testnet.near.org` her biri ~3,5 sn sürüyor. Düzeltme (`cecc48a`): ilk
  sağlayıcı geçici hata verirse tüm kanıt FastNEAR arşivinde baştan doğrulanır (~0,75 sn/okuma); sağlayıcılar
  karıştırılmaz, kesin hata başka sağlayıcıyla "ezilemez". Yerel üretim derlemesinde tarayıcıyla test edildi.
- Geri alma: üretim değişmediği için gerek yok; önceki hedef `dpl_mybW8sqwKCNc8uMQETrQMsTeEPEv` hâlâ geçerli.

## I. Git ve CI

Commit'ler (`22765d7..cc58cbb`), en önemlileri: `b4286f1` G3 aday, `3d9d7c8` Protected web, `c1a7c9f` sandbox +
`--cfg near` düzeltmesi, `66eec39` G1 Testnet kanıtı, `f7ad5d3` G3 Testnet kanıtı, `b9b76eb` NEP-141 kontrat/şema/
sandbox, `29a762a` NEP-141 Testnet kanıtı, `cecc48a` doğrulayıcı yedeği, `4640e9d` token destekli web, `cc58cbb`
G2 Testnet kanıtı. CI: `protected-pay-candidate` #1 ve #2 başarılı (#2 = NEP-141 dahil 7 sandbox testi);
`workspace-check` ve `wallet-browser-check` önceki başlarda başarılı; son baş için sonuçlar
[AUTONOMOUS_PROGRESS.md](AUTONOMOUS_PROGRESS.md)'de. Yerel: shared 93, near-client 220+, web 1.153 test geçti.
PR açılmadı (inceleme için `main`'e PR önerilir).

## J. Kullanıcı deneyimi

Onaylı tasarım korundu (gece yeşili, krem, lime). Yeni ekranlar EN/TR; 390 px'de taşma yok; erişilebilir etiketler,
44 px dokunma hedefleri. Ekran görüntüleri: `docs/evidence/qa-2026-11-09/`.

## K. Hackathon

README ve hakem rehberi üretimdeki durumu doğru anlatıyor; yeni Testnet kanıtları
[RELEASE_EVIDENCE_INDEX.md](RELEASE_EVIDENCE_INDEX.md)'de. Video ve X gönderisi sahibin işi (yapılmadı).
X taslağı (EN): "Taply turns a NEAR Testnet wallet into a point of sale — and makes every payment status checkable.
New: escrow-style Protected Pay (real refund + release), NEP-141 token payments and session-bound merchant sales,
all proven on @NEARProtocol Testnet. taplyapp.xyz #NEARHackathon"

## L. Kalan engeller (somut)

1. Canlı Handshake servisi için kalıcı depolamalı barındırma + F-06 kimlik doğrulama incelemesi.
2. G3/NEP-141/G2 aday kontratları için insan güvenlik incelemesi (denetim yok).
3. Doğrulayıcı yedeği ve token arayüzünün üretime alınması için Vercel erişimi (sahibin makinesi).
4. Farklı tokenla ödeme için doğrulanmış bir Testnet swap/intents yolu.

## M. Sahibin yapması gerekenler (en az)

1. G1 imzalı kabul turu (QA derlemesi, kendi iki cüzdanı, ~20 dk) → üretimde imzayı açma kararı.
2. Bu dalın incelenip `main`/`release/taplyapp`'e alınması (doğrulayıcı düzeltmesi salt-okunur, düşük risk).
3. Protected QA derlemesi için Vercel'de dal ortam değişkenleri:
   `NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY=on`, `NEXT_PUBLIC_TAPLY_PROTECTED_CONTRACT_ID=taply-e2e-6cdaf61b.testnet`,
   `NEXT_PUBLIC_TAPLY_PROTECTED_CODE_HASH=Ea5REQGAgRUiL6JzbKMY5sRRn2E4oPs3i1oFHPsSz29A`, `NEXT_PUBLIC_TAPLY_PROTECTED_QA=on`
   (yalnızca korumalı önizleme; üretimde asla).
4. Handshake sunucusu için barındırma hesabı.
5. Video kaydı, X gönderisi ve başvuru.

## N. Karar

**CONDITIONAL GO.** Herkese açık salt-okunur Testnet sürümü (`22765d7`) sağlam. Anında Ödeme, Protected Pay,
NEP-141 ve oturuma bağlı mağaza satışı gerçek Testnet işlemleriyle kanıtlandı, fakat herkese açık imza kapalı
kalıyor: sahibin fiziksel cüzdan kabulü ve emanet kontratları için insan güvenlik incelemesi gerekiyor. Canlı
iki cihazlı Handshake servisi barındırma nedeniyle engelli. Ürün "tamamen uygulanmış" değil; güçlü, kanıtlı bir
hackathon prototipi.
