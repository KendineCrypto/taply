import type { CommerceCopy } from './commerce-types';
import type { ToolsCopy } from './tools-types';
import type { Assurance, ChainState, ErrorCode, LocalPhase, SessionState } from '@/lib/protocol';

export const LOCALES = ['en', 'tr'] as const;
export type Locale = (typeof LOCALES)[number];

/** Freeze section 9: default English, secondary Turkish. */
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as ReadonlyArray<string>).includes(value);
}

/**
 * Status copy is role-split because LOCKED (and every in-flight state) must read
 * differently to the person who paid and the person who has NOT been paid yet.
 */
export interface StatusCopy {
  /** Short badge label. Must never say "paid" unless the state truly is paid. */
  readonly label: string;
  /** What this means for the payer. */
  readonly payer: string;
  /** What this means for the recipient/merchant. */
  readonly recipient: string;
  /** Screen-reader announcement; includes the money position explicitly. */
  readonly announce: string;
}

export interface PhaseCopy {
  readonly label: string;
  readonly description: string;
}

export interface ErrorCopy {
  readonly title: string;
  readonly body: string;
}

/**
 * Every locale must implement this interface in full, so a missing or renamed
 * key is a TYPE ERROR rather than a runtime fallback to English.
 *
 * Phase 0.5: `status`, `localPhase`, `sessionState`, `assurance` and `errors` are
 * Records keyed by `@taply/shared` unions. If Codex adds a ChainState or an
 * ErrorCode, both dictionaries stop compiling until they are translated. That is
 * the intended failure mode.
 */
export interface Dictionary {
  readonly locale: Locale;
  /** Phase 7 merchant POS, checkout and Handshake copy. */
  readonly commerce: CommerceCopy;
  /** Monday sprint: Contacts, recurring templates, Split Pay. */
  readonly tools: ToolsCopy;
  readonly localeName: string;

  readonly app: {
    readonly name: string;
    readonly networkBadge: string;
    readonly demoFundsNote: string;
    readonly skipToContent: string;
    readonly languageLabel: string;
  };

  readonly nav: {
    readonly home: string;
    readonly pay: string;
    readonly scan: string;
    readonly activity: string;
    readonly settings: string;
    readonly primaryLabel: string;
  };

  readonly common: {
    readonly amount: string;
    readonly recipient: string;
    readonly payer: string;
    readonly network: string;
    readonly mode: string;
    readonly copy: string;
    readonly copied: string;
    readonly back: string;
    readonly retry: string;
    readonly close: string;
    readonly viewReceipt: string;
    readonly viewOnExplorer: string;
    readonly checkChainStatus: string;
    readonly loading: string;
    readonly notAvailable: string;
    readonly exactBaseUnits: string;
    readonly approximate: string;
  };

  readonly mode: {
    readonly instant: string;
    readonly protected: string;
  };

  readonly status: Readonly<Record<ChainState, StatusCopy>>;
  readonly localPhase: Readonly<Record<LocalPhase, PhaseCopy>>;
  readonly sessionState: Readonly<Record<SessionState, PhaseCopy>>;
  readonly assurance: Readonly<Record<Assurance, PhaseCopy>>;

  /** Keyed by the shared `ErrorCode` union — all 56 members, both locales. */
  readonly errors: Readonly<Record<ErrorCode, ErrorCopy>>;

  /**
   * Frontend-only conditions that are NOT protocol errors: browser state, a
   * disabled capability, or an unexpected client failure. Keeping them out of
   * `errors` stops the UI from inventing API error codes that do not exist.
   */
  readonly notices: {
    readonly offline: ErrorCopy;
    readonly unexpected: ErrorCopy;
    readonly socialLoginUnavailable: ErrorCopy;
    readonly chainTimeUnavailable: ErrorCopy;
    readonly incidentOpen: ErrorCopy;
    readonly projectionContradiction: ErrorCopy;
  };

  readonly protectedPay: {
    /**
     * Freeze section 9 pre-funding copy. The English string is quoted verbatim
     * from the freeze and supersedes older specs demanding a precise timestamp.
     */
    readonly preFundingConsent: string;
    readonly postFundingCutoffLabel: string;
    readonly countdownApproximate: string;
    readonly cutoffPassed: string;
    readonly whoCanCancel: string;
    readonly whoCanRelease: string;
    readonly merchantCannot: string;
    readonly lockedNotPaid: string;
  };

