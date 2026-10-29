import type { Dictionary } from '../types';

/**
 * Turkish (secondary locale).
 *
 * Strings marked NORMATIVE are quoted verbatim from docs/UX_FLOWS.md
 * "Real-time copy rules" and must not be paraphrased away.
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
    REVIEWED: { label: 'Koşullar incelendi', description: 'Koşullar incelendi. Bu bir ödeme yetkisi değildir.' },
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
    WRONG_NETWORK: {
      title: 'Yanlış ağ',
      body: "Taply yalnızca NEAR Testnet üzerinde çalışır. Cüzdanını Testnet'e al ve tekrar dene.",
    },
    INVALID_ACCOUNT: { title: 'Geçersiz hesap', body: 'Bu NEAR hesap kimliği geçerli değil.' },
    INVALID_ASSET: { title: 'Desteklenmeyen varlık', body: 'Bu sürümde yalnızca native Testnet NEAR destekleniyor.' },
    INVALID_AMOUNT: { title: 'Geçersiz tutar', body: 'Taban birimde tam ve pozitif bir tutar gir.' },
    INSUFFICIENT_BALANCE: { title: 'Bakiye yetersiz', body: 'Bu hesapta yeterli Testnet NEAR yok.' },
    INSUFFICIENT_GAS: { title: 'Gas yetersiz', body: 'İşlem ücretleri için biraz daha Testnet NEAR ekle.' },
    AUTH_REQUIRED: { title: 'Giriş gerekli', body: 'Devam etmek için kimlik doğrula.' },
    WALLET_NOT_READY: { title: 'Cüzdan hazır değil', body: 'Devam etmek için bir NEAR Testnet cüzdanı bağla.' },
    SOCIAL_LOGIN_NOT_TESTNET_CAPABLE: {
      title: 'Testnet için kullanılamıyor',
      // NORMATIVE
      body: 'Bu giriş yöntemi Testnet cüzdanı için henüz kullanılamıyor. Desteklenen cüzdanla devam et.',
    },
    USER_REJECTED: { title: 'İmza reddedildi', body: 'İmzayı reddettin. Hiçbir şey gönderilmedi.' },
    REQUEST_EXPIRED: { title: 'Talep süresi doldu', body: 'Bu talep artık fonlanamaz. Yeni bir talep iste.' },
    REQUEST_ALREADY_FUNDED: { title: 'Zaten fonlandı', body: 'Bu talep bir kez fonlandı.' },
    REQUEST_ALREADY_SETTLED: { title: 'Zaten sonuçlandı', body: 'Bu talep zaten nihai bir duruma ulaştı.' },
    WINDOW_STILL_OPEN: { title: 'Aktarım için erken', body: 'İptal süresi zincirde henüz kapanmadı.' },
    CANCEL_WINDOW_CLOSED: {
      title: 'İptal süresi kapandı',
      body: 'Bu çağrı işlemeden önce zincir iptal süresini kapattı. İptal artık mümkün değil.',
    },
    REFUND_IN_FLIGHT: { title: 'İade sürüyor', body: 'Zincirde zaten bir iade işleniyor.' },
    PAYOUT_IN_FLIGHT: { title: 'Ödeme sürüyor', body: 'Zincirde zaten bir aktarım işleniyor.' },
    REFUND_FAILED: { title: 'İade başarısız', body: 'İade tamamlanmadı. Para durumu zincirde korunuyor.' },
    PAYOUT_FAILED: { title: 'Aktarım başarısız', body: 'Aktarım tamamlanmadı. Para durumu zincirde korunuyor.' },
    UNVERIFIED_MERCHANT: {
      title: 'Satıcı doğrulanmadı',
      body: 'Bu satıcı alıcı hesabın kontrolünü kanıtlamadı. Güvenmiyorsan ödeme yapma.',
    },
    SESSION_EXPIRED: {
      title: 'Oturum sona erdi',
      // NORMATIVE
      body: 'Canlı oturum sona erdi; yeni oturum oluştur.',
    },
    SESSION_MISMATCH: {
      title: 'Koşullar uyuşmuyor',
      body: 'İki cihaz aynı koşulları göstermiyor. Ödeme yapma. Yeni bir oturum başlat.',
    },
    NETWORK_UNAVAILABLE: { title: 'Bağlantı yok', body: 'Bağlantını kontrol et. Hiçbir ödeme etkilenmedi.' },
    RPC_TIMEOUT_UNKNOWN_STATUS: {
      title: 'Sonuç belirsiz',
      // NORMATIVE
      body: 'Sonuç belirsiz. Tekrar ödeme yapmadan önce zincir durumunu kontrol ediyoruz.',
    },
    RATE_LIMITED: { title: 'Çok fazla istek', body: 'Biraz bekle ve tekrar dene.' },
    RECEIPT_NOT_FINAL: {
      title: 'Makbuz nihai değil',
      body: 'Ödeme nihai duruma ulaşmadığı için henüz doğrulanmış bir makbuz yok.',
    },
    TERMS_CHANGED: {
      title: 'Koşullar değişti',
      body: 'Sen incelerken ödeme koşulları değişti. Onay vermeden önce yeni koşulları incele.',
    },
    MERCHANT_NOT_FOUND: { title: 'Satıcı bulunamadı', body: 'Bu hesap için satıcı profili yok.' },
    MERCHANT_ACCOUNT_MISMATCH: {
      title: 'Satıcı hesabı uyuşmuyor',
      body: 'Alıcı hesap satıcı profiliyle uyuşmuyor. Ödeme yapma.',
    },
    RETRY_NOT_AUTHORIZED: {
      title: 'Yeniden deneme yetkisi yok',
      body: 'Bu işlemi yalnızca yetkili taraf yeniden deneyebilir.',
    },
    CLOCK_UNAVAILABLE: {
      title: 'Zincir saati okunamıyor',
      body: 'Zincir saatini okuyamıyoruz; gösterilecek geri sayım güvenilir olmaz.',
    },
    UNKNOWN_ERROR: {
      title: 'Bir sorun oluştu',
      body: 'Bunu tamamlayamadık. Bu uygulama hiçbir ödeme durumunu değiştirmedi.',
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
