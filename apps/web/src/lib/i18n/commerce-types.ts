import type { JourneyStatus } from '@/lib/merchant/journey';

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
  readonly accountChanged: TitleBody;
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
    readonly pending: TitleBody;
    readonly pendingStale: TitleBody;
    readonly autoRecheck: string;
    readonly ready: TitleBody;
    readonly showQr: string;
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

  readonly journey: JourneyCopy;
  readonly phase7g: Phase7GCopy;
}

/**
 * Phase 7F shared payment journey. Receiver/payer headlines for the stages
 * both phones go through. Only chain-observable facts are stated; customer
 * presence and wallet activity of the OTHER phone exist only in the DEMO.
 */
export interface JourneyCopy {
  readonly eyebrow: {
    readonly pos: string;
    readonly checkout: string;
    readonly request: string;
    readonly receiving: string;
  };
  readonly saleCode: string;
  readonly saleCodeHint: string;
  readonly payTo: string;
  readonly live: string;
  readonly liveNote: string;
  readonly receiver: {
    readonly awaitingSale: TitleBody;
    readonly awaitingRequest: TitleBody;
    readonly transfer: TitleBody;
    readonly contract_paid: TitleBody;
    readonly verified: TitleBody;
  };
  readonly payer: {
    readonly awaitingCheckout: TitleBody;
    readonly awaiting: TitleBody;
    readonly wallet: TitleBody;
    readonly transfer: TitleBody;
    readonly contract_paid: TitleBody;
    readonly verified: TitleBody;
  };
  readonly counterpart: {
    readonly merchantReady: string;
    readonly requesterReady: string;
    readonly noPaymentYet: string;
    readonly paymentSeen: string;
    readonly paidBy: string;
    readonly presenceGated: string;
  };
  /** Short visible labels for the five-step timeline. */
  readonly steps: {
    readonly created: string;
    readonly approved: string;
    readonly transfer: string;
    readonly contract: string;
    readonly verified: string;
  };
  readonly proofLegend: {
    readonly contract: string;
    readonly verified: string;
    readonly verifiedPending: string;
  };
  readonly newSale: string;
  readonly merchantHome: string;
  readonly demo: {
    readonly customerJoined: string;
    readonly waitingCustomer: string;
    readonly waitingWallet: string;
    readonly merchantReady: string;
    readonly reviewing: string;
    readonly yourWallet: string;
  };
}

/**
 * Phase 7G: canonical status labels, the merchant's Verified Paid path and the
 * gated Handshake room states. Statuses are evidence-derived (see
 * lib/merchant/journey.ts journeyStatus); none of this copy may imply customer
 * presence, merchant identity or payment from a session event.
 */
export interface Phase7GCopy {
  readonly status: Readonly<Record<JourneyStatus, string>>;
  readonly statusLabel: string;
  readonly proofNext: {
    readonly title: string;
    readonly pending: string;
    readonly receiverAction: string;
    readonly payerAction: string;
    readonly receiverNote: string;
  };
  readonly locate: {
    readonly stepFind: string;
    readonly stepCheck: string;
    readonly searching: TitleBody;
    readonly checking: string;
    readonly foundNote: string;
    readonly notFound: TitleBody;
    readonly history: TitleBody;
    readonly unavailable: TitleBody;
    readonly retryNeeded: TitleBody;
    readonly searchAgain: string;
  };
  readonly merchantHome: {
    readonly comingLaterTitle: string;
    readonly comingLaterBody: string;
    readonly unboundShort: string;
  };
  readonly checkoutNote: string;
  readonly room: RoomCopy;
}

/** Phase 7G gated Handshake room states (lib/handshake/room.ts). DEMO-previewed only. */
export interface RoomCopy {
  readonly previewTitle: string;
  readonly previewIntro: string;
  readonly scenario: string;
  readonly scenarios: Readonly<Record<string, string>>;
  readonly merchantPhone: string;
  readonly customerPhone: string;
  readonly phase: Readonly<Record<'not_bound' | 'waiting_for_customer' | 'customer_joined' | 'reviewing' | 'waiting_for_wallet' | 'pending_chain' | 'outcome_unknown' | 'mismatch' | 'expired' | 'closed', TitleBody>>;
  readonly connection: Readonly<Record<'connected' | 'interrupted' | 'reconnected' | 'not_joined', string>>;
  readonly code: { readonly label: string; readonly match: string; readonly mismatch: string; readonly pending: string };
  readonly reviews: { readonly merchant: string; readonly payer: string; readonly done: string; readonly notYet: string };
  readonly wallet: { readonly label: string; readonly note: string; readonly awaiting_wallet: string; readonly submitted: string; readonly outcome_unknown: string; readonly rejected: string };
  readonly chain: { readonly label: string; readonly not_read: string; readonly open: string; readonly in_flight: string; readonly paid_per_contract: string; readonly verified_paid: string; readonly needs_attention: string; readonly closed: string };
  readonly merchantIdentity: string;
  readonly authority: string;
  readonly unavailable: Readonly<Record<'flag_off' | 'backend_not_connected' | 'unsupported_version' | 'refused' | 'session_not_found' | 'verification_unavailable', TitleBody>>;
}
