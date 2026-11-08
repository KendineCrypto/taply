# Taply — iPhone test rehberi (Türkçe)

Bu rehber, Taply'yi kendi iPhone'unda elle denemen içindir. Hiçbir adımda gerçek
para yoktur: Taply yalnızca **NEAR Testnet** kullanır, ödeme imzalama kapalıdır.

- Test edilen sürüm: dal `feature/monday-testnet-sprint`, yeni tasarım (commit `f032e82` uygulama kodu)
- Bu bilgisayardaki sunucu: `127.0.0.1:3100` (tek sunucu), Tailscale ile yalnızca senin ağında yayında

## 0. Başlamadan önce (bir kez)

> **Şu an önemli:** Bu bilgisayarda Tailscale başka bir Windows kullanıcısına (`loltest`) geçmiş ve bağlantı kapalı.
> Önce bilgisayarda: Tailscale'i çalıştıran kullanıcıyla oturum aç → görev çubuğundaki Tailscale simgesi →
> **Connect** (bağlı olsun). Kalıcı çözüm: Tailscale menüsü → **Preferences / Tercihler → Run unattended**.
> Sonra bana yaz; bağlantıyı yeniden doğrulayacağım. O zamana kadar aşağıdaki bağlantılar açılmaz.

**Yol A — Tailscale (hazır, şimdi çalışıyor):**

1. iPhone'da App Store'dan **Tailscale** uygulamasını kur.
2. Uygulamayı aç → **Log in** → bilgisayarda kullandığın hesapla giriş yap (`fatihgoren.yazilim@…` ile görünen hesap).
3. Tailscale'in iPhone'a VPN profili eklemesine izin ver (iOS bir kez onay ister).
4. Tailscale'de anahtar **Connected** (bağlı) olsun. Listede `desktop-sdai72b` görünmeli.
5. Bilgisayar açık kalmalı ve uyku moduna geçmemeli.

Tailscale **mobil veri ile de çalışır** (aynı Wi-Fi şart değil). Wi-Fi'yi kapatıp
yalnızca hücresel veriyle de deneyebilirsin. Bu bağlantı herkese açık değildir;
yalnızca senin Tailscale hesabındaki cihazlar açabilir.

**Yol B — Vercel Önizleme (henüz YOK):** Vercel girişi ve senin onayın gerekiyor
(sonuç mesajındaki D maddesi). Kurulunca adresi buraya ekleyeceğim. O zamana kadar
adım 22 **BLOCKED**.

### Bağlantılar (hepsi bu bilgisayardan HTTPS ile kontrol edildi, 200 döndü)

Temel adres: **https://desktop-sdai72b.tailde1299.ts.net**

| Ne | Bağlantı |
| --- | --- |
| Ana sayfa | https://desktop-sdai72b.tailde1299.ts.net/ |
| Ayarlar (dil) | https://desktop-sdai72b.tailde1299.ts.net/settings |
| DEMO (sahte, etiketli) | https://desktop-sdai72b.tailde1299.ts.net/demo |
| DEMO Handshake önizleme | https://desktop-sdai72b.tailde1299.ts.net/demo/handshake |
| Cüzdan | https://desktop-sdai72b.tailde1299.ts.net/wallet |
| Satıcı | https://desktop-sdai72b.tailde1299.ts.net/merchant |
| Mağaza / ödeme sayfası | https://desktop-sdai72b.tailde1299.ts.net/checkout/taplytest.testnet |
| Kişiler | https://desktop-sdai72b.tailde1299.ts.net/contacts |
| Tekrarlayan talepler | https://desktop-sdai72b.tailde1299.ts.net/recurring |
| Böl ve Öde | https://desktop-sdai72b.tailde1299.ts.net/split |
| Gerçek geçmiş 0,1 NEAR satış | https://desktop-sdai72b.tailde1299.ts.net/pay/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502 |
| Gerçek geçmiş makbuz | https://desktop-sdai72b.tailde1299.ts.net/receipt/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502?ftx=CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su |
| Arşivlenmiş doğrulama kaydı (JSON) | https://desktop-sdai72b.tailde1299.ts.net/evidence/instant-pay-2026-11-01-receipt.json |

