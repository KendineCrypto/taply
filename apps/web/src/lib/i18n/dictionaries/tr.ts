import type { Dictionary } from '../types';

/**
 * Turkish (secondary locale).
 *
 * Strings marked NORMATIVE are quoted verbatim from docs/UX_FLOWS.md
 * "Real-time copy rules" and must not be paraphrased away.
 *
 * `errors` is keyed by the `@taply/shared` ErrorCode union, so a code added by
 * Codex stops this file compiling until it is translated.
 */
export const tr: Dictionary = {
  locale: 'tr',
  localeName: 'Türkçe',

  app: {
    name: 'Taply',
    networkBadge: 'NEAR Testnet',
    demoFundsNote: 'Yalnızca test fonları. Gerçek para değil, parasal değeri yok.',
    skipToContent: 'Ana içeriğe geç',
    languageLabel: 'Dil',
  },

  nav: {
    home: 'Ana sayfa',
    pay: 'Öde',
    scan: 'Tara',
    activity: 'Hareketler',
    settings: 'Ayarlar',
    primaryLabel: 'Ana gezinme',
  },

  common: {
    amount: 'Tutar',
    recipient: 'Alıcı',
    payer: 'Ödeyen',
    network: 'Ağ',
    mode: 'Mod',
    copy: 'Kopyala',
    copied: 'Kopyalandı',
    back: 'Geri',
    retry: 'Tekrar dene',
    close: 'Kapat',
    viewReceipt: 'Makbuzu gör',
    viewOnExplorer: "Explorer'da gör",
    checkChainStatus: 'Zincir durumunu kontrol et',
    loading: 'Yükleniyor',
    notAvailable: 'Mevcut değil',
    exactBaseUnits: 'Taban birimde tam tutar',
    approximate: 'Yaklaşık',
  },

  mode: {
    instant: 'Anında Ödeme',
    protected: 'Korumalı Ödeme',
  },

  status: {
    OPEN: {
      // NORMATIVE
      label: 'Ödeme bekleniyor',
      payer: 'Bu talep henüz fonlanmadı.',
      recipient: 'Henüz hiçbir tutar alınmadı.',
      announce: 'Ödeme bekleniyor. Hiçbir fon hareket etmedi.',
    },
    CANCELLED_UNFUNDED: {
      label: 'İptal edildi',
      payer: 'Bu talep fonlanmadan önce iptal edildi.',
      recipient: 'Fonlanmadan önce iptal edildi. Hiçbir tutar alınmadı.',
      announce: 'Fonlanmadan önce iptal edildi. Fon hareketi olmadı.',
    },
    PAYOUT_IN_FLIGHT: {
      label: 'Zincirde işleniyor',
      // NORMATIVE
      payer: 'Ödeme zincirde işleniyor. Sonuç doğrulanıyor.',
      recipient: 'Transfer zincirde işleniyor. Hesabınıza ulaştığı henüz doğrulanmadı.',
      announce: 'Ödeme zincirde işleniyor. Sonuç henüz doğrulanmadı. Tekrar ödeme yapmayın.',
    },
    PAYOUT_FAILED_RECOVERABLE: {
      label: 'Aktarım tamamlanamadı',
      // NORMATIVE
      payer: 'Aktarım tamamlanamadı. Para durumu korunuyor; yeniden dene veya destek akışını izle.',
      recipient: 'Size yapılan aktarım tamamlanamadı. Yükümlülük korunuyor ve yeniden denenebilir.',
      announce: 'Aktarım tamamlanamadı. Para durumu korunuyor. Ödenmedi ve kaybolmadı.',
    },
    LOCKED: {
      label: 'Kilitli, ödenmedi',
      // NORMATIVE
      payer: 'Tutar kontratta kilitli. Satıcıya henüz ödenmedi. İptal hakkı sona erince aktarım yapılabilir.',
      recipient: 'KİLİTLİ — ÖDENMEDİ. Tutar kontratta tutuluyor ve tarafınızdan harcanamaz.',
      announce: 'Tutar kontratta kilitli. Satıcıya ödenmedi. Harcanamaz.',
    },
    REFUND_IN_FLIGHT: {
      label: 'İade işleniyor',
      // NORMATIVE
      payer: 'İadenin zincirde tamamlanması bekleniyor.',
      recipient: 'Ödeyene iade zincirde tamamlanıyor. Bu talep için ödeme almayacaksınız.',
      announce: 'İade zincirde işleniyor. Henüz tamamlanmadı.',
    },
    REFUND_FAILED_RECOVERABLE: {
      label: 'İade tamamlanamadı',
      // NORMATIVE
      payer: 'Aktarım tamamlanamadı. Para durumu korunuyor; yeniden dene veya destek akışını izle.',
      recipient: 'İade tamamlanamadı. Yükümlülük korunuyor.',
      announce: 'İade tamamlanamadı. Para durumu korunuyor. Ne ödendi ne iade edildi.',
    },
    RELEASE_IN_FLIGHT: {
      label: 'Aktarım işleniyor',
      // NORMATIVE
      payer: 'Satıcıya transfer doğrulanıyor. Henüz tamamlanmadı.',
      recipient: 'Size transfer doğrulanıyor. Henüz tamamlanmadı.',
      announce: 'Aktarım zincirde işleniyor. Henüz tamamlanmadı. Ödenmedi.',
    },
    RELEASE_FAILED_RECOVERABLE: {
      label: 'Aktarım tamamlanamadı',
      // NORMATIVE
      payer: 'Aktarım tamamlanamadı. Para durumu korunuyor; yeniden dene veya destek akışını izle.',
      recipient: 'Aktarım tamamlanamadı. Yükümlülük korunuyor ve yeniden denenebilir.',
      announce: 'Aktarım tamamlanamadı. Para durumu korunuyor. Ödenmedi.',
    },
    FINAL_PAID: {
      label: 'Ödendi',
      // NORMATIVE
      payer: 'Ödeme doğrulandı. Satıcıya ulaştı.',
      recipient: 'Ödeme doğrulandı. Tutar hesabınıza ulaştı.',
      announce: 'Ödeme zincirde doğrulandı. Tutar alıcıya ulaştı.',
    },
    CANCELLED_REFUNDED: {
      label: 'İade edildi',
      // NORMATIVE
      payer: 'Ödeme iptal edildi ve tutar iade edildi.',
      recipient: 'İptal edildi ve ödeyene iade edildi. Ödeme almadınız.',
      announce: 'İptal edildi ve ödeyene iade edildi. Bu bir ödeme değildir.',
    },
  },

  localPhase: {
    IDLE: { label: 'Hazır', description: 'Devam eden işlem yok.' },
    REVIEWING: { label: 'İncele', description: 'Onay vermeden önce kesin koşulları kontrol et.' },
    AWAITING_SIGNATURE: {
      // NORMATIVE
      label: 'Cüzdanda işlemi onayla',
      description: 'İşlemi cüzdanında onayla. Henüz hiçbir şey gönderilmedi.',
    },
    USER_REJECTED: {
      label: 'İmza reddedildi',
      description: 'İmzayı reddettin. Hiçbir şey gönderilmedi ve ödeme oluşturulmadı.',
    },
    SUBMITTED: {
      label: 'Gönderildi',
      description: 'İşlem gönderildi. Zincirin sonucu onaylaması bekleniyor.',
    },
    OUTCOME_UNKNOWN: {
      label: 'Sonuç belirsiz',
      // NORMATIVE
      description: 'Sonuç belirsiz. Tekrar ödeme yapmadan önce zincir durumunu kontrol ediyoruz.',
    },
  },

  sessionState: {
    DRAFT: { label: 'Hazırlanıyor', description: 'Oturum hazırlanıyor.' },
    OPEN: { label: 'Eşleşme bekleniyor', description: 'Diğer cihazın katılması bekleniyor.' },
    PAIRED: { label: 'Eşleşti', description: 'İki cihaz da oturumda.' },
    REVIEWED: {
      label: 'Koşullar incelendi',
      description: 'Koşullar incelendi. Bu bir ödeme yetkisi değildir.',
    },
    EXPIRED: {
      label: 'Oturum sona erdi',
      // NORMATIVE
      description: 'Canlı oturum sona erdi; yeni oturum oluştur.',
    },
    CLOSED: { label: 'Oturum kapandı', description: 'Oturum kapatıldı.' },
  },

  assurance: {
    unverified: { label: 'Doğrulanmadı', description: 'Henüz zincire karşı kontrol edilmedi.' },
    pending_finality: { label: 'Kesinleşme bekliyor', description: 'Zincirde görüldü ama henüz kesinleşmedi.' },
    verified_final: { label: 'Doğrulandı', description: 'Zincirde kesin olarak onaylandı.' },
    unknown: { label: 'Bilinmiyor', description: 'Zincir durumu belirlenemedi.' },
    mismatch: {
      label: 'Uyuşmazlık',
      description: 'Kaynaklar çelişiyor. Zincir verisi geçerlidir; işlemler engellendi.',
    },
  },

  errors: {
    INVALID_ARGUMENT: {
      title: 'Geçersiz istek',
      body: 'İstekte geçersiz bir şey var. Hiçbir şey gönderilmedi.',
    },
    INVALID_ACCOUNT: { title: 'Geçersiz hesap', body: 'Bu NEAR hesap kimliği geçerli değil.' },
    INVALID_AMOUNT: { title: 'Geçersiz tutar', body: 'Taban birimde tam ve pozitif bir tutar gir.' },
    INVALID_DURATION: {
      title: 'Geçersiz iptal süresi',
      body: 'İptal süresi 60 saniye ile 1 saat arasında olmalı.',
    },
    INVALID_EXPIRY: {
      title: 'Geçersiz son tarih',
      body: 'Fonlama son tarihi gelecekte ve 24 saat içinde olmalı.',
    },
    WRONG_NETWORK: {
      title: 'Yanlış ağ',
      body: "Taply yalnızca NEAR Testnet üzerinde çalışır. Cüzdanını Testnet'e al ve tekrar dene.",
    },
    UNSUPPORTED_ASSET: {
      title: 'Desteklenmeyen varlık',
      body: 'Bu sürümde yalnızca native Testnet NEAR destekleniyor.',
    },
    UNSUPPORTED_MODE: { title: 'Desteklenmeyen mod', body: 'Bu ödeme modu bu sürümde etkin değil.' },
    INVALID_DEPOSIT: {
      title: 'Yatırılan tutar uyuşmuyor',
      body: 'Eklenen tutar istenen tutarla tam olarak aynı olmalı. Hiçbir şey kabul edilmedi.',
    },
    INSUFFICIENT_PREPAID_GAS: {
      title: 'Yeterli gas eklenmedi',
      body: 'İşlem, güvenle tamamlanmak için yeterli gas ayırmadı.',
    },

    AUTH_REQUIRED: { title: 'Giriş gerekli', body: 'Devam etmek için cüzdanınla kimlik doğrula.' },
    AUTH_EXPIRED: { title: 'Giriş süresi doldu', body: 'Girişin sona erdi. Yeniden kimlik doğrula.' },
    AUTH_SIGNATURE_INVALID: { title: 'İmza geçersiz', body: 'Bu cüzdan imzası doğrulanamadı.' },
    AUTH_CHALLENGE_EXPIRED: { title: 'Doğrulama süresi doldu', body: 'Giriş doğrulaması sona erdi. Yeniden başla.' },
    AUTH_CHALLENGE_USED: {
      title: 'Doğrulama zaten kullanıldı',
      body: 'Bu giriş doğrulaması daha önce kullanıldı. Yenisini başlat.',
    },
    NOT_AUTHORIZED: { title: 'Yetkisiz', body: 'Hesabın bu işlemi yapmaya yetkili değil.' },
    PAYER_MISMATCH: {
      title: 'Farklı ödeyen gerekli',
      body: 'Bu talep başka bir hesaba kısıtlı. Bu hesaptan ödeme yapma.',
    },
    MERCHANT_BINDING_INVALID: {
      title: 'Satıcı hesabı uyuşmuyor',
      body: 'Alıcı hesap satıcı profiliyle uyuşmuyor. Ödeme yapma.',
    },
    UNSUPPORTED_CALLER: { title: 'Desteklenmeyen çağrı', body: 'Bu işlem bu bağlamdan yapılamaz.' },
    CSRF_REJECTED: {
      title: 'İstek engellendi',
      body: 'Bu istek bu uygulamadan gelmedi. Hiçbir işlem yapılmadı.',
    },

    REQUEST_NOT_FOUND: { title: 'Talep bulunamadı', body: 'Bu kimlik için bir ödeme talebi yok.' },
    SESSION_NOT_FOUND: { title: 'Oturum bulunamadı', body: 'Böyle bir canlı oturum yok.' },
    MERCHANT_NOT_FOUND: { title: 'Satıcı bulunamadı', body: 'Bu hesap için satıcı profili yok.' },
    IDEMPOTENCY_CONFLICT: {
      title: 'Zaten işleniyor',
      body: 'Aynı istek halen işleniyor. İkinci bir tane oluşturulmayacak.',
    },
    REQUEST_ID_CONFLICT: {
      title: 'Talep zaten var',
      body: 'Bu kimliği başka bir talep kullanıyor. Yeni bir talep oluşturulmalı.',
    },
    TERMS_MISMATCH: {
      title: 'Koşullar değişti',
      body: 'Sen incelerken ödeme koşulları değişti. Onay vermeden önce yeni koşulları incele.',
    },
    REQUEST_EXPIRED: { title: 'Talep süresi doldu', body: 'Bu talep artık fonlanamaz. Yeni bir talep iste.' },
    REQUEST_NOT_OPEN: { title: 'Talep açık değil', body: 'Bu talep artık fonlama kabul etmiyor.' },
    REQUEST_ALREADY_FUNDED: { title: 'Zaten fonlandı', body: 'Bu talep bir kez fonlandı.' },
    REQUEST_ALREADY_SETTLED: { title: 'Zaten sonuçlandı', body: 'Bu talep zaten nihai bir duruma ulaştı.' },

    CANCEL_WINDOW_CLOSED: {
      title: 'İptal süresi kapandı',
      body: 'Bu çağrı işlemeden önce zincir iptal süresini kapattı. İptal artık mümkün değil.',
    },
    WINDOW_STILL_OPEN: { title: 'Aktarım için erken', body: 'İptal süresi zincirde henüz kapanmadı.' },
    OPERATION_IN_FLIGHT: {
      title: 'Aktarım sürüyor',
      body: 'Zincirde zaten bir aktarım işleniyor. Sonucu bekle.',
    },
    OPERATION_NONCE_MISMATCH: {
      title: 'Güncel değil',
      body: 'Bu görünüm zincirin gerisinde. Tekrar denemeden önce yenile.',
    },
    OPERATION_NOT_RETRYABLE: {
      title: 'Yeniden denenemez',
      body: 'Bu işlemin yeniden denenecek kayıtlı bir hatası yok veya yetkili taraf değilsin.',
    },
    RECEIPT_NOT_FINAL: {
      title: 'Makbuz nihai değil',
      body: 'Ödeme nihai duruma ulaşmadığı için henüz doğrulanmış bir makbuz yok.',
    },

    SESSION_MISMATCH: {
      title: 'Koşullar uyuşmuyor',
      body: 'İki cihaz aynı koşulları göstermiyor. Ödeme yapma. Yeni bir oturum başlat.',
    },
    SESSION_ALREADY_BOUND: {
      title: 'Oturum zaten kullanımda',
      body: 'Bu oturum başka bir talebe bağlı.',
    },
    SESSION_ALREADY_JOINED: { title: 'Oturuma zaten katılındı', body: 'Bu oturuma biri çoktan katıldı.' },
    SESSION_EXPIRED: {
      title: 'Oturum sona erdi',
      // NORMATIVE
      body: 'Canlı oturum sona erdi; yeni oturum oluştur.',
    },
    JOIN_TOKEN_EXPIRED: { title: 'Bağlantı süresi doldu', body: 'Bu katılım bağlantısı sona erdi. Yenisini iste.' },
    JOIN_TOKEN_USED: { title: 'Bağlantı kullanıldı', body: 'Bu katılım bağlantısı daha önce kullanıldı.' },
    STORAGE_QUOTE_CHANGED: {
      title: 'Maliyetler değişti',
      body: 'Başladığından beri depolama maliyeti değişti. İmzalamadan önce yeni tutarları incele.',
    },

    RATE_LIMITED: { title: 'Çok fazla istek', body: 'Biraz bekle ve tekrar dene.' },
    RPC_UNAVAILABLE: {
      title: 'Zincire ulaşılamıyor',
      body: 'Şu anda ağa ulaşılamıyor. Hiçbir ödeme etkilenmedi.',
    },
    INDEX_UNAVAILABLE: { title: 'Geçmiş yüklenemiyor', body: 'Son hareketler şu anda yüklenemiyor.' },
    VERIFICATION_UNAVAILABLE: {
      title: 'Şu anda doğrulanamıyor',
      body: 'Zincir durumu onaylanamıyor; bu nedenle hiçbir şey doğrulanmış olarak gösterilmiyor.',
    },
    CONTRACT_UNAVAILABLE: { title: 'Kontrata ulaşılamıyor', body: 'Ödeme kontratına ulaşılamıyor.' },
    TRANSFER_LIQUIDITY_UNAVAILABLE: {
      title: 'Aktarım yapılamıyor',
      body: 'Kontrat şu anda aktarımı tamamlayamıyor. Para durumu korunuyor.',
    },

    WALLET_NOT_READY: { title: 'Cüzdan hazır değil', body: 'Devam etmek için bir NEAR Testnet cüzdanı bağla.' },
    USER_REJECTED: { title: 'İmza reddedildi', body: 'İmzayı reddettin. Hiçbir şey gönderilmedi.' },
    INSUFFICIENT_BALANCE: { title: 'Bakiye yetersiz', body: 'Bu hesapta yeterli Testnet NEAR yok.' },
    INSUFFICIENT_GAS: { title: 'Gas yetersiz', body: 'İşlem ücretleri için biraz daha Testnet NEAR ekle.' },

    RPC_TIMEOUT_UNKNOWN_STATUS: {
      title: 'Sonuç belirsiz',
      // NORMATIVE
      body: 'Sonuç belirsiz. Tekrar ödeme yapmadan önce zincir durumunu kontrol ediyoruz.',
    },
    CALLBACK_FAILED: {
      title: 'Sonuç çözülmedi',
      body: 'Aktarım başladı ama sonucu henüz kaydedilmedi. Bu durum çözülürken tekrar ödeme yapma.',
    },
    RECONCILIATION_REQUIRED: {
      title: 'Mutabakat gerekiyor',
      body: 'Bu ödeme zincirde çözülmesi gereken belirsiz bir durumda. Tekrar ödeme yapma.',
    },
  },

  notices: {
    offline: { title: 'Bağlantı yok', body: 'Bağlantını kontrol et. Hiçbir ödeme etkilenmedi.' },
    unexpected: {
      title: 'Bir sorun oluştu',
      body: 'Bu tamamlanamadı. Bu uygulama hiçbir ödeme durumunu değiştirmedi.',
    },
    socialLoginUnavailable: {
      title: 'Testnet için kullanılamıyor',
      // NORMATIVE
      body: 'Bu giriş yöntemi Testnet cüzdanı için henüz kullanılamıyor. Desteklenen cüzdanla devam et.',
    },
    chainTimeUnavailable: {
      title: 'Zincir saati okunamıyor',
      body: 'Zincir saati okunamıyor; gösterilecek geri sayım güvenilir olmaz.',
    },
    incidentOpen: {
      title: 'Zincirde çözülmemiş durum',
      body: 'Bu ödemenin sonucu belirsiz. Mutabakat sağlanana kadar işlemler engellendi. Tekrar ödeme yapma.',
    },
    projectionContradiction: {
      title: 'Çelişkili haklar bildirildi',
      body: 'Hem iptal hem aktarım uygun olarak bildirildi; ikisi birlikte doğru olamaz. Hiçbir işlem sunulmuyor.',
    },
  },

  protectedPay: {
    preFundingConsent:
      'Ödeme zincirde fonlandığı andan itibaren 60 saniye boyunca iptal edebilirsin; iptalin başarılı olup olmadığını zincirdeki işlem zamanı belirler. Bu sürenin ardından aktarım için ayrı bir işlem gerekir.',
    postFundingCutoffLabel: 'İptal süresi bitişi',
    countdownApproximate: 'Geri sayım yaklaşıktır. Kesin bitiş zamanını zincir belirler.',
    cutoffPassed: 'İptal süresi kapanmış olabilir. İptalin hâlâ işlenip işlenmeyeceğini zincir belirler.',
    whoCanCancel: 'Yalnızca ödeyen olarak sen iptal edebilirsin — ve sadece zincirdeki bitiş zamanından önce.',
    whoCanRelease:
      'Bitiş zamanından sonra aktarım işlemini herkes gönderebilir. Sürenin geçmesi tek başına kimseye ödeme yapmaz.',
    merchantCannot: 'Alıcı, bitiş zamanından önce tutarı harcayamaz, taşıyamaz veya aktaramaz.',
    lockedNotPaid: 'KİLİTLİ — ÖDENMEDİ',
  },

  handshake: {
    comparisonCodeLabel: 'Karşılaştırma kodu',
    comparisonCodeCaption: 'İki ekranda da aynı kodun göründüğünü kontrol et.',
    comparisonMismatch: 'Kodlar uyuşmuyor. Ödeme yapma. Yeni bir oturum başlat.',
    notIdentityProof:
      'Bu kod iki kişinin aynı koşulları karşılaştırmasına yardım eder. Kimlik kanıtı değildir ve çakışabilir.',
    offlineDegraded: 'Canlı oturum kullanılamıyor. Doğrulanmış talebi doğrudan inceleyip ödeyebilirsin.',
  },

  checkout: {
    permanentQrIsDiscovery:
      'Bu kalıcı QR satıcı profilini açar. Ödenebilir bir fatura değildir ve kendi başına tahsilat oluşturamaz.',
    merchantMustSign: 'Satıcı her satış için zincirde yeni bir talep imzalar.',
    accountControlOnly:
      'Doğrulanmış bir satıcı bu NEAR hesabının kontrolünü kanıtlamıştır. Bu bir işletme kimliği veya KYC kontrolü değildir.',
  },

  flags: {
    disabledTitle: 'Etkin değil',
    disabledBody: 'Bu yetenek bu sürümde etkin değil.',
    comingLater: 'Daha sonra gelecek',
    requiresVerification: 'NEAR Testnet üzerinde doğrulanana kadar devre dışı.',
  },

  mock: {
    badge: 'MOCK',
    demoOnly: 'Demo verisi. Gerçek bir işlem değil ve zincirde yok.',
    blockedOutsideDemo: 'Mock veri demo alanı dışında gösterilemez.',
  },

  wallet: {
    connect: 'Cüzdan bağla',
    connecting: 'Cüzdanın açılıyor…',
    restoring: 'Cüzdan bağlantısı kontrol ediliyor',
    disconnect: 'Bağlantıyı kes',
    connectedWith: '{wallet} ile bağlı',
    accountLabel: 'Hesap',
    walletLabel: 'Cüzdan',
    connectTitle: 'NEAR Testnet cüzdanı bağla',
    connectBody: 'Testnet bakiyeni gör; ödeme istemeye ve ödemeye hazır ol.',
    noKeysNote: 'Taply anahtarlarını asla görmez ve saklamaz. Her transferi kendi cüzdanında onaylarsın.',
    reportedNotProven:
      'Bu hesap kimliğini cüzdanın paylaştı. Hiçbir şey imzalanmadı; bağlanmak fon hareket ettiremez.',
    disabled: {
      title: 'Cüzdan bağlantısı kapalı',
      body: 'Bu sürümde cüzdan bağlantısı kapatılmış.',
    },
    likelyMainnet: {
      title: 'Bu bir mainnet hesabına benziyor',
      body: "Taply yalnızca NEAR Testnet'te çalışır. Bu hesap Testnet'te yoksa cüzdanını Testnet'e geçir.",
    },
    copyAccount: 'Hesap kimliğini kopyala',
    accountCopied: 'Hesap kimliği kopyalandı',
    copyFailed: 'Kopyalanamadı. Hesap kimliğini seçip elle kopyala.',
    accountMenuLabel: 'Cüzdan hesabı',
    errors: {
      cancelled: {
        title: 'Bağlantı iptal edildi',
        body: 'Cüzdan bağlanmadan kapatıldı. Hiçbir şey değişmedi.',
      },
      unavailable: {
        title: 'Kullanılabilir cüzdan yok',
        body: 'Cüzdan listesi yüklenemedi ya da Testnet destekleyen bir cüzdan yok. Bağlantını kontrol edip tekrar dene.',
      },
      no_account: {
        title: 'Kullanılabilir hesap yok',
        body: 'Cüzdan geçerli bir NEAR hesabı paylaşmadı. Cüzdanında bir Testnet hesabı seç ya da oluştur.',
      },
      failed: {
        title: 'Bağlanılamadı',
        body: 'Cüzdan bağlantıyı tamamlamadı. Hiçbir şey imzalanmadı. Tekrar dene.',
      },
    },
  },

  balance: {
    title: 'Testnet bakiyesi',
    refresh: 'Bakiyeyi yenile',
    refreshing: 'Yenileniyor',
    verifiedAt: 'Kesinleşmiş blok #{height} · {time}',
    staleAt: 'Son doğrulama {time}. Son okuma başarısız oldu.',
    storageNote: 'Toplam hesap bakiyesi. Bir kısmı depolama için ayrılmıştır ve gönderilemez.',
    lockedLabel: 'Kilitli (stake)',
    notShown: 'Bakiye gösterilmiyor',
    loading: "Bakiye NEAR Testnet'ten okunuyor",
    notFound: {
      title: "Hesap Testnet'te bulunamadı",
      body: "Bu hesap NEAR Testnet'te yok. Bir mainnet hesabı olabilir ya da henüz fonlanmamış olabilir.",
    },
    networkMismatch: {
      title: 'Yanlış ağ',
      body: 'Bakiye servisi NEAR Testnet olarak yanıt vermedi; bu yüzden bakiye gösterilmiyor.',
    },
    unverified: {
      title: 'Bakiye doğrulanmadı',
      body: 'Okuma kesinleşmiş bir Testnet bloğuna bağlanamadı; bu yüzden tutar gösterilmiyor.',
    },
    readFailed: {
      title: 'Bakiye alınamıyor',
      body: "NEAR Testnet'e ulaşılamadı. Fonların etkilenmedi. Tekrar dene.",
    },
    rateLimited: {
      title: 'Çok fazla istek',
      body: 'Herkese açık Testnet servisi yoğun. Biraz bekleyip yenile.',
    },
    configInvalid: {
      title: 'Zincir bağlantısı yapılandırılmamış',
      body: 'Bu sürümde geçerli bir NEAR Testnet bağlantısı yok; bakiyeler okunamıyor.',
    },
  },

  home: {
    quickActionsLabel: 'Hızlı işlemler',
    send: 'Gönder',
    receive: 'Al',
    request: 'İste',
    soon: 'Yakında',
    recentActivity: 'Son hareketler',
    activityEmptyTitle: 'Henüz gösterilecek hareket yok',
    activityEmptyBody:
      "Ödeme geçmişi servisi devreye girdiğinde Taply hareketlerin burada görünür. Tüm Testnet geçmişin explorer'da.",
    activityConnectBody: 'Hareketlerini görmek için bir cüzdan bağla.',
    viewOnExplorer: "Hesabı explorer'da görüntüle",
  },

  routes: {
    payHub: {
      description: 'Her ödeme eksiksiz gözden geçirilir ve kendi cüzdanında onaylanır.',
      scanBody: 'Bir satış ya da talep QR kodunu tara.',
      requestBody: 'Birinden ödeme iste.',
      sendBody: 'Doğrudan bir hesap kimliğine gönder.',
      swipeNote:
        'Kaydırma yalnızca cüzdanını açar. Kendi başına fon göndermez; her kaydırmanın bir düğme ve klavye karşılığı vardır.',
    },
    comingSoon: 'Yakında',
    afterVerification: "NEAR Testnet'te doğrulandıktan sonra kullanılabilir",
    send: 'Herhangi bir hesaba Testnet NEAR gönder; cüzdanında onaylamadan önce her şeyi gözden geçir.',
    receive: 'Testnet NEAR almak için hesap kimliğini paylaş.',
    scan: 'Satıcı ya da talep QR kodunu tara. Tutar ve alıcı her zaman zincirde yeniden kontrol edilir.',
    requestNew: 'Anında Ödeme talebi oluştur; bağlantı ya da QR ile paylaş. Korumalı Ödeme henüz kullanılamıyor.',
    activity: 'Taply ödemelerin, her biri için zincir üstü kanıtla.',
    contacts: 'Hesap kimliklerine bu cihazda isim ver. Ödemeden önce tam hesap kimliği her zaman gösterilir.',
    split: 'Bir hesabı, toplamı tam tutan ayrı taleplere böl.',
    recurring: 'Her seferinde yeni bir talep oluşturan şablonlar. Hiçbir zaman otomatik tahsilat yapılmaz.',
    merchant: 'Her satış zincir üstü durumuyla. Kilitli tutarlar asla ödenmiş gösterilmez.',
    merchantSetup: 'Cüzdanında imzalayarak satıcı profilini NEAR Testnet hesabına bağla.',
    merchantRegister: 'Bir tutar gir ve her satış için benzersiz, imzalı bir talep oluştur.',
    checkout: 'Bu satıcı sayfası aktif satışları gösterir. Kendi başına senden tahsilat yapamaz.',
    session: 'İki ekranda aynı kodu karşılaştır, sonra gözden geçirip öde.',
    payIntent: 'Cüzdanında onaylamadan önce alıcıyı, tam tutarı ve koşulları gözden geçir.',
    receipt: 'Makbuz yalnızca ödeme zincirde kesinleşip doğrulandıktan sonra görünür.',
    requestIdLabel: 'Talep kimliği',
    sessionIdLabel: 'Oturum kimliği',
    stateLabel: 'Durum',
    merchantAccountLabel: 'Satıcı hesabı',
  },

  receive: {
    yourAccount: 'Hesap kimliğin',
    testnetOnlyWarning: "Bu hesaba yalnızca NEAR Testnet fonu gönder. Buraya gönderilen mainnet fonları Taply'de görünmez.",
    qrLater: 'QR kod yalnızca bu hesap kimliğini içerir, asla bir tutar içermez.',
    connectFirst: 'Alım yapabileceğin hesap kimliğini görmek için bir cüzdan bağla.',
  },

  settings: {
    walletSection: 'Cüzdan',
    languageSection: 'Dil',
    networkSection: 'Ağ',
    contractLabel: 'Taply kontratı',
    contractNotDeployed: 'Yapılandırılmadı',
    rpcLabel: 'Testnet servisi',
    diagnosticsLink: 'Tanılamayı aç',
    diagnosticsBody: 'Bu sürümün teknik ayrıntıları, inceleyenler için.',
    notConnected: 'Bağlı cüzdan yok',
  },

  system: {
    reloadOnlyNote: 'Bu yalnızca ekranı yeniden yükler. Hiçbir şeyi yeniden göndermez.',
    notFoundBody: 'Bu bağlantı bir yere çıkmıyor. Hiçbir ödeme etkilenmedi.',
    goHome: 'Ana sayfaya dön',
    backOnline: 'Yeniden çevrimiçi',
  },

  diagnostics: {
    title: 'Tanılama',
    description: 'Bu sürümün teknik durumu. Aşağıdaki simüle veriler hiçbir zincire dokunmaz.',
    chainConfig: 'Zincir yapılandırması',
    chainConfigInvalid: 'Geçersiz yapılandırma. Zincir okumaları devre dışı.',
    checkNetwork: 'Testnet bağlantısını kontrol et',
    checking: 'Kontrol ediliyor',
    networkOk: 'Testnet doğrulandı',
    capabilities: 'Yetenekler',
    capabilitiesBody:
      'Ödeme yetenekleri NEAR Testnet\'te doğrulanana kadar kapalı kalır. "Kilitli", yalnızca yapılandırmayla açılamayacağı anlamına gelir.',
    enabled: 'açık',
    locked: 'kilitli',
    dependencies: 'Beklenenler',
    dependencyItems: [
      "İncelenmiş Korumalı Ödeme kontratı (Codex) - Korumalı Ödeme'yi engelliyor.",
      'GET /api/v1/payment-intents/:id ve /receipts/:id (Codex) - ödeme ve makbuz ekranlarını engelliyor.',
      'Kayıt başına kaynak bilgisi içeren hesap hareketleri uç noktası (Codex) - hareket geçmişini engelliyor.',
      "Oturum servisi ve SSE ipuçları (Codex) - Handshake'i engelliyor.",
      'NEP-413 challenge/verify uç noktaları (Codex) - satıcı kurulumunu engelliyor.',
      'Ödeme makbuzu doğrulayıcısı (fonlama, aktarım ve geri çağrı makbuzları) - Doğrulanmış Ödendi şeridini engelliyor.',
      'Kontratın insan tarafından Testnet incelemesi ve yayınlanması - imzalamayı kapalı tutuyor.',
    ],
    statusMatrix: 'Ödeme durumu matrisi',
    statusMatrixBody: 'Seçilen rol ve güvence için her zincir durumu, uygulamanın göstereceği biçimde.',
    callerRole: 'Çağıran rolü',
    observationSource: 'Gözlem kaynağı',
    assurance: 'Güvence',
    mockPinned: 'Sahte bir gözlem doğrulama iddia edemez; bu yüzden güvence sabitlenir ve hiçbir finansal işlem sunulmaz.',
  },

  payment: {
    contractPaid: {
      label: 'Kontrata göre ödendi',
      payer: 'Kontrat bu ödemeyi alıcıya ödenmiş olarak kaydetti. Ayrıca doğrulanmış bir makbuz henüz yok.',
      recipient: 'Kontrat hesabınıza yapılan aktarımı ödenmiş olarak kaydetti. Ayrıca doğrulanmış bir makbuz henüz yok.',
      announce: 'Kesinleşmiş blokta kontrat durumu ödendi diyor. Ödeme makbuzu henüz bağımsız olarak doğrulanmadı.',
    },
    settlementProofPending:
      'Bu bilgi, kesinleşmiş bir bloktaki kontrat durumundan gelir. Doğrulanmış Ödendi makbuzu için fonlama, aktarım ve geri çağrı (callback) makbuzlarının da kontrol edilmesi gerekir; bu uygulama bunu henüz yapamıyor.',
    setup: {
      notConfigured: {
        title: 'Ödemeler kurulmamış',
        body: 'Bu sürüm için bir Taply ödeme kontratı tanımlı değil; talep okunamaz, oluşturulamaz veya ödenemez.',
      },
      invalidConfig: {
        title: 'Ödeme yapılandırması geçersiz',
        body: 'Kontrat hesabı veya onaylı kod özeti (code hash) eksik ya da hatalı. Tahmin yürütmek yerine ödemeler kapalı kalır.',
      },
      chainUnavailable: {
        title: 'NEAR Testnet kullanılamıyor',
        body: 'Bu sürümün zincir yapılandırması geçersiz; hiçbir şey okunamaz.',
      },
      checking: 'Ödeme kontratı kontrol ediliyor…',
      rejected: {
        title: 'Bu kontrat ödemeler için onaylı değil',
        body: 'Kontrat bu uygulamanın kullanmayacağı bir yapılandırma bildirdi (örneğin test sürümü veya incelenmemiş bir özellik). Ödemeler kapalı kalır.',
      },
      unreachable: {
        title: 'Ödeme kontratı kontrol edilemedi',
        body: 'Kontrat yapılandırması kesinleşmiş bir bloktan okunamadı. Okunana kadar ödemeler kapalı kalır.',
      },
      codeMismatch: {
        title: 'Kontrat kodu eşleşmiyor',
        body: 'Kontrat hesabı onaylı sürümden farklı bir kod çalıştırıyor. Bu kontrattan hiçbir şey gösterilmez veya imzalanmaz.',
      },
      verifiedContract: 'Kontrat kod özeti kesinleşmiş blokta kontrol edildi',
    },
    signing: {
      flagOff: {
        title: 'İşlemler kapalı',
        body: 'Her şeyi inceleyebilirsin; ancak kontrat Testnet incelemesinden geçene kadar imzalama kapalı. Hiçbir şey gönderilmez.',
      },
      unverified: {
        title: 'Kontrat henüz doğrulanmadı',
        body: 'İmzalama, ödeme kontratı kesinleşmiş bir blokta kontrol edilene kadar bekler.',
      },
      noJournal: {
        title: 'Bu tarayıcı güvenlik kaydı tutamıyor',
        body: 'Yerel depolama kullanılamıyor; yarıda kalan bir ödeme takip edilemez. Burada imzalama kapalı.',
      },
      wrongAccount: {
        title: 'Farklı cüzdan hesabı',
        body: 'Cüzdanın incelenen hesaptan farklı bir hesapla bağlı. Hiçbir şey gönderilmedi.',
      },
      rejected: {
        title: 'Cüzdanda reddedildi',
        body: 'Cüzdanında reddettin. Hiçbir şey gönderilmedi.',
      },
      unknown: {
        title: 'Sonuç belirsiz',
        body: 'Sonuç belirsiz. Tekrar ödeme yapmadan önce zincir durumunu kontrol ediyoruz.',
      },
      submitted: {
        title: "NEAR Testnet'e gönderildi",
        body: 'Cüzdanın bir işlem döndürdü. Aşağıdaki durum yalnızca kesinleşmiş blokta okunan kontrattan gelir.',
      },
      blocked: {
        title: 'Önceki bir deneme henüz açıklığa kavuşmadı',
        body: 'Bu tarayıcıdan yapılan önceki bir deneme zincirde henüz sonuçlanmadı. Durumun güncellenmesini bekle.',
      },
      mayReattempt: {
        title: 'Önceki deneme zincirde görünmüyor',
        body: 'Zincir, önceki denemenin hiçbir etkisini göstermiyor. İnceleyip yeniden deneyebilirsin: kontrat yalnızca tek ödeme kabul eder ve NEAR reddedilen yinelenen yatırmayı iade eder.',
      },
      reattempt: 'İncele ve yeniden dene',
      waitingForWallet: 'Cüzdanın bekleniyor…',
      transactionLabel: 'İşlem',
      viewTransaction: 'İşlemi görüntüle',
    },
    create: {
      connectFirst: 'Talep oluşturmak için Testnet cüzdanını bağla. Alıcı sen olacaksın.',
      amountLabel: 'Tutar (NEAR)',
      amountHint: 'Yalnızca Testnet NEAR. En fazla 24 ondalık basamak.',
      memoLabel: 'Not (isteğe bağlı)',
      memoHint: 'Ödeyene gösterilir. En fazla 256 bayt. Zincirde saklanır ve herkese açıktır.',
      payerLabel: 'Yalnızca bu hesap ödeyebilir (isteğe bağlı)',
      payerHint: 'Herkesin ödeyebilmesi için boş bırak.',
      expiryLabel: 'Ödeme süresi',
      expiryHint: 'Son kesinleşmiş bloktan itibaren zincir zamanıyla ölçülür.',
      expiry: { '15m': '15 dakika', '1h': '1 saat', '12h': '12 saat' },
      recipientLabel: 'Alıcı',
      recipientIsYou: 'Sen (bağlı hesap)',
      getQuote: 'Talebi incele',
      quoting: 'Kontrat teklifi alınıyor…',
      quoteTitle: 'İmzalamadan önce kontrol et',
      storageBond: 'Depolama teminatı',
      storageBondNote: 'Bu talebi zincirde kalıcı olarak saklamak için senin ödediğin tutar. Talep iptal edilse bile iade edilmez.',
      gasLabel: 'Gaz payı',
      gasNote: "Önceden ödenen gaz; kullanılmayan kısmı NEAR iade eder. Kesin ücreti cüzdanın gösterir.",
      requestIdLabel: 'Talep kimliği',
      createInWallet: 'Cüzdanda oluştur',
      edit: 'Düzenle',
      errors: {
        amount_required: 'Bir tutar gir.',
        amount_invalid: 'Rakam ve tek ondalık ayırıcı kullan; en fazla 24 ondalık basamak.',
        amount_zero: 'Tutar sıfırdan büyük olmalı.',
        memo_too_long: 'Not 256 bayttan uzun.',
        payer_invalid: 'Bu geçerli bir NEAR hesap kimliği değil.',
        payer_is_recipient: 'Ödeyen sen olamazsın.',
      },
      quoteFailed: {
        title: 'Kontrat bu koşulları kabul etmedi',
        body: 'Teklif kesinleşmiş bir bloktan okunamadı veya kontrat koşulları reddetti. Hiçbir şey imzalanmadı.',
      },
      nonceConsumed: {
        title: 'Bu talep zaten var',
        body: 'Kontratta bu kimlikle bir talep zaten var. Yenisini oluşturmak yerine onu aç.',
      },
      pendingDraft: {
        title: 'Başlattığın bir talep henüz doğrulanmadı',
        body: 'Cüzdanın önceki bir talebi onaylamadı. Aynı koşullarla devam et; bu talep açıklığa kavuşmadan yenisi oluşturulmaz.',
      },
      resumeDraft: 'Bu talebe devam et',
      discardDraft: 'Vazgeç ve baştan başla',
      created: 'Talep zincirde oluşturuldu',
    },
    share: {
      title: 'Bu talebi paylaş',
      body: 'Bağlantıya sahip herkes talebi görebilir. Yalnızca izin verilen ödeyen (belirtilmemişse herkes) ödeyebilir.',
      linkLabel: 'Ödeme bağlantısı',
      copyLink: 'Bağlantıyı kopyala',
      linkCopied: 'Bağlantı kopyalandı',
      share: 'Paylaş',
      qrLabel: 'Ödeme bağlantısının QR kodu',
      qrNote: 'QR kod tam olarak yukarıdaki bağlantıyı içerir. Ödeyenin uygulaması tutarı ve alıcıyı koddan değil, kontrattan okur.',
    },
    review: {
      title: 'Ödemeyi incele',
      intro: 'Bu koşullar kesinleşmiş bir blokta kontrattan okundu. Cüzdanda onaylamadan önce kontrol et.',
      recipient: 'Alıcı',
      amount: 'Tutar',
      exactBaseUnits: 'yoctoNEAR cinsinden kesin tutar',
      memo: 'Not',
      noMemo: 'Not yok',
      permittedPayer: 'Kim ödeyebilir',
      anyPayer: 'Herkes',
      expires: 'Son ödeme zamanı (zincir zamanı)',
      contract: 'Ödeme kontratı',
      attachExactly: 'Cüzdanın tam olarak bu tutarı ekleyecek. Gaz ayrıca ücretlendirilir.',
      gasSeparate: 'Gaz payı (tutardan ayrı)',
      confirmCheck: 'Alıcı hesabını ve tutarı kontrol ettim.',
      approveInWallet: 'Cüzdanda onayla',
      connectToPay: 'Bu talebi ödemek için cüzdanını bağla.',
      notPermittedPayer: {
        title: 'Hesabın bu talebi ödeyemez',
        body: 'Alıcı bu talebi başka bir hesapla sınırladı. Kontrat ödemeni reddeder.',
      },
      payingYourself: {
        title: 'Alıcı sensin',
        body: 'Bu talep kendi hesabına ödeme yapar. Bunun yerine ödeyenle paylaş.',
      },
      balanceLow: {
        title: 'Bakiye yetersiz olabilir',
        body: 'Doğrulanmış bakiyen tutar ve gazın toplamından az. Cüzdanın işlemi reddedebilir.',
      },
      expired: {
        title: 'Bu talebin süresi doldu',
        body: 'Ödeme süresi zincir zamanına göre sona erdi. Artık ödenemez.',
      },
    },
    status: {
      refresh: 'Zincir durumunu kontrol et',
      refreshing: 'Kontrol ediliyor…',
      checkedAt: 'Kontrol: {time}',
      observedBlock: 'Kesinleşmiş blok #{height}',
      autoRefresh: 'Ödeme sürerken otomatik güncellenir.',
      inFlightNote: 'Kontrat aktarımı başlattı. Geri çağrı tamamlanmadıysa bu durumda kalabilir. Tekrar ödeme yapma.',
      unresolved: {
        title: 'Aktarım sonuçlanmadı',
        body: 'Bu aktarım uzun süredir işleniyor. Para kontrat tarafından ayrılmış olarak kalır. Buradan yeniden denenemez veya tekrar ödenemez.',
      },
      failedRecipient: 'Hesabına yapılan aktarım başarısız oldu ve kaydedildi. Tutar kontratta tutuluyor. Aynı aktarımı yeniden deneyebilirsin.',
      failedPayer: 'Alıcıya yapılan aktarım başarısız oldu ve kaydedildi. Tutar kontratta tutuluyor. Yalnızca alıcı yeniden deneyebilir.',
      retryInWallet: 'Aktarımı cüzdanda yeniden dene',
      retryNote: 'Aynı tutarı aynı hesaba gönderir. 1 yoctoNEAR artı gaz tutar.',
      cancelInWallet: 'Talebi cüzdanda iptal et',
      cancelNote: 'Yalnızca ödenmemişken mümkün. 1 yoctoNEAR artı gaz tutar. Depolama teminatı iade edilmez.',
      cancelConfirm: 'Evet, ödenmemiş bu talebi iptal et',
      notFound: {
        title: 'Böyle bir talep yok',
        body: 'Son kesinleşmiş blokta kontratta bu kimlikle bir talep yok.',
      },
      wrongContract: {
        title: 'Talep başka bir kontrata ait',
        body: 'Bu koşullar farklı bir ödeme kontratını gösteriyor. Hiçbir şey gösterilmez veya imzalanmaz.',
      },
      inconsistent: {
        title: 'Tutarsız kontrat yanıtı',
        body: 'Kontratın yanıtı doğrulamadan geçemedi. Hiçbir şey gösterilmez veya imzalanmaz.',
      },
      readFailed: {
        title: 'Talep okunamadı',
        body: 'Durum kesinleşmiş bir bloktan okunamadı. Bu bir ödeme hatası değildir.',
      },
      invalidId: {
        title: 'Talep bağlantısı değil',
        body: 'Bu bağlantı geçerli bir talep kimliği içermiyor.',
      },
      yourAttempts: 'Bu tarayıcıdaki denemelerin',
      fundedAt: 'Fonlandı (zincir zamanı)',
      payerLabel: 'Ödeyen',
      operationLabel: 'Aktarım denemesi',
      attemptResolved: 'Zincir tarafından açıklandı',
    },
    receipt: {
      factsTitle: 'Kontratın kesin kayıtları',
      factsNote: 'Kontrat tarafından kaydedildi ve kesinleşmiş bir blokta okundu. Bağımsız olarak doğrulanmış bir makbuz veya kesinlik kanıtı değildir.',
      notTerminal: {
        title: 'Henüz makbuz yok',
        body: 'Kontrat kesin kayıtları yalnızca talep ödendiğinde veya iptal edildiğinde oluşturur.',
      },
      terminalBlock: 'Kaydedildiği blok',
      terminalAt: 'Kayıt zamanı (zincir zamanı)',
      cancelledNothingPaid: 'Ödemeden önce iptal edildi. Hiçbir şey ödenmedi.',
      payoutConfirmedByContract: 'Ödeme, kontratın geri çağrısıyla onaylandı',
      backToPayment: 'Ödemeye dön',
    },
  },

  screens: {
    home: 'Cüzdan',
    send: 'Gönder',
    receive: 'Al',
    scan: 'Tara',
    requestNew: 'Yeni talep',
    pay: 'Ödeme',
    receipt: 'Makbuz',
    activity: 'Hareketler',
    checkout: 'Satıcı',
    session: 'Canlı oturum',
    merchant: 'Satıcı panosu',
    merchantSetup: 'Satıcı kurulumu',
    merchantRegister: 'Kasa',
    contacts: 'Kişiler',
    split: 'Hesabı böl',
    recurring: 'Tekrarlayan talepler',
    settings: 'Ayarlar',
    demo: 'Demo',
    notFound: 'Sayfa bulunamadı',
    errorBoundary: 'Bir sorun oluştu',
  },
};
