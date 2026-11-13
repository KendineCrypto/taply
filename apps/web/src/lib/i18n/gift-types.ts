import type { ErrorCopy } from './types';

/** Taply Gift: /gift/new, /gift/[id], /gift/[id]/receipt, /gift/p. */
export interface GiftCopy {
  readonly title: string;
  readonly sheet: { readonly label: string; readonly body: string };
  readonly steps: { readonly type: string; readonly amount: string; readonly message: string; readonly review: string; readonly share: string };
  readonly stepOf: string;
  readonly back: string;
  readonly next: string;
  readonly type: {
    readonly heading: string;
    readonly personal: { readonly label: string; readonly body: string; readonly badge: string };
    readonly open: { readonly label: string; readonly body: string; readonly badge: string };
    readonly openOff: string;
    readonly personalNeedsTaply: string;
  };
  readonly amount: {
    readonly heading: string;
    readonly recipientLabel: string;
    readonly recipientHint: string;
    readonly available: string;
    readonly limits: string;
    readonly errors: Readonly<Record<'required' | 'invalid' | 'tooSmall' | 'tooLarge' | 'precision' | 'balance' | 'recipient' | 'self' | 'mainnet' | 'missing', string>>;
  };
  readonly message: {
    readonly heading: string;
    readonly label: string;
    readonly placeholder: string;
    /** `{used}` / `{max}` bytes. */
    readonly counter: string;
    readonly publicNote: string;
    readonly privateNote: string;
    readonly designLabel: string;
    readonly designs: Readonly<Record<'forest' | 'lime' | 'linen' | 'midnight', string>>;
    readonly lifetimeLabel: string;
    readonly lifetimes: Readonly<Record<'1h' | '24h' | '7d', string>>;
    readonly lifetimeHint: string;
    readonly tooLong: string;
    readonly invalid: string;
  };
  readonly review: {
    readonly heading: string;
    readonly txType: string;
    readonly txOpen: string;
    readonly txPersonal: string;
    readonly sender: string;
    readonly recipient: string;
    readonly contract: string;
    readonly giftAmount: string;
    readonly fee: string;
    readonly feeNote: string;
    readonly deposit: string;
    readonly networkFee: string;
    readonly networkFeeValue: string;
    readonly expires: string;
    readonly openRules: string;
    readonly personalRules: string;
    readonly confirm: string;
    readonly confirming: string;
    readonly unreviewed: string;
  };
  readonly result: {
    readonly openReady: string;
    readonly openReadyBody: string;
    readonly openWaiting: string;
    readonly openWaitingBody: string;
    readonly personalSent: string;
    readonly personalSentBody: string;
    readonly declined: string;
    readonly notSent: string;
    readonly unknown: ErrorCopy;
    readonly failed: ErrorCopy;
    readonly recheck: string;
    readonly another: string;
  };
  readonly share: {
    readonly heading: string;
    readonly copy: string;
    readonly copied: string;
    readonly copyFailed: string;
    readonly x: string;
    readonly native: string;
    readonly qr: string;
    readonly xOpenText: string;
    readonly xPersonalText: string;
    readonly secretNote: string;
    readonly originUnavailable: string;
  };
  readonly envelope: {
    readonly unwrap: string;
    readonly unwrapHint: string;
    readonly closedLabel: string;
    readonly openLabel: string;
    readonly from: string;
    readonly noMessage: string;
  };
  readonly claim: {
    readonly heading: string;
    readonly amountLabel: string;
    readonly expiresIn: string;
    readonly expiredAt: string;
    readonly connect: string;
    readonly claimAction: string;
    readonly claimHint: string;
    readonly creatorCannot: string;
    readonly missingSecret: ErrorCopy;
    readonly signFailed: string;
    readonly states: Readonly<Record<
      'loading' | 'unavailable' | 'not_found' | 'available' | 'connecting' | 'awaiting_wallet' | 'submitted' | 'claim_pending' |
      'claimed' | 'payout_failed' | 'already_claimed' | 'expired' | 'refund_pending' | 'refunded',
      ErrorCopy
    >>;
    readonly winner: string;
    readonly payout: string;
    readonly payoutValues: Readonly<Record<'PENDING' | 'CONFIRMED' | 'FAILED', string>>;
    readonly settledBlock: string;
    readonly yourTx: string;
    readonly retryPayout: string;
    readonly refundAction: string;
    readonly refundHint: string;
    readonly notRepaid: string;
    readonly receipt: string;
    readonly refresh: string;
    readonly unreviewed: string;
    readonly flagOff: ErrorCopy;
  };
  readonly receipt: {
    readonly title: string;
    readonly giftId: string;
    readonly creator: string;
    readonly amount: string;
    readonly created: string;
    readonly expires: string;
    readonly status: string;
    readonly beneficiary: string;
    readonly payout: string;
    readonly settledAt: string;
    readonly contract: string;
    readonly codeHash: string;
    readonly block: string;
    readonly explorer: string;
    readonly honest: string;
    readonly back: string;
  };
  readonly personal: {
    readonly title: string;
    readonly invalid: ErrorCopy;
    readonly checking: string;
    readonly verified: string;
    readonly verifiedBody: string;
    readonly mismatch: ErrorCopy;
    readonly notFound: ErrorCopy;
    readonly unavailable: ErrorCopy;
    readonly messageNote: string;
    readonly from: string;
    readonly to: string;
    readonly tx: string;
  };
  readonly confirmLabels: Readonly<Record<'create_gift' | 'claim_gift' | 'refund_gift' | 'retry_payout', string>>;
}