## Kesinlikle YAPMA

- Cüzdanda **hiçbir işlemi onaylama**, hiçbir şeyi **imzalama**. Bir cüzdan imza,
  "Approve", "Sign", "Add key" veya ödeme isterse **İptal / Reject** de ve o adımı FAIL yaz.
- Kendi tohum kelimelerini (seed phrase / gizli anahtar) hiçbir yere yazma.
- Mainnet (gerçek) bir hesap kullanma. Yalnızca `.testnet` ile biten hesaplar.
- Bağlantıları başkalarıyla paylaşma (bu özel bir test adresidir).

## Hata bildirme

Her hata için: **adım numarası** + **ekran görüntüsü** (yan tuş + ses açma) + bir
cümle. Örnek: `Adım 09 — FAIL — makbuz 2 dakikadır "Kontrol ediliyor" — ekran: IMG_1234`.
Saat bilgisini de yaz (RPC sorunlarını eşleştirmek için).

## Adımlar

**Önemli:** Satıcı (05), Tekrarlayan talep oluşturma (13–14) ve Böl ve Öde oluşturma
(15–16) bir **bağlı cüzdan** ister (ödemeleri bağlı hesap alır). Bu testte cüzdan
imzası yetkili olmadığı için bu kısımlar varsayılan olarak **BLOCKED**. Elinde bir
Testnet cüzdanı varsa ve cüzdan **yalnızca giriş** (hesap adını paylaşma) yapıp
hiçbir imza/onay istemiyorsa bağlayabilirsin; imza isterse iptal et.

### 01 — Ana sayfayı Safari'de aç
1. Safari'de **Ana sayfa** bağlantısına dokun.
2. Cüzdan bağlıysa bakiyenin altında üç büyük düğme görürsün: **Al**, **İste**, **Öde**.
3. Görmen gereken: üstte `taply.` logosu, sağda yeşil noktalı **NEAR Testnet** rozeti, ortada **Cüzdan bağla** düğmesi, altta **Cüzdan · Tap · Geçmiş** menüsü.
- Başarılı: sayfa 5 sn içinde açılır, yatay kaydırma yok.
- Hatalı: beyaz sayfa, "bağlantı güvenli değil" uyarısı, sağa taşan içerik.

### 02 — Logo, düzen ve dil
1. Logonun `t` harfinin yanında yeşil (lime) nokta olsun; turuncu renk olmamalı.
2. Metinlerin ekrana sığdığını, düğmelerin parmakla rahat basılır olduğunu kontrol et.
- Hatalı: bozuk logo, üst üste binen yazılar, kesik düğmeler.

### 03 — Türkçe / İngilizce değiştir
1. **Ayarlar** bağlantısını aç. **Dil** bölümünde **English** düğmesine bas.
2. Başlıklar İngilizce olmalı ("Settings"). Sayfayı yenile (adres çubuğu → ↻); İngilizce kalmalı.
3. **Türkçe** düğmesine bas; Türkçe'ye dönmeli.
- Hatalı: dil yenilemeden sonra geri dönüyor ya da karışık dil.

### 04 — Cüzdan seçimini aç (imzasız)
1. Ana sayfada **Cüzdan bağla**'ya bas.
2. Bir liste açılmalı (ör. **Meteor Wallet, Intear Wallet, Ledger, Nightly Wallet, Ethereum Wallets, NEAR CLI**).
3. Hiçbirini seçmeden listeyi kapat (dışarı dokun veya kapat işareti).
- Başarılı: liste açılır ve sorunsuz kapanır; hiçbir şey imzalanmaz.
- Hatalı: liste hiç açılmıyor, sayfa donuyor, kapatınca hata kalıyor.

