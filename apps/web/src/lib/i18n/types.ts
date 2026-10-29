import type {
  Assurance,
  ChainState,
  LocalWalletPhase,
  SessionState,
  TaplyErrorCode,
} from '@/lib/protocol';

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
 * key is a TYPE ERROR rather than a runtime fallback to English. Records keyed
 * by protocol enums make the mapping exhaustive by construction.
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
  readonly localPhase: Readonly<Record<LocalWalletPhase, PhaseCopy>>;
  readonly sessionState: Readonly<Record<SessionState, PhaseCopy>>;
  readonly assurance: Readonly<Record<Assurance, PhaseCopy>>;
  readonly errors: Readonly<Record<TaplyErrorCode, ErrorCopy>>;

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