  readonly handshake: {
    readonly comparisonCodeLabel: string;
    readonly comparisonCodeCaption: string;
    readonly comparisonMismatch: string;
    readonly notIdentityProof: string;
    readonly offlineDegraded: string;
  };

  readonly checkout: {
    readonly permanentQrIsDiscovery: string;
    readonly merchantMustSign: string;
    readonly accountControlOnly: string;
  };

  readonly flags: {
    readonly disabledTitle: string;
    readonly disabledBody: string;
    readonly comingLater: string;
    readonly requiresVerification: string;
  };

  readonly mock: {
    readonly badge: string;
    readonly demoOnly: string;
    readonly blockedOutsideDemo: string;
  };

  /** Wallet connection. `{wallet}` / `{account}` are filled by `fill()`. */
  readonly wallet: {
    readonly connect: string;
    readonly connecting: string;
    readonly restoring: string;
    readonly disconnect: string;
    readonly connectedWith: string;
    readonly accountLabel: string;
    readonly walletLabel: string;
    readonly connectTitle: string;
    readonly connectBody: string;
    readonly noKeysNote: string;
    readonly reportedNotProven: string;
    readonly disabled: ErrorCopy;
    readonly likelyMainnet: ErrorCopy;
    readonly copyAccount: string;
    readonly accountCopied: string;
    readonly copyFailed: string;
    readonly accountMenuLabel: string;
    readonly errors: Readonly<Record<'cancelled' | 'unavailable' | 'no_account' | 'failed', ErrorCopy>>;
  };

  /** Native balance card. `{height}` / `{time}` are filled by `fill()`. */
  readonly balance: {
    readonly title: string;
    readonly refresh: string;
    readonly refreshing: string;
    readonly verifiedAt: string;
    readonly finalBlock: string;
    readonly staleAt: string;
    readonly storageNote: string;
    readonly lockedLabel: string;
    readonly notShown: string;
    readonly loading: string;
    readonly notFound: ErrorCopy;
    readonly networkMismatch: ErrorCopy;
    readonly unverified: ErrorCopy;
    readonly readFailed: ErrorCopy;
    readonly rateLimited: ErrorCopy;
    readonly configInvalid: ErrorCopy;
  };

  readonly home: {
    readonly quickActionsLabel: string;
    readonly send: string;
    readonly receive: string;
    readonly request: string;
    readonly soon: string;
    readonly recentActivity: string;
    readonly activityEmptyTitle: string;
    readonly activityEmptyBody: string;
    readonly activityConnectBody: string;
    readonly viewOnExplorer: string;
  };

  /** User-facing summaries of every route, so no screen hardcodes English. */
  readonly routes: {
    readonly payHub: {
      readonly description: string;
      readonly scanBody: string;
      readonly requestBody: string;
      readonly sendBody: string;
      readonly swipeNote: string;
    };
    readonly comingSoon: string;
    readonly afterVerification: string;
    readonly send: string;
    readonly receive: string;
    readonly scan: string;
    readonly requestNew: string;
    readonly activity: string;
    readonly contacts: string;
    readonly split: string;
    readonly recurring: string;
    readonly merchant: string;
    readonly merchantSetup: string;
    readonly merchantRegister: string;
    readonly checkout: string;
    readonly session: string;
    readonly payIntent: string;
    readonly receipt: string;
    readonly requestIdLabel: string;
    readonly sessionIdLabel: string;
    readonly stateLabel: string;
    readonly merchantAccountLabel: string;
  };

  readonly receive: {
    readonly yourAccount: string;
    readonly testnetOnlyWarning: string;
    readonly qrLater: string;
    readonly connectFirst: string;
  };

  readonly settings: {
    readonly walletSection: string;
    readonly languageSection: string;
    readonly networkSection: string;
    readonly contractLabel: string;
    readonly contractNotDeployed: string;
    readonly rpcLabel: string;
    readonly diagnosticsLink: string;
    readonly diagnosticsBody: string;
    readonly notConnected: string;
  };