### 05 — Satıcı sayfaları
1. **Satıcı** bağlantısını aç.
- Cüzdan bağlı değilken beklenen: başlık **Satıcı** ve **Cüzdan bağla** düğmesi. Bu doğrudur (PASS).
- Cüzdan bağlıysa (isteğe bağlı): **ALICI HESAP** kutusunda tam hesap adın, **Yeni satış** ve **Mağaza QR** kartları, **Bu cihazdaki istekler** listesi. **Yeni satış**'a basarsan form açılır ama işlem imzalama **kapalıdır** — formu gönderme / cüzdanda onaylama.

### 06 — Mağaza QR ve ödeme sayfası
1. **Mağaza / ödeme sayfası** bağlantısını aç.
2. Görmen gereken: başlık **Ödeme**, **ALICI** altında `taplytest.testnet`, "İşletme kimliği doğrulanmadı" notu, **Satış bekleniyor** kartı, **Satış QR’ını okut** ve **Satış bağlantısını yapıştır** düğmeleri, sarı "Hesabı kontrol et" uyarısı.
3. Burada **tutar olmamalı**: mağaza QR'ı ödeme değildir, satış QR'ı ayrı oluşturulur.
4. (İsteğe bağlı) Cüzdan bağlıysa 05'te **Mağaza QR**'a bas: açılan QR/bağlantı `https://desktop-sdai72b...` ile başlamalı (asla `localhost`).
- Hatalı: bu sayfada bir tutar veya "ödendi" yazısı görmek.

### 07 — DEMO yolculuğunu baştan sona tamamla
1. **DEMO** bağlantısını aç. Başlık **60 saniyede Taply**; her ekranda **DEMO** etiketi olmalı.
2. **İleri** ile 1'den 8'e kadar ilerle: 1. Cüzdanınız → 2. Alın → 3. Gönderin → 4. Talep oluşturun → 5. Paylaşın → 6. Ödeyen kontrol eder → 7. Kesinleşmesini izleyin → 8. Doğrulanmış makbuz.
3. Adım 6'da onay kutusunu işaretle ve **Cüzdanda onayla (demo)**'ya bas. Hiçbir cüzdan açılmamalı; ekran 7. adıma geçmeli.
- Başarılı: tüm adımlar DEMO etiketli; gerçek cüzdan açılmaz.
- Hatalı: DEMO etiketi olmayan bir "ödendi" ekranı, gerçek cüzdan açılması.

### 08 — Gerçek geçmiş Testnet satışı
1. **Gerçek geçmiş 0,1 NEAR satış** bağlantısını aç.
2. ~10 sn içinde: **Ödeme** başlığı, **0,1 NEAR**, **SATIŞ KODU KED 5E9**, alıcı `taplytest.testnet`, durum **Ödeme kaydedildi** (altında "Doğrulama bekleniyor"). **Makbuzu doğrula** düğmesi, altında kapalı **Adımlar** ve **İşlem ayrıntıları** bölümleri ve **Tekrar kontrol et** olur. İçinde blok numarası gibi teknik bilgiler var; varsayılan ekranda görünmemeli.
- Bu sahte değildir: 1 Kasım 2026'daki gerçek Testnet pilot ödemesidir ve zincirden şimdi okunur.
- Hatalı: farklı tutar/hesap, sonsuz "Kontrol ediliyor", "Doğrulanmış Ödendi" yazısının yeşil şeritsiz görünmesi.

### 09 — Geçmiş makbuz ve doğrulama
1. **Gerçek geçmiş makbuz** bağlantısını aç; 1–2 dakika bekle.
2. İki sonuçtan biri doğrudur:
   - **Doğrulanmış Ödendi** (yeşil/lime şerit + kanıt satırları) → taze doğrulama başarılı; ekran görüntüsü al.
   - **Ödeme kaydedildi** (altında "Doğrulama bekleniyor") + altında kesik çizgili **Arşivlenmiş doğrulama kaydı** kutusu → canlı doğrulama şu an olmadı (çoğunlukla RPC yoğunluğu). Bu da doğru davranıştır.
