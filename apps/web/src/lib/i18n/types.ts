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
    readonly setup: {
      readonly notConfigured: ErrorCopy;
      readonly invalidConfig: ErrorCopy;
      readonly chainUnavailable: ErrorCopy;
      readonly checking: string;
      readonly rejected: ErrorCopy;
      readonly unreachable: ErrorCopy;
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
      readonly quoteTitle: string;
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
}