  readonly system: {
    readonly reloadOnlyNote: string;
    readonly notFoundBody: string;
    readonly goHome: string;
    readonly backOnline: string;
  };

  /** /demo only: technical diagnostics for reviewers and judges. */
  readonly diagnostics: {
    readonly title: string;
    readonly description: string;
    readonly chainConfig: string;
    readonly chainConfigInvalid: string;
    readonly checkNetwork: string;
    readonly checking: string;
    readonly networkOk: string;
    readonly capabilities: string;
    readonly capabilitiesBody: string;
    readonly enabled: string;
    readonly locked: string;
    readonly dependencies: string;
    readonly dependencyItems: ReadonlyArray<string>;
    readonly statusMatrix: string;
    readonly statusMatrixBody: string;
    readonly callerRole: string;
    readonly observationSource: string;
    readonly assurance: string;
    readonly mockPinned: string;
  };

  /** Phase 2C: real Instant Pay against the configured contract. */
  readonly payment: {
    /** FINAL_PAID from a final contract read, without an independently verified receipt. */
    readonly contractPaid: StatusCopy;
    readonly settlementProofPending: string;
    /** Same fact, worded for the receipt screen itself (no "open the receipt" instruction). */
    readonly settlementProofPendingOnReceipt: string;
    readonly setup: {
      readonly notConfigured: ErrorCopy;
      readonly invalidConfig: ErrorCopy;
      readonly chainUnavailable: ErrorCopy;
      readonly checking: string;
      readonly rejected: ErrorCopy;
      readonly unreachable: ErrorCopy;
      /** The RPC answered HTTP 429. Not a payment result. */
      readonly rateLimited: ErrorCopy;
      readonly codeMismatch: ErrorCopy;
      readonly verifiedContract: string;
    };
    readonly signing: {
      readonly flagOff: ErrorCopy;
      readonly unverified: ErrorCopy;
      readonly noJournal: ErrorCopy;
      readonly wrongAccount: ErrorCopy;
      readonly rejected: ErrorCopy;
      readonly unknown: ErrorCopy;
      readonly submitted: ErrorCopy;
      readonly blocked: ErrorCopy;
      readonly mayReattempt: ErrorCopy;
      readonly reattempt: string;
      readonly waitingForWallet: string;
      readonly transactionLabel: string;
      readonly viewTransaction: string;
    };
    readonly create: {
      readonly connectFirst: string;
      readonly amountLabel: string;
      readonly amountHint: string;
      readonly memoLabel: string;
      readonly memoHint: string;
      readonly payerLabel: string;
      readonly payerHint: string;
      readonly expiryLabel: string;
      readonly expiryHint: string;
      readonly expiry: Readonly<Record<'15m' | '1h' | '12h', string>>;
      readonly recipientLabel: string;
      readonly recipientIsYou: string;
      readonly getQuote: string;
      readonly quoting: string;
      readonly storageBond: string;
      readonly storageBondNote: string;
      readonly gasLabel: string;
      readonly gasNote: string;
      readonly requestIdLabel: string;
      readonly createInWallet: string;
      readonly edit: string;
      readonly errors: Readonly<
        Record<
          'amount_required' | 'amount_invalid' | 'amount_zero' | 'memo_too_long' | 'payer_invalid' | 'payer_is_recipient',
          string
        >
      >;
      readonly quoteFailed: ErrorCopy;
      readonly nonceConsumed: ErrorCopy;
      readonly pendingDraft: ErrorCopy;
      readonly resumeDraft: string;
      readonly discardDraft: string;
      readonly created: string;
    };
    readonly share: {
      readonly title: string;
      readonly body: string;
      readonly linkLabel: string;
      readonly copyLink: string;
      readonly linkCopied: string;
      readonly share: string;
      readonly qrLabel: string;
      readonly qrNote: string;
    };
    readonly review: {
      readonly title: string;
      readonly intro: string;
      readonly recipient: string;
      readonly amount: string;
      readonly exactBaseUnits: string;
      readonly memo: string;
      readonly noMemo: string;
      readonly permittedPayer: string;
      readonly anyPayer: string;
      readonly expires: string;
      readonly contract: string;
      readonly attachExactly: string;
      readonly gasSeparate: string;
      readonly confirmCheck: string;
      readonly approveInWallet: string;
      readonly connectToPay: string;
      readonly notPermittedPayer: ErrorCopy;
      readonly payingYourself: ErrorCopy;
      readonly balanceLow: ErrorCopy;
      readonly expired: ErrorCopy;
    };
    readonly status: {
      readonly refresh: string;
      readonly refreshing: string;
      readonly checkedAt: string;
      readonly observedBlock: string;
      readonly autoRefresh: string;
      readonly inFlightNote: string;
      readonly unresolved: ErrorCopy;
      readonly failedRecipient: string;
      readonly failedPayer: string;
      readonly retryInWallet: string;
      readonly retryNote: string;
      readonly cancelInWallet: string;
      readonly cancelNote: string;
      readonly cancelConfirm: string;
      readonly notFound: ErrorCopy;
      readonly wrongContract: ErrorCopy;
      readonly inconsistent: ErrorCopy;
      readonly readFailed: ErrorCopy;
      readonly invalidId: ErrorCopy;
      readonly yourAttempts: string;
      readonly fundedAt: string;
      readonly payerLabel: string;
      readonly operationLabel: string;
      readonly attemptResolved: string;
      readonly operationStatus: Readonly<Record<'IN_FLIGHT' | 'FAILED' | 'SUCCEEDED', string>>;
    };
    readonly receipt: {
      readonly factsTitle: string;
      readonly factsNote: string;
      readonly notTerminal: ErrorCopy;
      readonly terminalBlock: string;
      readonly terminalAt: string;
      readonly cancelledNothingPaid: string;
      readonly payoutConfirmedByContract: string;
      readonly backToPayment: string;
    };
    /** Phase 2D: independent receipt verification (lib/verify). */
    readonly verification: {
      readonly checking: string;
      readonly verifiedNote: string;
      readonly unavailable: ErrorCopy;
      readonly missingReference: ErrorCopy;
      readonly failedTransient: ErrorCopy;
      readonly historyUnavailable: ErrorCopy;
      readonly failedMismatch: ErrorCopy;
      readonly reasonCode: string;
      /** The RPC answered HTTP 429 during verification. */
      readonly rateLimited: ErrorCopy;
      /** `{time}`: local time when checking again is allowed. */
      readonly rateLimitedUntil: string;
      /** `{time}`: local time of the next automatic check. */
      readonly autoRetryAt: string;
      /** A saved earlier verifier output, never a live check. */
      readonly archived: {
        readonly badge: string;
        readonly title: string;
        /** `{date}`, `{provider}` are filled. */
        readonly body: string;
        readonly whenUnreadable: string;
        readonly checkedAt: string;
        readonly provider: string;
        readonly stateBlock: string;
        readonly openJson: string;
      };
      readonly checkAgain: string;
      readonly copyLink: string;
      readonly linkCopied: string;
      readonly linkNote: string;
      readonly copyEvidence: string;
      readonly evidenceCopied: string;
      readonly fundingTx: string;
      readonly settlementTx: string;
      readonly transferReceipt: string;
      readonly callbackReceipt: string;
      readonly stateBlock: string;
      readonly provider: string;
    };
  };

