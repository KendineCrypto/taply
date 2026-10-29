import type { Dictionary } from '../types';

/**
 * English (default locale).
 *
 * Status copy rules that must survive every edit (freeze section 9):
 *  - LOCKED, any *_IN_FLIGHT and any unknown state never say or imply "paid".
 *  - CANCELLED_REFUNDED says Refunded, never Paid.
 *  - Only FINAL_PAID claims the money reached the recipient.
 *
 * `errors` is keyed by the `@taply/shared` ErrorCode union. The API sends only a
 * code and a messageKey; all display prose is owned here (freeze section 8).
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
      recipient:
        'The transfer to you could not be completed. The obligation is preserved and can be retried.',
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
    REVIEWED: {
      label: 'Terms reviewed',
      description: 'Terms were reviewed. This is not a payment authorization.',
    },
    EXPIRED: { label: 'Session ended', description: 'The live session has ended. Start a new one.' },
    CLOSED: { label: 'Session closed', description: 'The session is closed.' },
  },

  assurance: {
    unverified: { label: 'Unverified', description: 'Not checked against the chain yet.' },
    pending_finality: { label: 'Pending finality', description: 'Seen on chain but not final yet.' },
    verified_final: { label: 'Verified', description: 'Confirmed final on chain.' },
    unknown: { label: 'Unknown', description: 'The chain status could not be determined.' },
    mismatch: {
      label: 'Mismatch',
      description: 'Sources disagree. Chain data wins; actions are blocked.',
    },
  },

  errors: {
    INVALID_ARGUMENT: {
      title: 'Invalid request',
      body: 'Something in that request was not valid. Nothing was sent.',
    },
    INVALID_ACCOUNT: { title: 'Invalid account', body: 'That NEAR account ID is not valid.' },
    INVALID_AMOUNT: { title: 'Invalid amount', body: 'Enter a whole positive amount in base units.' },
    INVALID_DURATION: {
      title: 'Invalid cancel window',
      body: 'The cancellation window must be between 60 seconds and 1 hour.',
    },
    INVALID_EXPIRY: {
      title: 'Invalid expiry',
      body: 'The funding deadline must be in the future and within 24 hours.',
    },
    WRONG_NETWORK: {
      title: 'Wrong network',
      body: 'Taply only works on NEAR Testnet. Switch your wallet to Testnet and try again.',
    },
    UNSUPPORTED_ASSET: {
      title: 'Unsupported asset',
      body: 'Only native Testnet NEAR is supported in this version.',
    },
    UNSUPPORTED_MODE: {
      title: 'Unsupported mode',
      body: 'That payment mode is not enabled in this build.',
    },
    INVALID_DEPOSIT: {
      title: 'Deposit does not match',
      body: 'The attached deposit must equal the exact requested amount. Nothing was accepted.',
    },
    INSUFFICIENT_PREPAID_GAS: {
      title: 'Not enough gas attached',
      body: 'The transaction did not reserve enough gas to finish safely.',
    },

    AUTH_REQUIRED: { title: 'Sign in required', body: 'Authenticate with your wallet to continue.' },
    AUTH_EXPIRED: { title: 'Sign-in expired', body: 'Your sign-in expired. Authenticate again.' },
    AUTH_SIGNATURE_INVALID: {
      title: 'Signature not valid',
      body: 'That wallet signature could not be verified.',
    },
    AUTH_CHALLENGE_EXPIRED: { title: 'Challenge expired', body: 'The sign-in challenge expired. Start again.' },
    AUTH_CHALLENGE_USED: {
      title: 'Challenge already used',
      body: 'That sign-in challenge was already used. Start a new one.',
    },
    NOT_AUTHORIZED: { title: 'Not authorized', body: 'Your account is not permitted to do that.' },
    PAYER_MISMATCH: {
      title: 'Different payer required',
      body: 'This request is restricted to another account. Do not pay from this one.',
    },
    MERCHANT_BINDING_INVALID: {
      title: 'Merchant account mismatch',
      body: 'The receiving account does not match the merchant profile. Do not pay.',
    },
    UNSUPPORTED_CALLER: {
      title: 'Unsupported caller',
      body: 'That action cannot be performed from this context.',
    },
    CSRF_REJECTED: { title: 'Request blocked', body: 'That request did not come from this app. Nothing was done.' },

    REQUEST_NOT_FOUND: { title: 'Request not found', body: 'No payment request exists for that identifier.' },
    SESSION_NOT_FOUND: { title: 'Session not found', body: 'That live session does not exist.' },
    MERCHANT_NOT_FOUND: { title: 'Merchant not found', body: 'No merchant profile exists for that account.' },
    IDEMPOTENCY_CONFLICT: {
      title: 'Already in progress',
      body: 'An identical request is already being processed. A second one will not be created.',
    },
    REQUEST_ID_CONFLICT: {
      title: 'Request already exists',
      body: 'A different request already uses that identifier. A new one must be created.',
    },
    TERMS_MISMATCH: {
      title: 'Terms changed',
      body: 'The payment terms changed while you were reviewing. Review the new terms before authorizing.',
    },
    REQUEST_EXPIRED: { title: 'Request expired', body: 'This request can no longer be funded. Ask for a new one.' },
    REQUEST_NOT_OPEN: { title: 'Request not open', body: 'This request is no longer accepting funding.' },
    REQUEST_ALREADY_FUNDED: { title: 'Already funded', body: 'This request has already been funded once.' },
    REQUEST_ALREADY_SETTLED: {
      title: 'Already settled',
      body: 'This request has already reached a final state.',
    },

    CANCEL_WINDOW_CLOSED: {
      title: 'Cancellation window closed',
      body: 'The chain closed the cancellation window before this call executed. Cancellation is no longer possible.',
    },
    WINDOW_STILL_OPEN: {
      title: 'Too early to release',
      body: 'The cancellation window has not closed on chain yet.',
    },
    OPERATION_IN_FLIGHT: {
      title: 'Transfer in progress',
      body: 'A transfer is already being processed on chain. Wait for the result.',
    },
    OPERATION_NONCE_MISMATCH: {
      title: 'Out of date',
      body: 'This view is behind the chain. Refresh before trying again.',
    },
    OPERATION_NOT_RETRYABLE: {
      title: 'Cannot retry this',
      body: 'This operation has no recorded failure to retry, or you are not the authorized party.',
    },
    RECEIPT_NOT_FINAL: {
      title: 'Receipt not final',
      body: 'There is no verified receipt yet because the payment has not reached a final state.',
    },

    SESSION_MISMATCH: {
      title: 'Terms do not match',
      body: 'The two devices are not showing the same terms. Do not pay. Start a new session.',
    },
    SESSION_ALREADY_BOUND: {
      title: 'Session already in use',
      body: 'That session is already bound to another request.',
    },
    SESSION_ALREADY_JOINED: {
      title: 'Session already joined',
      body: 'Someone has already joined that session.',
    },
    SESSION_EXPIRED: { title: 'Session ended', body: 'The live session has ended. Create a new session.' },
    JOIN_TOKEN_EXPIRED: { title: 'Link expired', body: 'That join link expired. Ask for a new one.' },
    JOIN_TOKEN_USED: { title: 'Link already used', body: 'That join link has already been used.' },
    STORAGE_QUOTE_CHANGED: {
      title: 'Costs changed',
      body: 'The storage quote changed since you started. Review the new figures before signing.',
    },

    RATE_LIMITED: { title: 'Too many requests', body: 'Wait a moment and try again.' },
    RPC_UNAVAILABLE: {
      title: 'Chain unreachable',
      body: 'The network cannot be reached right now. No payment was affected.',
    },
    INDEX_UNAVAILABLE: { title: 'History unavailable', body: 'Recent activity cannot be loaded right now.' },
    VERIFICATION_UNAVAILABLE: {
      title: 'Cannot verify right now',
      body: 'Chain state cannot be confirmed, so nothing is shown as verified.',
    },
    CONTRACT_UNAVAILABLE: { title: 'Contract unavailable', body: 'The payments contract cannot be reached.' },
    TRANSFER_LIQUIDITY_UNAVAILABLE: {
      title: 'Transfer cannot proceed',
      body: 'The contract cannot complete a transfer right now. The funds remain accounted for.',
    },

    WALLET_NOT_READY: { title: 'Wallet not ready', body: 'Connect a NEAR Testnet wallet to continue.' },
    USER_REJECTED: { title: 'Signature declined', body: 'You declined the signature. Nothing was sent.' },
    INSUFFICIENT_BALANCE: {
      title: 'Not enough balance',
      body: 'This account does not have enough Testnet NEAR.',
    },
    INSUFFICIENT_GAS: { title: 'Not enough gas', body: 'Add more Testnet NEAR to cover transaction fees.' },

    RPC_TIMEOUT_UNKNOWN_STATUS: {
      title: 'Result uncertain',
      body: 'The chain status is being checked before you pay again. Do not retry yet.',
    },
    CALLBACK_FAILED: {
      title: 'Result unresolved',
      body: 'The transfer started but its result is not recorded yet. Do not pay again while this is reconciled.',
    },
    RECONCILIATION_REQUIRED: {
      title: 'Needs reconciliation',
      body: 'This payment is in an unresolved state that must be reconciled on chain. Do not pay again.',
    },
  },

  notices: {
    offline: { title: 'You are offline', body: 'Check your connection. No payment was affected.' },
    unexpected: {
      title: 'Something went wrong',
      body: 'That could not be completed. No payment state was changed by this app.',
    },
    socialLoginUnavailable: {
      title: 'Not available for Testnet',
      body: 'This sign-in method cannot provide a Testnet wallet yet. Continue with a supported wallet.',
    },
    chainTimeUnavailable: {
      title: 'Chain time unavailable',
      body: 'Chain time cannot be read, so any countdown shown would be unreliable.',
    },
    incidentOpen: {
      title: 'Unresolved on chain',
      body: 'This payment has an unresolved outcome. Actions are withheld until it is reconciled. Do not pay again.',
    },
    projectionContradiction: {
      title: 'Conflicting rights reported',
      body: 'Both cancellation and release were reported as available, which cannot both be true. No action is offered.',
    },
  },

  protectedPay: {
    preFundingConsent:
      'You can cancel for 60 seconds starting when this payment funds on-chain; on-chain execution time determines whether cancellation succeeds. Release requires a separate transaction after that period.',
    postFundingCutoffLabel: 'Cancellation window closes',
    countdownApproximate: 'Countdown is approximate. The chain decides the exact cutoff.',
    cutoffPassed:
      'The cancellation window may have closed. The chain decides whether a cancellation still executes.',
    whoCanCancel: 'Only you, the payer, can cancel - and only before the on-chain cutoff.',
    whoCanRelease:
      'After the cutoff, anyone can submit the release transaction. Time passing alone pays nobody.',
    merchantCannot: 'The recipient cannot spend, move or release the amount before the cutoff.',
    lockedNotPaid: 'LOCKED - NOT PAID',
  },

  handshake: {
    comparisonCodeLabel: 'Comparison code',
    comparisonCodeCaption: 'Check that both screens show the same code.',
    comparisonMismatch: 'The codes do not match. Do not pay. Start a new session.',
    notIdentityProof:
      'This code helps two people compare the same terms. It is not proof of identity and it can collide.',
    offlineDegraded:
      'The live session is unavailable. You can still review and pay the verified request directly.',
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
