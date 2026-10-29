import type { Dictionary } from '../types';

/**
 * English (default locale).
 *
 * Status copy rules that must survive every edit (freeze section 9):
 *  - LOCKED, any *_IN_FLIGHT and any unknown state never say or imply "paid".
 *  - CANCELLED_REFUNDED says Refunded, never Paid.
 *  - Only FINAL_PAID claims the money reached the recipient.
 */
export const en: Dictionary = {
  locale: 'en',
  localeName: 'English',

  app: {
    name: 'Taply',
    networkBadge: 'NEAR Testnet',
    demoFundsNote: 'Test funds only. No real money, no fiat value.',
    skipToContent: 'Skip to main content',
    languageLabel: 'Language',
  },

  nav: {
    home: 'Home',
    pay: 'Pay',
    scan: 'Scan',
    activity: 'Activity',
    settings: 'Settings',
    primaryLabel: 'Primary navigation',
  },

  common: {
    amount: 'Amount',
    recipient: 'Recipient',
    payer: 'Payer',
    network: 'Network',
    mode: 'Mode',
    copy: 'Copy',
    copied: 'Copied',
    back: 'Back',
    retry: 'Try again',
    close: 'Close',
    viewReceipt: 'View receipt',
    viewOnExplorer: 'View on explorer',
    checkChainStatus: 'Check chain status',
    loading: 'Loading',
    notAvailable: 'Not available',
    exactBaseUnits: 'Exact amount in base units',
    approximate: 'Approximate',
  },

  mode: {
    instant: 'Instant Pay',
    protected: 'Protected Pay',
  },

  status: {
    OPEN: {
      label: 'Awaiting payment',
      payer: 'This request has not been funded yet.',
      recipient: 'Nothing has been received yet.',
      announce: 'Awaiting payment. No funds have moved.',
    },
    CANCELLED_UNFUNDED: {
      label: 'Cancelled',
      payer: 'This request was cancelled before it was funded.',
      recipient: 'Cancelled before funding. Nothing was received.',
      announce: 'Cancelled before funding. No funds moved.',
    },
    PAYOUT_IN_FLIGHT: {
      label: 'Processing on chain',
      payer: 'Your payment is being processed on chain. The result is being verified.',
      recipient: 'A transfer is being processed on chain. Not confirmed as received yet.',
      announce: 'Payment processing on chain. Outcome not yet verified. Do not pay again.',
    },
    PAYOUT_FAILED_RECOVERABLE: {
      label: 'Transfer incomplete',
      payer: 'The transfer could not be completed. The funds are still accounted for on chain.',
      recipient: 'The transfer to you could not be completed. The obligation is preserved and can be retried.',
      announce: 'Transfer incomplete. Funds are accounted for. Nothing was lost and nothing was paid.',
    },
    LOCKED: {
      label: 'Locked, not paid',
      payer: 'The amount is locked in the contract. It has not been paid to the recipient yet.',
      recipient: 'LOCKED - NOT PAID. The amount is held in the contract and is not spendable by you.',
      announce: 'Amount locked in the contract. Not paid to the recipient. Not spendable.',
    },
    REFUND_IN_FLIGHT: {
      label: 'Refund processing',
      payer: 'Your refund is being confirmed on chain.',
      recipient: 'A refund to the payer is being confirmed on chain. You will not be paid for this request.',
      announce: 'Refund processing on chain. Not yet complete.',
    },
    REFUND_FAILED_RECOVERABLE: {
      label: 'Refund incomplete',
      payer: 'The refund could not be completed. The funds are still accounted for on chain.',
      recipient: 'The refund could not be completed. The obligation is preserved.',
      announce: 'Refund incomplete. Funds are accounted for. Not paid and not refunded.',
    },
    RELEASE_IN_FLIGHT: {
      label: 'Release processing',
      payer: 'The transfer to the recipient is being verified. It is not complete yet.',
      recipient: 'The transfer to you is being verified. It is not complete yet.',
      announce: 'Release processing on chain. Not yet complete. Not paid.',
    },
    RELEASE_FAILED_RECOVERABLE: {
      label: 'Release incomplete',
      payer: 'The release could not be completed. The funds are still accounted for on chain.',
      recipient: 'The release could not be completed. The obligation is preserved and can be retried.',
      announce: 'Release incomplete. Funds are accounted for. Not paid.',
    },
    FINAL_PAID: {
      label: 'Paid',
      payer: 'Payment verified. It reached the recipient.',
      recipient: 'Payment verified. The funds reached your account.',
      announce: 'Payment verified on chain. The funds reached the recipient.',
    },
    CANCELLED_REFUNDED: {
      label: 'Refunded',
      payer: 'The payment was cancelled and the amount was refunded to you.',
      recipient: 'Cancelled and refunded to the payer. You were not paid.',
      announce: 'Cancelled and refunded to the payer. This is not a payment.',
    },
  },

  localPhase: {
    IDLE: { label: 'Ready', description: 'Nothing in progress.' },
    REVIEWING: { label: 'Review', description: 'Check the exact terms before you authorize anything.' },
    AWAITING_SIGNATURE: {
      label: 'Confirm in your wallet',
      description: 'Approve the transaction in your wallet. Nothing has been sent yet.',
    },
    USER_REJECTED: {
      label: 'Signature declined',
      description: 'You declined the signature. Nothing was sent and no payment was created.',
    },
    SUBMITTED: {
      label: 'Submitted',
      description: 'The transaction was submitted. Waiting for the chain to confirm the outcome.',
    },
    OUTCOME_UNKNOWN: {
      label: 'Result uncertain',
      description:
        'We could not confirm the outcome. We are checking the chain before anything else happens. Do not pay again.',
    },
  },

  sessionState: {
    DRAFT: { label: 'Preparing', description: 'The session is being prepared.' },
    OPEN: { label: 'Waiting to pair', description: 'Waiting for the other device to join.' },
    PAIRED: { label: 'Paired', description: 'Both devices are in the session.' },
    REVIEWED: { label: 'Terms reviewed', description: 'Terms were reviewed. This is not a payment authorization.' },
    EXPIRED: { label: 'Session ended', description: 'The live session has ended. Start a new one.' },
    CLOSED: { label: 'Session closed', description: 'The session is closed.' },
  },

  assurance: {
    unverified: { label: 'Unverified', description: 'Not checked against the chain yet.' },
    pending_finality: { label: 'Pending finality', description: 'Seen on chain but not final yet.' },
    verified_final: { label: 'Verified', description: 'Confirmed final on chain.' },
    unknown: { label: 'Unknown', description: 'The chain status could not be determined.' },
    mismatch: { label: 'Mismatch', description: 'Sources disagree. Chain data wins; actions are blocked.' },
  },

  errors: {
    WRONG_NETWORK: {
      title: 'Wrong network',
      body: 'Taply only works on NEAR Testnet. Switch your wallet to Testnet and try again.',
    },
    INVALID_ACCOUNT: { title: 'Invalid account', body: 'That NEAR account ID is not valid.' },
    INVALID_ASSET: { title: 'Unsupported asset', body: 'Only native Testnet NEAR is supported in this version.' },
    INVALID_AMOUNT: { title: 'Invalid amount', body: 'Enter a whole positive amount in base units.' },
    INSUFFICIENT_BALANCE: { title: 'Not enough balance', body: 'This account does not have enough Testnet NEAR.' },
    INSUFFICIENT_GAS: { title: 'Not enough gas', body: 'Add more Testnet NEAR to cover transaction fees.' },
    AUTH_REQUIRED: { title: 'Sign in required', body: 'Authenticate to continue.' },
    WALLET_NOT_READY: { title: 'Wallet not ready', body: 'Connect a NEAR Testnet wallet to continue.' },
    SOCIAL_LOGIN_NOT_TESTNET_CAPABLE: {
      title: 'Not available for Testnet',
      body: 'This sign-in method cannot provide a Testnet wallet yet. Continue with a supported wallet.',
    },
    USER_REJECTED: {
      title: 'Signature declined',
      body: 'You declined the signature. Nothing was sent.',
    },
    REQUEST_EXPIRED: { title: 'Request expired', body: 'This request can no longer be funded. Ask for a new one.' },
    REQUEST_ALREADY_FUNDED: { title: 'Already funded', body: 'This request has already been funded once.' },
    REQUEST_ALREADY_SETTLED: { title: 'Already settled', body: 'This request has already reached a final state.' },
    WINDOW_STILL_OPEN: {
      title: 'Too early to release',
      body: 'The cancellation window has not closed on chain yet.',
    },
    CANCEL_WINDOW_CLOSED: {
      title: 'Cancellation window closed',
      body: 'The chain closed the cancellation window before this call executed. Cancellation is no longer possible.',
    },
    REFUND_IN_FLIGHT: { title: 'Refund in progress', body: 'A refund is already being processed on chain.' },
    PAYOUT_IN_FLIGHT: { title: 'Payment in progress', body: 'A transfer is already being processed on chain.' },
    REFUND_FAILED: {
      title: 'Refund failed',
      body: 'The refund did not complete. The funds are still accounted for on chain.',
    },
    PAYOUT_FAILED: {
      title: 'Transfer failed',
      body: 'The transfer did not complete. The funds are still accounted for on chain.',
    },
    UNVERIFIED_MERCHANT: {
      title: 'Merchant not verified',
      body: 'This merchant has not proven control of the receiving account. Do not pay unless you trust them.',
    },
    SESSION_EXPIRED: { title: 'Session ended', body: 'The live session has ended. Create a new session.' },
    SESSION_MISMATCH: {
      title: 'Terms do not match',
      body: 'The two devices are not showing the same terms. Do not pay. Start a new session.',
    },
    NETWORK_UNAVAILABLE: { title: 'You are offline', body: 'Check your connection. No payment was affected.' },
    RPC_TIMEOUT_UNKNOWN_STATUS: {
      title: 'Result uncertain',
      body: 'We are checking the chain status before you pay again. Do not retry yet.',
    },
    RATE_LIMITED: { title: 'Too many requests', body: 'Wait a moment and try again.' },
    RECEIPT_NOT_FINAL: {
      title: 'Receipt not final',
      body: 'There is no verified receipt yet because the payment has not reached a final state.',
    },
    TERMS_CHANGED: {
      title: 'Terms changed',
      body: 'The payment terms changed while you were reviewing. Review the new terms before authorizing.',
    },
    MERCHANT_NOT_FOUND: { title: 'Merchant not found', body: 'No merchant profile exists for that account.' },
    MERCHANT_ACCOUNT_MISMATCH: {
      title: 'Merchant account mismatch',
      body: 'The receiving account does not match the merchant profile. Do not pay.',
    },
    RETRY_NOT_AUTHORIZED: {
      title: 'Not authorized to retry',
      body: 'Only the authorized party can retry this operation.',
    },
    CLOCK_UNAVAILABLE: {
      title: 'Chain time unavailable',
      body: 'We cannot read chain time, so any countdown shown would be unreliable.',
    },
    UNKNOWN_ERROR: {
      title: 'Something went wrong',
      body: 'We could not complete that. No payment state was changed by this app.',
    },
  },

  protectedPay: {
    preFundingConsent:
      'You can cancel for 60 seconds starting when this payment funds on-chain; on-chain execution time determines whether cancellation succeeds. Release requires a separate transaction after that period.',
    postFundingCutoffLabel: 'Cancellation window closes',
    countdownApproximate: 'Countdown is approximate. The chain decides the exact cutoff.',
    cutoffPassed: 'The cancellation window may have closed. The chain decides whether a cancellation still executes.',
    whoCanCancel: 'Only you, the payer, can cancel - and only before the on-chain cutoff.',
    whoCanRelease: 'After the cutoff, anyone can submit the release transaction. Time passing alone pays nobody.',
    merchantCannot: 'The recipient cannot spend, move or release the amount before the cutoff.',
    lockedNotPaid: 'LOCKED - NOT PAID',
  },

  handshake: {
    comparisonCodeLabel: 'Comparison code',
    comparisonCodeCaption: 'Check that both screens show the same code.',
    comparisonMismatch: 'The codes do not match. Do not pay. Start a new session.',
    notIdentityProof:
      'This code helps two people compare the same terms. It is not proof of identity and it can collide.',
    offlineDegraded: 'The live session is unavailable. You can still review and pay the verified request directly.',
  },

  checkout: {
    permanentQrIsDiscovery:
      'This permanent QR opens the merchant profile. It is not a payable invoice and it cannot create a charge on its own.',
    merchantMustSign: 'The merchant signs a new on-chain request for every sale.',
    accountControlOnly:
      'A verified merchant has proven control of this NEAR account. That is not a business identity or KYC check.',
  },

  flags: {
    disabledTitle: 'Not enabled',
    disabledBody: 'This capability is not enabled in this build.',
    comingLater: 'Coming later',
    requiresVerification: 'Disabled until it is verified on NEAR Testnet.',
  },

  mock: {
    badge: 'MOCK',
    demoOnly: 'Demo data. Not a real transaction and not on chain.',
    blockedOutsideDemo: 'Mock data cannot be shown outside the demo area.',
  },

  screens: {
    home: 'Wallet',
    send: 'Send',
    receive: 'Receive',
    scan: 'Scan',
    requestNew: 'New request',
    pay: 'Payment',
    receipt: 'Receipt',
    activity: 'Activity',
    checkout: 'Merchant',
    session: 'Live session',
    merchant: 'Merchant dashboard',
    merchantSetup: 'Merchant setup',
    merchantRegister: 'Register',
    contacts: 'Contacts',
    split: 'Split bill',
    recurring: 'Recurring requests',
    settings: 'Settings',
    demo: 'Demo',
    notFound: 'Page not found',
    errorBoundary: 'Something went wrong',
  },
};