  /** Phase 3B: shared experience components and the /demo product tour. */
  readonly experience: {
    readonly paymentRequest: string;
    readonly requesting: string;
    readonly youArePaying: string;
    readonly to: string;
    readonly from: string;
    readonly scanToPay: string;
    readonly validUntil: string;
    readonly testFunds: string;
    readonly instantPay: string;
    readonly yourAccount: string;
    readonly progress: {
      readonly title: string;
      readonly stages: Readonly<
        Record<
          'awaiting' | 'wallet' | 'transfer' | 'contract_paid' | 'verified' | 'failed' | 'unresolved' | 'cancelled',
          ErrorCopy
        >
      >;
      readonly steps: Readonly<Record<'created' | 'approved' | 'transfer' | 'contract' | 'verified', string>>;
      readonly stepState: Readonly<Record<'done' | 'current' | 'todo' | 'failed', string>>;
      readonly observedNote: string;
      readonly openReceipt: string;
      readonly contractStatus: string;
    };
    readonly receipt: {
      readonly verified: string;
      readonly verifiedSub: string;
      readonly contractPaid: string;
      readonly contractPaidSub: string;
      readonly cancelled: string;
      readonly cancelledSub: string;
      readonly paidTo: string;
      readonly paidBy: string;
      readonly settledAt: string;
      readonly memo: string;
      readonly references: string;
      readonly checkedBy: string;
    };
    readonly review: {
      readonly networkFee: string;
      readonly networkFeeValue: string;
      readonly walletAction: string;
      readonly walletActionValue: string;
      readonly contract: string;
    };
    readonly create: {
      readonly amountPlaceholder: string;
      readonly options: string;
    };
    readonly home: {
      readonly tourEyebrow: string;
      readonly tourTitle: string;
      readonly tourBody: string;
      readonly tourCta: string;
      readonly scan: string;
    };
    readonly demo: {
      readonly badge: string;
      readonly title: string;
      readonly intro: string;
      readonly synthetic: string;
      readonly stepOf: string;
      readonly progressLabel: string;
      readonly steps: Readonly<
        Record<'home' | 'create' | 'share' | 'review' | 'progress' | 'receipt', { readonly title: string; readonly caption: string }>
      >;
      readonly next: string;
      readonly back: string;
      readonly restart: string;
      readonly approveDemo: string;
      readonly createDemo: string;
      readonly approveNote: string;
      readonly play: string;
      readonly pause: string;
      readonly showState: string;
      readonly explorerNote: string;
      readonly evidenceNote: string;
      readonly balanceLabel: string;
      readonly reviewerTitle: string;
      readonly reviewerBody: string;
      readonly reviewerShow: string;
      readonly reviewerHide: string;
      readonly openOnPhone: string;
    };
  };