- Hatalı: arşiv kutusu varken üstte "Doğrulanmış Ödendi" yazması.

### 10 — RPC yoğunken arşiv kaydı açıkça etiketli mi
1. 09'da arşiv kutusu çıktıysa: üstünde **"Arşiv kaydı · canlı doğrulama değil"** rozeti olmalı ve metinde "yeni zincir okuması değil" yazmalı.
2. **Arşivlenmiş doğrulayıcı JSON dosyasını aç**'a bas: bir JSON sayfası açılır (`checkedAt: 2026-11-01T15:36:30.100Z`).
3. "RPC yoğun: doğrulama duraklatıldı" görürsen altındaki saati not al.
- 09'da taze **Doğrulanmış Ödendi** çıktıysa bu adım **BLOCKED** (RPC yoğun değildi; arşiv gösterilmedi). Bu iyi bir şey.
- Hatalı: arşiv kutusunun etiketsiz olması veya canlı sonuç gibi görünmesi.

### 11 — Yerel kişi oluştur
1. **Kişiler** bağlantısını aç (cüzdan gerekmez). "Henüz kişi yok" görürsün.
2. **Kişi ekle** → **İsim**: `Dükkan` → **NEAR Testnet hesap kimliği**: `taplytest.testnet` → **Kişiyi kaydet**.
3. Listede `Dükkan` ve altında `taplytest.testnet` görünmeli; "Kişi kaydedildi." yazmalı.
4. Tekrar **Kişi ekle** → isim `Sahte` → hesap `tap1ytest.testnet` (l yerine 1). Sarı **"Kayıtlı bir kişiye benziyor"** uyarısı çıkmalı; kutucuğu işaretlemeden kaydedilmemeli. **Vazgeç**'e bas.
5. Hesap alanına `ali.near` yaz: "mainnet (.near)" uyarısı çıkmalı.

### 12 — Düzenle, ara, sil
1. `Dükkan` satırında **Düzenle** → hesabı `taplytest2.testnet` yap. Eski → yeni hesabı gösteren uyarı ve onay kutusu çıkmalı; kutuyu işaretle → **Kişiyi kaydet**.
2. Bir kişi daha ekle: `Ayşe` / `ayse-test.testnet`. **Kişilerde ara** alanına `ayş` yaz: yalnızca Ayşe kalmalı.
3. `Ayşe` için **Sil** → açılan pencerede **Kişiyi sil**. Liste güncellenmeli, "Kişi silindi." yazmalı.
- Hatalı: kişi onaysız değişiyor, arama yanlış sonuç veriyor, silme penceresiz oluyor.

### 13 — Tekrarlayan talep şablonu oluştur
- Cüzdan bağlı değilse: **Tekrarlayan talepler** sayfasında "NEAR Testnet cüzdanını bağla" yazısı ve **Cüzdan bağla** görünür → adım **BLOCKED** (beklenen).
- Cüzdan bağlıysa (isteğe bağlı): **Yeni şablon** → İsim `Kira`, Tutar `1,5`, Tekrar **Her ay**, İlk tarih bugün → **Şablonu kaydet**. Kartta **Zamanı geldi: …** ve gelecek tarihler görünmeli.

### 14 — Kendiliğinden para göndermediğini doğrula
1. Başlığın altındaki küçük kalkanlı etiketi oku: **"Otomatik ödeme yok · her talebi sen onaylarsın"**.
2. (Cüzdan bağlıysa) **… için talebi hazırla**'ya bas: talep formu doldurulmuş açılır, üstte "“Kira” şablonundan" notu olur. **Devam et**'e basma, cüzdanda hiçbir şey onaylama; geri dön.
- Başarılı: hiçbir cüzdan penceresi kendiliğinden açılmaz.

