/**
 * Copy for the merchant POS, customer checkout and Handshake screens (Phase 7).
 * Kept in its own interface so the main dictionary only gains one key.
 * Both locales must implement it in full (a missing key is a type error).
 */

export interface TitleBody {
  readonly title: string;
  readonly body: string;
}

export interface CommerceCopy {
  /** Short, always-visible statement of what a sale request is today. */
  readonly instantOnlyBadge: string;
  readonly unbound: TitleBody;
  readonly comingLater: string;
  readonly needsBackend: string;

  readonly merchant: {
    readonly title: string;
    readonly subtitle: string;
    readonly connectFirst: string;
    readonly menuBody: string;
    readonly receivingAccount: string;
    readonly receivingNote: string;
    readonly newSale: TitleBody;
    readonly discovery: TitleBody;
    readonly handshake: TitleBody;
    readonly profile: TitleBody;
    readonly salesTitle: string;
    readonly salesNote: string;
    readonly salesEmpty: TitleBody;
    readonly openStatus: string;
    readonly createdAt: string;
    readonly noReference: string;
    readonly storageUnavailable: string;
  };

  readonly sale: {
    readonly title: string;
    readonly subtitle: string;
    readonly back: string;
    readonly stepsLabel: string;
    readonly stepAmount: string;
    readonly stepReview: string;
    readonly stepQr: string;
    readonly referenceLabel: string;
    readonly referenceHint: string;
    readonly receivingLabel: string;
    readonly uniqueNote: string;
  };

  readonly discovery: {
    readonly title: string;
    readonly subtitle: string;
    readonly qrLabel: string;
    readonly onlyDiscovery: TitleBody;
    readonly linkLabel: string;
    readonly copy: string;
    readonly copied: string;
    readonly share: string;
    readonly unavailable: TitleBody;
    readonly accountLine: string;
    readonly profilePending: TitleBody;
    readonly preview: string;
  };

  readonly checkout: {
    readonly title: string;
    readonly eyebrow: string;
    readonly merchantAccount: string;
    readonly unverifiedName: string;
    readonly discoveryState: TitleBody;
    readonly noActiveSale: TitleBody;
    readonly howTitle: string;
    readonly step1: string;
    readonly step2: string;
    readonly step3: string;
    readonly authenticity: TitleBody;
    readonly invalidAccount: TitleBody;
    readonly notTestnet: TitleBody;
    readonly scanSale: string;
    readonly pasteSale: string;
    readonly ownPage: TitleBody;
    readonly openPos: string;
    readonly nothingSigned: string;
  };

  readonly scan: {
    readonly merchantFound: string;
    readonly invalidMerchant: string;
    readonly notTestnetMerchant: string;
  };

  readonly handshake: {
    readonly title: string;
    readonly unavailable: TitleBody;
    readonly invalidSession: TitleBody;
    readonly sessionLabel: string;
    readonly merchantSide: string;
    readonly customerSide: string;
    readonly createSession: string;
    readonly waiting: string;
    readonly customerJoined: string;
    readonly customerDisconnected: string;
    readonly merchantPresent: string;
    readonly merchantDisconnected: string;
    readonly reviewedByCustomer: string;
    readonly expired: TitleBody;
    readonly closed: TitleBody;
    readonly compareTitle: string;
    readonly compareHint: string;
    readonly codeUnavailable: string;
    readonly mismatch: TitleBody;
    readonly termsTitle: string;
    readonly termsImmutable: string;
    readonly reviewConfirm: string;
    readonly reviewNote: string;
    readonly markReviewed: string;
    readonly reviewed: string;
    readonly readyToPay: string;
    readonly payDirectly: string;
    readonly identityNote: string;
    readonly pendingTitle: string;
    readonly pendingApis: string;
  };

  readonly demo: {
    readonly badge: string;
    readonly title: string;
    readonly intro: string;
    readonly synthetic: string;
    readonly stepLabel: string;
    readonly next: string;
    readonly back: string;
    readonly restart: string;
    readonly steps: {
      readonly create: TitleBody;
      readonly join: TitleBody;
      readonly compare: TitleBody;
      readonly review: TitleBody;
      readonly wallet: TitleBody;
    };
    readonly endNote: string;
    readonly walletPlaceholder: string;
    readonly simulateMismatch: string;
    readonly undoMismatch: string;
    readonly openDemo: string;
  };
}