  /** Phase 4B: wallet home, onboarding, send and receive. */
  readonly walletUx: {
    readonly kind: {
      readonly external: string;
      readonly externalVia: string;
      readonly externalKeys: string;
      readonly native: string;
      readonly nativeKeys: string;
    };
    readonly onboarding: {
      readonly eyebrow: string;
      readonly title: string;
      readonly subtitle: string;
      readonly connect: ErrorCopy;
      readonly create: ErrorCopy;
      readonly restore: ErrorCopy;
      readonly unlock: ErrorCopy;
      readonly works: string;
      readonly notYet: string;
      readonly notYetBody: string;
      readonly tour: string;
      readonly connectInstead: string;
      readonly lockedTitle: string;
      readonly lockedBody: string;
      readonly openWallet: string;
    };
    readonly home: {
      readonly totalBalance: string;
      readonly manage: string;
      readonly activityTitle: string;
      readonly activityScope: string;
      readonly activityEmptyTitle: string;
      readonly activityEmptyBody: string;
      readonly explorer: string;
    };
    readonly activity: {
      readonly method: Readonly<Record<'create_request' | 'pay_instant_native' | 'retry_native_transfer' | 'cancel_unfunded', string>>;
      readonly phase: Readonly<Record<'AWAITING_SIGNATURE' | 'USER_REJECTED' | 'OUTCOME_UNKNOWN' | 'SUBMITTED' | 'RESOLVED', string>>;
      readonly open: string;
    };
    readonly send: {
      readonly subtitle: string;
      readonly preview: ErrorCopy;
      readonly recipientLabel: string;
      readonly recipientPlaceholder: string;
      readonly recipientHint: string;
      readonly recipientChecking: string;
      readonly recipientFound: string;
      readonly recipientMissing: string;
      readonly recipientMainnet: string;
      readonly recipientInvalid: string;
      readonly recipientSelf: string;
      readonly recipientUnchecked: string;
      readonly amountLabel: string;
      readonly available: string;
      readonly availableUnknown: string;
      readonly insufficient: string;
      readonly amountInvalid: string;
      readonly review: string;
      readonly edit: string;
      readonly reviewTitle: string;
      readonly youSend: string;
      readonly walletAction: string;
      readonly walletActionValue: string;
      readonly feeValue: string;
      readonly confirm: string;
      readonly confirmUnavailable: string;
      readonly connectFirst: string;
      readonly status: Readonly<Record<'pending' | 'success' | 'failed' | 'unknown', ErrorCopy>>;
      readonly sendAnother: string;
    };
    readonly receive: {
      readonly subtitle: string;
      readonly ticketTitle: string;
      readonly copy: string;
      readonly copied: string;
      readonly share: string;
      readonly networkWarning: ErrorCopy;
      readonly qrNote: string;
      readonly requestInstead: string;
    };
    readonly demo: {
      readonly receive: { readonly title: string; readonly caption: string };
      readonly send: { readonly title: string; readonly caption: string };
      readonly confirmDemo: string;
      readonly conceptNote: string;
      readonly showResult: string;
    };
  };