### 15 — 1 NEAR'ı üç kişiye böl
- Cüzdan bağlı değilse: **BLOCKED** (beklenen; **Cüzdan bağla** görünür).
- Cüzdan bağlıysa: **Böl ve Öde** → **Yeni bölüşüm** → Ne için? `Yemek`, Toplam `1`, **Eşit**, İsim 1 `Ali`, İsim 2 `Can`, **Kişi ekle**, İsim 3 `Deniz` → **Bölüşümü kaydet**.

### 16 — Paylar tam olarak 1 NEAR mı
1. Kaydetmeden önce her pay **≈ 0,33333 NEAR** görünmeli (≈ yuvarlandığını gösterir).
2. **Kesin tutarlar**'a dokun: **0,333333333333333333333334**, **0,333333333333333333333333**, **0,333333333333333333333333 NEAR** (toplam tam 1).
2. **Özel tutarlar**'ı seçip 0,5 + 0,4 yazarsan "toplamdan … farklı" uyarısı çıkmalı ve kaydetmemeli.
- Cüzdan bağlı değilse **BLOCKED**.

### 17 — Sahte "ödendi" yok
Gezdiğin tüm sayfalarda kontrol et: **Doğrulanmış Ödendi** yalnızca 09'daki gerçek makbuzda (ve DEMO adım 8'de **DEMO** etiketiyle) görünebilir. Kişiler, şablonlar ve bölüşümlerde asla "ödendi" olmamalı; Böl ve Öde'de durum "Taleplerin hepsi henüz yok" ve "Bu sürümde talep oluşturma kapalı" olmalı.

### 18 — Yenile ve kalıcılığı kontrol et
1. **Kişiler** sayfasını yenile: kişilerin durmalı.
2. Safari'yi tamamen kapatıp açınca da durmalı. (Gizli sekmede durmazlar — bu normal.)

### 19 — İnterneti kapat / aç
1. Gerçek geçmiş satış sayfası açıkken **Uçak modu**nu aç, sayfayı yenile.
2. Hata ekranı veya "kontrol edilemedi" mesajı görmelisin; asla "ödendi" değil.
3. Uçak modunu kapat, Tailscale'in tekrar **Connected** olmasını bekle, **Tekrar kontrol et**'e bas: **Ödeme kaydedildi** (altında "Doğrulama bekleniyor") geri gelmeli.

### 20 — Ana Ekrana ekle
1. Safari'de ana sayfa açıkken alttaki **Paylaş** simgesi (kare + yukarı ok) → **Ana Ekrana Ekle** → ad **Taply** → **Ekle**.
2. Ana ekranda Taply simgesi (koyu yeşil zemin, `t.`) görünmeli.

### 21 — Ana ekran simgesinden aç
1. Yeni simgeye dokun. Safari adres çubuğu olmadan tam ekran açılmalı.
2. Adım 03 ve 08'i burada hızlıca tekrarla.
- Hatalı: beyaz ekran, simge yerine ekran görüntüsü, Safari çubuğuyla açılma.

### 22 — İkinci tur: hücresel veri + Vercel Önizleme
- **BLOCKED**: Vercel Önizleme adresi henüz yok (giriş ve onay bekleniyor).
- Şimdilik yapılabilir: Wi-Fi'yi kapat, yalnızca hücresel veri + Tailscale ile 01, 08, 09 ve 11'i tekrarla.

## Sonuç tablosu

```
ADIM | PASS / FAIL / BLOCKED | EKRAN GÖRÜNTÜSÜ | NOTLAR
01   |                       |                 |
02   |                       |                 |
03   |                       |                 |
04   |                       |                 |
05   |                       |                 |
06   |                       |                 |
07   |                       |                 |
08   |                       |                 |
09   |                       |                 |
10   |                       |                 |
11   |                       |                 |
12   |                       |                 |
13   |                       |                 |
14   |                       |                 |
15   |                       |                 |
16   |                       |                 |
17   |                       |                 |
18   |                       |                 |
19   |                       |                 |
20   |                       |                 |
21   |                       |                 |
22   |                       |                 |
iPhone modeli: ____  iOS: ____  Tarih/saat: ____  Ağ: Wi-Fi / Hücresel
```