  /** Phase 4D: native Taply Wallet (encrypted local vault, signing disabled). */
  readonly walletNative: {
    readonly switchLabel: string;
    readonly external: string;
    readonly taply: string;
    readonly switchNote: string;
    readonly unavailable: ErrorCopy;
    readonly intro: ErrorCopy;
    readonly point1: string;
    readonly point2: string;
    readonly point3: string;
    readonly create: string;
    readonly restore: string;
    readonly identityLabel: string;
    readonly status: {
      readonly checking: string;
      readonly localOnly: ErrorCopy;
      readonly provisioned: ErrorCopy;
      readonly unknown: ErrorCopy;
    };
    readonly lock: {
      readonly locked: string;
      readonly unlocked: string;
      readonly unlockTitle: string;
      readonly unlock: string;
      readonly unlocking: string;
      readonly lockNow: string;
      readonly passphrase: string;
      readonly autoLock: string;
    };
    readonly backup: {
      readonly title: string;
      readonly body: string;
      readonly fileWarning: string;
      readonly download: string;
      readonly downloaded: string;
      readonly confirm: string;
      readonly finish: string;
      readonly required: string;
    };
    readonly createFlow: {
      readonly title: string;
      readonly stepOf: string;
      readonly understandTitle: string;
      readonly ack1: string;
      readonly ack2: string;
      readonly ack3: string;
      readonly continue: string;
      readonly back: string;
      readonly passTitle: string;
      readonly passLabel: string;
      readonly passHint: string;
      readonly confirmLabel: string;
      readonly show: string;
      readonly hide: string;
      readonly mismatch: string;
      readonly tooShort: string;
      readonly tooLong: string;
      readonly strengthLabel: string;
      readonly strength: Readonly<Record<'weak' | 'fair' | 'strong' | 'excellent', string>>;
      readonly creating: string;
      readonly createButton: string;
      readonly createdTitle: string;
      readonly createdBody: string;
    };
    readonly restoreFlow: {
      readonly title: string;
      readonly body: string;
      readonly file: string;
      readonly paste: string;
      readonly restoring: string;
      readonly restoreButton: string;
      readonly restored: string;
    };
    readonly errors: Readonly<Record<'BAD_PASSWORD_OR_DATA' | 'PASSWORD_POLICY' | 'ALREADY_EXISTS' | 'INVALID_RECORD' | 'STORAGE_UNAVAILABLE' | 'CRYPTO_UNAVAILABLE' | 'CANCELLED' | 'LOCKED' | 'ACCOUNT_NOT_PROVISIONED' | 'INVALID_ADDRESS' | 'INVALID_AMOUNT' | 'INSUFFICIENT_AVAILABLE_BALANCE' | 'NETWORK_MISMATCH' | 'RPC_UNAVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN', string>>;
    readonly send: {
      readonly notActive: ErrorCopy;
      readonly available: string;
      readonly storageReserve: string;
      readonly gasReserve: string;
      readonly signingOff: string;
      readonly preparing: string;
    };
    readonly home: {
      readonly noBalance: string;
      readonly lockedHint: string;
    };
    readonly receive: {
      readonly localOnlyNote: string;
    };
    readonly paymentsNote: string;
    readonly createdAlready: string;
    readonly nativeChip: string;
  };

  readonly screens: {
    readonly home: string;
    readonly send: string;
    readonly receive: string;
    readonly scan: string;
    readonly requestNew: string;
    readonly pay: string;
    readonly receipt: string;
    readonly activity: string;
    readonly checkout: string;
    readonly session: string;
    readonly merchant: string;
    readonly merchantSetup: string;
    readonly merchantRegister: string;
    readonly contacts: string;
    readonly split: string;
    readonly recurring: string;
    readonly settings: string;
    readonly demo: string;
    readonly notFound: string;
    readonly errorBoundary: string;
  };

  /** Phase 5 one-tap redesign: shell, Tap sheet, simplified home/request/receipt. */
  readonly oneTap: {
    readonly nav: { readonly wallet: string; readonly tap: string; readonly activity: string };
    readonly sheet: {
      readonly title: string;
      readonly description: string;
      readonly close: string;
      readonly request: { readonly label: string; readonly body: string };
      readonly pay: { readonly label: string; readonly body: string };
      readonly send: { readonly label: string; readonly body: string };
    };
    readonly payLink: {
      readonly title: string;
      readonly body: string;
      readonly label: string;
      readonly placeholder: string;
      readonly open: string;
      readonly invalid: string;
      readonly otherSite: string;
      readonly back: string;
    };
    /** Phase 6A: the two ways to open a request (link or QR). */
    readonly payEntry: {
      readonly title: string;
      readonly body: string;
      readonly choicesLabel: string;
      readonly link: { readonly label: string; readonly body: string };
      readonly scan: { readonly label: string; readonly body: string };
    };
    readonly scanner: {
      readonly title: string;
      readonly hint: string;
      readonly close: string;
      readonly starting: string;
      readonly scanning: string;
      readonly found: string;
      readonly notTaply: string;
      readonly otherSite: string;
      readonly paused: string;
      readonly resume: string;
      readonly retry: string;
      readonly pasteLink: string;
      readonly privacy: string;
      readonly problems: {
        readonly denied: ErrorCopy;
        readonly no_camera: ErrorCopy;
        readonly busy: ErrorCopy;
        readonly insecure: ErrorCopy;
        readonly unsupported: ErrorCopy;
      };
    };
    /** Phase 6A: share links and QR codes only on a public HTTPS origin. */
    readonly shareOrigin: {
      readonly localOnly: ErrorCopy;
      readonly invalidConfig: ErrorCopy;
      readonly requestIdLabel: string;
      readonly copyId: string;
      readonly idCopied: string;
    };
    /** Phase 6A: why this device can or cannot verify a receipt. */
    readonly receiptEvidence: {
      readonly matching: string;
      readonly walletNoReference: ErrorCopy;
    };
    readonly menu: {
      readonly open: string;
      readonly title: string;
      readonly wallet: string;
      readonly receive: string;
      readonly settings: string;
      readonly help: string;
      readonly helpBody: string;
      readonly language: string;
      readonly notConnected: string;
    };
    readonly home: {
      readonly allActivity: string;
      readonly accountRowHint: string;
    };
    readonly activity: {
      readonly title: string;
      readonly scope: string;
    };
    readonly request: {
      readonly title: string;
      readonly continue: string;
      readonly moreOptions: string;
      readonly defaults: string;
      readonly anyoneMayPay: string;
      readonly toYou: string;
      readonly reviewTitle: string;
      readonly whoCanPay: string;
      readonly payableUntil: string;
      /** Default-view cost row: the non-refundable storage deposit (network fee shown by the wallet). */
      readonly cost: string;
      readonly costNote: string;
      /** Short status under the inactive action when this build has signing off. */
      readonly previewOff: string;
    };
    readonly payment: {
      readonly details: string;
      readonly transactionDetails: string;
      readonly steps: string;
      readonly from: string;
      readonly refresh: string;
    };
    readonly receipt: {
      readonly technicalProof: string;
    };
  };

  /** Phase 5C: freshness and cross-tab safety states. */
  readonly reliability: {
    readonly reviewAgain: ErrorCopy;
    readonly staleChain: ErrorCopy;
    readonly clockAhead: ErrorCopy;
  };
}
