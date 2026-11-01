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

  wallet: {
    connect: 'Connect wallet',
    connecting: 'Opening your wallet…',
    restoring: 'Checking wallet connection',
    disconnect: 'Disconnect',
    connectedWith: 'Connected with {wallet}',
    accountLabel: 'Account',
    walletLabel: 'Wallet',
    connectTitle: 'Connect a NEAR Testnet wallet',
    connectBody: 'See your Testnet balance and get ready to request and pay.',
    noKeysNote: 'Taply never sees or stores your keys. Every transfer is approved in your own wallet.',
    reportedNotProven:
      'Your wallet shared this account ID. Nothing has been signed, and connecting cannot move funds.',
    disabled: {
      title: 'Wallet connection is off',
      body: 'Wallet connection is switched off in this build.',
    },
    likelyMainnet: {
      title: 'This looks like a mainnet account',
      body: 'Taply only works on NEAR Testnet. If this account does not exist on Testnet, switch your wallet to Testnet.',
    },
    copyAccount: 'Copy account ID',
    accountCopied: 'Account ID copied',
    copyFailed: 'Could not copy. Select the account ID and copy it manually.',
    accountMenuLabel: 'Wallet account',
    errors: {
      cancelled: {
        title: 'Connection cancelled',
        body: 'The wallet was closed before connecting. Nothing changed.',
      },
      unavailable: {
        title: 'No wallet available',
        body: 'The wallet list could not be loaded, or no Testnet wallet is available. Check your connection and try again.',
      },
      no_account: {
        title: 'No usable account',
        body: 'The wallet did not share a valid NEAR account. Choose or create a Testnet account in your wallet.',
      },
      failed: {
        title: 'Could not connect',
        body: 'The wallet did not finish connecting. Nothing was signed. Try again.',
      },
    },
  },

  balance: {
    title: 'Testnet balance',
    refresh: 'Refresh balance',
    refreshing: 'Refreshing',
    verifiedAt: 'Final block #{height} · {time}',
    staleAt: 'Last verified {time}. The latest read failed.',
    storageNote: 'Total account balance. Part of it is reserved for storage and cannot be sent.',
    lockedLabel: 'Locked (staked)',
    notShown: 'Balance not shown',
    loading: 'Reading balance from NEAR Testnet',
    notFound: {
      title: 'Account not found on Testnet',
      body: 'This account does not exist on NEAR Testnet. It may be a mainnet account, or it has not been funded yet.',
    },
    networkMismatch: {
      title: 'Wrong network',
      body: 'The balance service did not answer as NEAR Testnet, so no balance is shown.',
    },
    unverified: {
      title: 'Balance not verified',
      body: 'The read could not be tied to a final Testnet block, so no number is shown.',
    },
    readFailed: {
      title: 'Balance unavailable',
      body: 'NEAR Testnet could not be reached. Your funds are unaffected. Try again.',
    },
    rateLimited: {
      title: 'Too many requests',
      body: 'The public Testnet service is busy. Wait a moment and refresh.',
    },
    configInvalid: {
      title: 'Chain connection not configured',
      body: 'This build has no valid NEAR Testnet connection, so balances cannot be read.',
    },
  },

  home: {
    quickActionsLabel: 'Quick actions',
    send: 'Send',
    receive: 'Receive',
    request: 'Request',
    soon: 'Soon',
    recentActivity: 'Recent activity',
    activityEmptyTitle: 'No activity to show yet',
    activityEmptyBody:
      'Taply activity appears here once its payment history service is live. Your full Testnet history is on the explorer.',
    activityConnectBody: 'Connect a wallet to see your activity.',
    viewOnExplorer: 'View account on explorer',
  },

  routes: {
    payHub: {
      description: 'Every payment is reviewed in full and approved in your own wallet.',
      scanBody: 'Scan a sale or request QR code.',
      requestBody: 'Ask someone to pay you.',
      sendBody: 'Send directly to an account ID.',
      swipeNote:
        'A swipe only opens your wallet. It never moves funds by itself, and every swipe has a button and keyboard alternative.',
    },
    comingSoon: 'Coming soon',
    afterVerification: 'Available after it is verified on NEAR Testnet',
    send: 'Send Testnet NEAR to any account, with a full review before you approve in your wallet.',
    receive: 'Share your account ID to receive Testnet NEAR.',
    scan: 'Scan a merchant or request QR code. Amounts and recipients are always re-checked on chain.',
    requestNew: 'Create an Instant Pay request and share it by link or QR. Protected Pay is not available yet.',
    activity: 'Your Taply payments, with on-chain proof for each one.',
    contacts: 'Save names for account IDs on this device. The full account ID is always shown before you pay.',
    split: 'Split a bill into separate requests that add up exactly.',
    recurring: 'Request templates that create a new request each time. Nothing is ever charged automatically.',
    merchant: 'Every sale with its on-chain status. Locked funds are never shown as paid.',
    merchantSetup: 'Link your merchant profile to your NEAR Testnet account by signing in your wallet.',
    merchantRegister: 'Enter an amount and create a unique, signed request for each sale.',
    checkout: 'This merchant page shows active sales. It cannot charge you by itself.',
    session: 'Compare the same code on both screens, then review and pay.',
    payIntent: 'Review the recipient, exact amount and terms before approving in your wallet.',
    receipt: 'A receipt appears only after the payment is final and verified on chain.',
    requestIdLabel: 'Request ID',
    sessionIdLabel: 'Session ID',
    stateLabel: 'State',
    merchantAccountLabel: 'Merchant account',
  },

  receive: {
    yourAccount: 'Your account ID',
    testnetOnlyWarning: 'Only send NEAR Testnet funds to this account. Mainnet funds sent here are not visible in Taply.',
    qrLater: 'The QR code contains only this account ID, never an amount.',
    connectFirst: 'Connect a wallet to see the account ID you can receive with.',
  },

  settings: {
    walletSection: 'Wallet',
    languageSection: 'Language',
    networkSection: 'Network',
    contractLabel: 'Taply contract',
    contractNotDeployed: 'Not configured',
    rpcLabel: 'Testnet service',
    diagnosticsLink: 'Open diagnostics',
    diagnosticsBody: 'Technical details about this build, for reviewers.',
    notConnected: 'No wallet connected',
  },

  system: {
    reloadOnlyNote: 'This only reloads the screen. It does not resend anything.',
    notFoundBody: 'That link does not lead anywhere. No payment was affected.',
    goHome: 'Go to home',
    backOnline: 'Back online',
  },

  diagnostics: {
    title: 'Diagnostics',
    description: 'Technical state of this build. Simulated data below never touches a chain.',
    chainConfig: 'Chain configuration',
    chainConfigInvalid: 'Invalid configuration. Chain reads are disabled.',
    checkNetwork: 'Check Testnet connection',
    checking: 'Checking',
    networkOk: 'Testnet confirmed',
    capabilities: 'Capabilities',
    capabilitiesBody:
      'Payment capabilities stay off until verified on NEAR Testnet. "Locked" means configuration alone cannot enable it.',
    enabled: 'enabled',
    locked: 'locked',
    dependencies: 'Waiting on',
    dependencyItems: [
      'Reviewed Protected Pay contract (Codex) - blocks Protected Pay.',
      'GET /api/v1/payment-intents/:id and /receipts/:id (Codex) - blocks payment and receipt views.',
      'Account activity endpoint with per-item provenance (Codex) - blocks activity history.',
      'Session service and SSE hints (Codex) - blocks Handshake.',
      'NEP-413 challenge/verify endpoints (Codex) - blocks merchant setup.',
      'Settlement receipt verifier (funding, transfer and callback receipts) - blocks the Verified Paid ribbon.',
      'Human Testnet review and deployment of the contract - keeps signing switched off.',
    ],
    statusMatrix: 'Payment status matrix',
    statusMatrixBody: 'Every chain state, for the selected role and assurance, as the app would render it.',
    callerRole: 'Caller role',
    observationSource: 'Observation source',
    assurance: 'Assurance',
    mockPinned: 'A mock observation cannot claim verification, so assurance is pinned and every financial action is withheld.',
  },

  payment: {
    contractPaid: {
      label: 'Paid per contract',
      payer: 'The contract recorded this payment as paid to the recipient. A separately verified receipt is not available yet.',
      recipient: 'The contract recorded the transfer to your account as paid. A separately verified receipt is not available yet.',
      announce: 'Contract state says paid at a finalized block. Settlement receipt not independently verified yet.',
    },
    settlementProofPending:
      "This comes from the contract's state at a finalized block. A Verified Paid receipt also needs the funding, transfer and callback receipts checked. Open the receipt to check them.",
    setup: {
      notConfigured: {
        title: 'Payments are not set up',
        body: 'No Taply payments contract is configured for this build, so no request can be read, created or paid.',
      },
      invalidConfig: {
        title: 'Payments configuration is invalid',
        body: 'The contract account or its approved code hash is missing or malformed. Payments stay off rather than guess.',
      },
      chainUnavailable: {
        title: 'NEAR Testnet is unavailable',
        body: 'The chain configuration for this build is invalid, so nothing can be read.',
      },
      checking: 'Checking the payments contract…',
      rejected: {
        title: 'This contract is not approved for payments',
        body: 'The contract reported a configuration this app will not use (for example a test build or an unreviewed feature). Payments stay off.',
      },
      unreachable: {
        title: 'Could not check the payments contract',
        body: 'The contract configuration could not be read from a finalized block. Payments stay off until it can.',
      },
      codeMismatch: {
        title: 'Contract code does not match',
        body: 'The contract account is running different code from the approved version. Nothing from it is shown or signed.',
      },
      verifiedContract: 'Contract code hash checked at a finalized block',
    },
    signing: {
      flagOff: {
        title: 'Transactions are switched off',
        body: 'You can review everything, but signing stays off until the contract passes Testnet review. Nothing will be sent.',
      },
      unverified: {
        title: 'Contract not verified yet',
        body: 'Signing waits until the payments contract has been checked at a finalized block.',
      },
      noJournal: {
        title: 'This browser cannot keep a safety record',
        body: 'Local storage is unavailable, so an interrupted payment could not be tracked. Signing is disabled here.',
      },
      wrongAccount: {
        title: 'Different wallet account',
        body: 'Your wallet is connected as a different account from the one reviewed. Nothing was sent.',
      },
      rejected: {
        title: 'Declined in your wallet',
        body: 'You declined in your wallet. Nothing was sent.',
      },
      unknown: {
        title: 'Result unknown',
        body: 'Your wallet did not confirm what happened. We are checking the chain before anything else can be tried. Do not pay again.',
      },
      submitted: {
        title: 'Sent to NEAR Testnet',
        body: 'Your wallet returned a transaction. The status below comes only from the contract, read at a finalized block.',
      },
      blocked: {
        title: 'An earlier attempt is still unexplained',
        body: 'A previous attempt from this browser has not been resolved on chain yet. Wait for the status to update.',
      },
      mayReattempt: {
        title: 'Earlier attempt not seen on chain',
        body: 'The chain still shows no effect from your earlier attempt. You may review and try again: the contract accepts only one payment, and NEAR refunds a rejected duplicate deposit.',
      },
      reattempt: 'Review and try again',
      waitingForWallet: 'Waiting for your wallet…',
      transactionLabel: 'Transaction',
      viewTransaction: 'View transaction',
    },
    create: {
      connectFirst: 'Connect your Testnet wallet to create a request. You will be the recipient.',
      amountLabel: 'Amount (NEAR)',
      amountHint: 'Testnet NEAR only. Up to 24 decimal places.',
      memoLabel: 'Note (optional)',
      memoHint: 'Shown to the payer. Up to 256 bytes. Stored on chain and public.',
      payerLabel: 'Only this account may pay (optional)',
      payerHint: 'Leave empty to let anyone pay.',
      expiryLabel: 'Payable for',
      expiryHint: 'Measured in chain time from the latest finalized block.',
      expiry: { '15m': '15 minutes', '1h': '1 hour', '12h': '12 hours' },
      recipientLabel: 'Recipient',
      recipientIsYou: 'You (the connected account)',
      getQuote: 'Review request',
      quoting: 'Getting the contract quote…',
      quoteTitle: 'Check before you sign',
      storageBond: 'Storage bond',
      storageBondNote: 'Paid by you to store this request permanently on chain. It is not refunded, even if the request is cancelled.',
      gasLabel: 'Gas allowance',
      gasNote: 'Prepaid gas; unused gas is returned by NEAR. Your wallet shows the final fee.',
      requestIdLabel: 'Request ID',
      createInWallet: 'Create in wallet',
      edit: 'Edit',
      errors: {
        amount_required: 'Enter an amount.',
        amount_invalid: 'Use digits and one decimal point, with at most 24 decimal places.',
        amount_zero: 'The amount must be more than zero.',
        memo_too_long: 'The note is longer than 256 bytes.',
        payer_invalid: 'This is not a valid NEAR account ID.',
        payer_is_recipient: 'The payer cannot be you.',
      },
      quoteFailed: {
        title: 'The contract did not accept these terms',
        body: 'The quote could not be read from a finalized block, or the contract rejected the terms. Nothing was signed.',
      },
      nonceConsumed: {
        title: 'This request already exists',
        body: 'The contract already has a request with this ID. Open it instead of creating another.',
      },
      pendingDraft: {
        title: 'A request you started is still unconfirmed',
        body: 'Your wallet did not confirm an earlier request. Resume it with the same terms; no new request is created while this one is unexplained.',
      },
      resumeDraft: 'Resume this request',
      discardDraft: 'Discard and start over',
      created: 'Request created on chain',
    },
    share: {
      title: 'Share this request',
      body: 'Anyone with the link can view it. Only the permitted payer, or anyone if none is set, can pay it.',
      linkLabel: 'Payment link',
      copyLink: 'Copy link',
      linkCopied: 'Link copied',
      share: 'Share',
      qrLabel: 'QR code for the payment link',
      qrNote: "The QR code contains exactly the link above. The payer's app reads the amount and recipient from the contract, not from the code.",
    },
    review: {
      title: 'Review payment',
      intro: 'These terms come from the contract at a finalized block. Check them before you approve in your wallet.',
      recipient: 'Pay to',
      amount: 'Amount',
      exactBaseUnits: 'Exact amount in yoctoNEAR',
      memo: 'Note',
      noMemo: 'No note',
      permittedPayer: 'Who may pay',
      anyPayer: 'Anyone',
      expires: 'Payable until (chain time)',
      contract: 'Payments contract',
      attachExactly: 'Your wallet will attach exactly this amount. Gas is charged separately.',
      gasSeparate: 'Gas allowance (separate from the amount)',
      confirmCheck: 'I checked the recipient account and the amount.',
      approveInWallet: 'Approve in wallet',
      connectToPay: 'Connect your wallet to pay this request.',
      notPermittedPayer: {
        title: 'Your account may not pay this request',
        body: 'The recipient limited this request to another account. The contract would reject your payment.',
      },
      payingYourself: {
        title: 'You are the recipient',
        body: 'This request pays your own account. Share it with the payer instead.',
      },
      balanceLow: {
        title: 'Balance may be too low',
        body: 'Your verified balance is less than the amount plus gas. Your wallet may reject the transaction.',
      },
      expired: {
        title: 'This request expired',
        body: 'Its payment window ended in chain time. It can no longer be paid.',
      },
    },
    status: {
      refresh: 'Check chain status',
      refreshing: 'Checking…',
      checkedAt: 'Checked {time}',
      observedBlock: 'Finalized block #{height}',
      autoRefresh: 'Updates automatically while the payment is in progress.',
      inFlightNote: 'The contract has started the transfer. It can stay in this state if the callback did not finish. Do not pay again.',
      unresolved: {
        title: 'Transfer unresolved',
        body: 'This transfer has been in progress for a long time. The money stays reserved by the contract. It cannot be retried or paid again from here.',
      },
      failedRecipient: 'The transfer to your account failed and was recorded. The amount is held by the contract. You can retry the same transfer.',
      failedPayer: 'The transfer to the recipient failed and was recorded. The amount is held by the contract. Only the recipient can retry it.',
      retryInWallet: 'Retry transfer in wallet',
      retryNote: 'Sends the same amount to the same account. Costs 1 yoctoNEAR plus gas.',
      cancelInWallet: 'Cancel request in wallet',
      cancelNote: 'Only possible while unpaid. Costs 1 yoctoNEAR plus gas. The storage bond is not refunded.',
      cancelConfirm: 'Yes, cancel this unpaid request',
      notFound: {
        title: 'No such request',
        body: 'The contract has no request with this ID at the latest finalized block.',
      },
      wrongContract: {
        title: 'Request belongs to another contract',
        body: 'These terms name a different payments contract. Nothing is shown or signed.',
      },
      inconsistent: {
        title: 'Inconsistent contract answer',
        body: "The contract's answer did not pass validation. Nothing is shown or signed.",
      },
      readFailed: {
        title: 'Could not read the request',
        body: 'The status could not be read from a finalized block. This is not a payment failure.',
      },
      invalidId: {
        title: 'Not a request link',
        body: 'This link does not contain a valid request ID.',
      },
      yourAttempts: 'Your attempts from this browser',
      fundedAt: 'Funded (chain time)',
      payerLabel: 'Paid by',
      operationLabel: 'Transfer attempt',
      attemptResolved: 'Explained by the chain',
      operationStatus: { IN_FLIGHT: 'in progress', FAILED: 'failed, recorded', SUCCEEDED: 'succeeded per contract' },
    },
    receipt: {
      factsTitle: 'Contract terminal facts',
      factsNote: 'Recorded by the contract and read at a finalized block. This is not an independently verified receipt and not proof of finality.',
      notTerminal: {
        title: 'No receipt yet',
        body: 'The contract only issues terminal facts once a request is paid or cancelled.',
      },
      terminalBlock: 'Recorded at block',
      terminalAt: 'Recorded at (chain time)',
      cancelledNothingPaid: 'Cancelled before payment. Nothing was paid.',
      payoutConfirmedByContract: 'Payout confirmed by the contract callback',
      backToPayment: 'Back to payment',
    },
    verification: {
      checking: 'Checking the funding, transfer and callback receipts on chain',
      verifiedNote:
        'Checked at FINAL: the payer funded exactly this amount, the contract sent it to the recipient, and the contract callback confirmed it, all under the approved contract code. Trust model: the RPC provider below, not a light client.',
      unavailable: {
        title: 'Verification not available',
        body: 'This build cannot check settlement receipts, so it shows the contract state only.',
      },
      missingReference: {
        title: 'Settlement proof not available on this device',
        body: 'Verifying needs the transaction hashes, which this device does not have. Open the verification link from the payer’s receipt. Do not pay again.',
      },
      failedTransient: {
        title: 'Could not verify yet',
        body: 'The receipts could not be checked right now. This does not mean the payment failed. Do not pay again.',
      },
      historyUnavailable: {
        title: 'History not available from this RPC',
        body: 'This payment is older than the RPC keeps. Verifying it needs an archival RPC. Do not pay again.',
      },
      failedMismatch: {
        title: 'Receipt evidence does not match',
        body: 'The chain evidence did not pass verification, so this is not a Verified Paid receipt. Do not pay again. Keep the transaction hashes and contact support.',
      },
      reasonCode: 'Reason code',
      checkAgain: 'Check again',
      copyLink: 'Copy verification link',
      linkCopied: 'Link copied',
      linkNote: 'The link holds only public transaction hashes. Anyone can use it to re-check this receipt.',
      copyEvidence: 'Copy receipt evidence (JSON)',
      evidenceCopied: 'Evidence copied',
      fundingTx: 'Funding transaction',
      settlementTx: 'Payout transaction',
      transferReceipt: 'Transfer receipt',
      callbackReceipt: 'Callback receipt',
      stateBlock: 'Contract state block',
      provider: 'Checked via RPC',
    },
  },

  experience: {
    paymentRequest: 'Payment request',
    requesting: 'Requesting',
    youArePaying: 'You are paying',
    to: 'To',
    from: 'From',
    scanToPay: 'Scan to pay with any NEAR Testnet wallet',
    validUntil: 'Valid until',
    testFunds: 'Test funds only',
    instantPay: 'Instant Pay',
    yourAccount: 'Your account',
    progress: {
      title: 'Payment progress',
      stages: {
        awaiting: { title: 'Awaiting payment', body: 'Nothing has been paid yet. Share the link or QR code.' },
        wallet: { title: 'Approve in your wallet', body: 'Your wallet is open. Nothing moves until you approve there.' },
        transfer: {
          title: 'Transfer in progress',
          body: 'The payment reached the contract, which is sending it to the recipient. Not confirmed yet.',
        },
        contract_paid: {
          title: 'Paid per contract',
          body: 'The contract recorded the payout. The independent receipt check has not run on this screen.',
        },
        verified: {
          title: 'Verified Paid',
          body: 'Funding, transfer and confirmation receipts were checked on chain.',
        },
        failed: {
          title: 'Transfer failed — recoverable',
          body: 'The transfer did not go through. The contract holds the funds and the recipient can retry. Do not pay again.',
        },
        unresolved: {
          title: 'Transfer unresolved',
          body: 'The result could not be confirmed. Do not pay again. Keep the transaction reference.',
        },
        cancelled: { title: 'Cancelled', body: 'This request was cancelled before anyone paid.' },
      },
      steps: {
        created: 'Request created',
        approved: 'Approved in wallet',
        transfer: 'Transfer sent',
        contract: 'Confirmed by contract',
        verified: 'Independently verified',
      },
      stepState: { done: 'done', current: 'in progress', todo: 'not yet', failed: 'needs attention' },
      observedNote: 'Contract state is shown here. Verified Paid needs the receipt check.',
      openReceipt: 'Open receipt to verify',
      contractStatus: 'Contract status',
    },
    receipt: {
      verified: 'Verified Paid',
      verifiedSub: 'Checked against on-chain receipts',
      contractPaid: 'Paid per contract',
      contractPaidSub: 'Independent receipt check pending',
      cancelled: 'Cancelled',
      cancelledSub: 'Nothing was paid',
      paidTo: 'Paid to',
      paidBy: 'Paid by',
      settledAt: 'Settled (chain time)',
      memo: 'Note',
      references: 'On-chain references',
      checkedBy: 'Checked via',
    },
    review: {
      networkFee: 'Network fee',
      networkFeeValue: 'Paid as gas in your wallet. Taply adds no fee.',
      walletAction: 'Wallet action',
      walletActionValue: 'Send exactly this amount to the payment contract',
      contract: 'Payment contract',
    },
    create: {
      amountPlaceholder: '0',
      options: 'Options',
    },
    home: {
      tourEyebrow: 'Product tour',
      tourTitle: 'See a full payment in 60 seconds',
      tourBody: 'Request, share, pay and verify with demo data. No wallet needed.',
      tourCta: 'Start the tour',
      scan: 'Scan',
    },
    demo: {
      badge: 'DEMO',
      title: 'Taply in 60 seconds',
      intro:
        'These are the real Taply screens filled with demo data. No wallet opens, nothing is signed and nothing touches the chain.',
      synthetic: 'Demo data. Not a Testnet payment.',
      stepOf: 'Step {n} of {total}',
      progressLabel: 'Tour progress',
      steps: {
        home: { title: 'Your wallet', caption: 'Your account, your balance and three actions: send, receive and request.' },
        create: { title: 'Create a request', caption: 'Type an amount. You are the recipient, so nobody can swap the payee.' },
        share: { title: 'Share it', caption: 'One link and one QR code. The payer needs nothing but a NEAR wallet.' },
        review: {
          title: 'Payer reviews',
          caption: 'Full recipient, exact amount, network and the wallet action, before anything is signed.',
        },
        progress: {
          title: 'Watch it settle',
          caption: 'Each state is shown as it is. Observed is never presented as verified.',
        },
        receipt: { title: 'Verified receipt', caption: 'Verified Paid only when receipts on chain prove it.' },
      },
      next: 'Next',
      back: 'Back',
      restart: 'Start over',
      approveDemo: 'Approve in wallet (demo)',
      createDemo: 'Create request (demo)',
      approveNote: 'In the demo this only moves the tour forward. In the app your own wallet opens and you approve there.',
      play: 'Play',
      pause: 'Pause',
      showState: 'Show state',
      explorerNote: 'Explorer links appear on real receipts.',
      evidenceNote: 'Demo receipt: illustrates the layout. Real Verified Paid receipts come only from the on-chain check.',
      balanceLabel: 'Demo balance',
      reviewerTitle: 'For reviewers: every payment state',
      reviewerBody: 'The full status matrix, for every role and assurance level.',
      reviewerShow: 'Show the matrix',
      reviewerHide: 'Hide the matrix',
      openOnPhone: 'Scan to open this tour on your phone',
    },
  },

  walletUx: {
    kind: {
      external: 'External wallet',
      externalVia: 'Connected through {wallet}',
      externalKeys: 'Your keys stay in {wallet}. Taply only asks it to approve.',
      native: 'Taply Wallet',
      nativeKeys: 'Keys protected on this device',
    },
    onboarding: {
      eyebrow: 'Welcome to Taply',
      title: 'Your wallet. Your payment. One tap.',
      subtitle: 'Connect a NEAR Testnet wallet to see your balance and to send, receive and request payments.',
      connect: { title: 'Connect existing wallet', body: 'Use a NEAR Testnet wallet you already have. Taply never sees your keys.' },
      create: { title: 'Create Taply Wallet', body: 'A wallet that lives in Taply, protected on this device.' },
      restore: { title: 'Restore Taply Wallet', body: 'Bring an existing Taply Wallet to this device.' },
      unlock: { title: 'Unlock Taply Wallet', body: 'Unlock the Taply Wallet saved on this device.' },
      works: 'Available',
      notYet: 'Not available yet',
      notYetBody:
        'Taply Wallet needs reviewed, secure key storage before it can hold keys, so it is switched off in this build. Connect an existing wallet to use Taply today.',
      tour: 'See the design in the tour',
      connectInstead: 'Connect an existing wallet',
      lockedTitle: 'Wallet locked',
      lockedBody: 'Unlock to see your balance and approve payments.',
      openWallet: 'Wallet and account',
    },
    home: {
      totalBalance: 'Testnet balance',
      manage: 'Manage',
      activityTitle: 'Recent activity',
      activityScope: 'Payments started in this browser. The status page shows what the chain says.',
      activityEmptyTitle: 'No payments yet',
      activityEmptyBody: 'Requests you create and payments you approve in this browser appear here.',
      explorer: 'Full history on the explorer',
    },
    activity: {
      method: {
        create_request: 'Payment request',
        pay_instant_native: 'Payment',
        retry_native_transfer: 'Payout retry',
        cancel_unfunded: 'Request cancelled',
      },
      phase: {
        AWAITING_SIGNATURE: 'Waiting for wallet',
        USER_REJECTED: 'Declined',
        OUTCOME_UNKNOWN: 'Result unknown',
        SUBMITTED: 'Submitted',
        RESOLVED: 'Checked on chain',
      },
      open: 'Open status',
    },
    send: {
      subtitle: 'Send NEAR Testnet to another account.',
      preview: {
        title: 'Sending is in preview',
        body: 'You can prepare and review a transfer. Confirming stays off until the wallet signer for direct transfers is ready and approved.',
      },
      recipientLabel: 'To',
      recipientPlaceholder: 'name.testnet',
      recipientHint: 'The full NEAR Testnet account ID',
      recipientChecking: 'Checking the account on NEAR Testnet…',
      recipientFound: 'Account exists on NEAR Testnet',
      recipientMissing: 'This account does not exist on NEAR Testnet',
      recipientMainnet: 'This looks like a mainnet account. Taply only sends on NEAR Testnet.',
      recipientInvalid: 'Not a valid NEAR account ID',
      recipientSelf: 'This is your own account',
      recipientUnchecked: 'The account could not be checked right now',
      amountLabel: 'Amount',
      available: 'Available: {amount}',
      availableUnknown: 'Balance not available right now',
      insufficient: 'More than your available balance',
      amountInvalid: 'Enter an amount like 1.5',
      review: 'Review',
      edit: 'Edit',
      reviewTitle: 'Review transfer',
      youSend: 'You are sending',
      walletAction: 'Wallet action',
      walletActionValue: 'Direct NEAR transfer to the recipient',
      feeValue: 'Paid as gas in your wallet. Taply adds no fee.',
      confirm: 'Confirm and send',
      confirmUnavailable: 'Confirming is unavailable: the signer for direct transfers is not ready yet and signing is switched off. Nothing will be sent.',
      connectFirst: 'Connect your Testnet wallet to send.',
      status: {
        pending: { title: 'Sending', body: 'Waiting for NEAR Testnet to finalize. Do not send again.' },
        success: { title: 'Sent', body: 'The transfer reached the recipient on NEAR Testnet.' },
        failed: { title: 'Transfer failed', body: 'Nothing was sent. You can review and try again.' },
        unknown: { title: 'Result unknown', body: 'Your wallet did not report a result. Check the explorer before sending again.' },
      },
      sendAnother: 'Send another',
    },
    receive: {
      subtitle: 'Share your account to receive NEAR Testnet.',
      ticketTitle: 'My NEAR Testnet account',
      copy: 'Copy account ID',
      copied: 'Account ID copied',
      share: 'Share',
      networkWarning: {
        title: 'NEAR Testnet only',
        body: 'Only send NEAR Testnet tokens to this account. Mainnet NEAR, other networks and other tokens will not arrive here.',
      },
      qrNote: 'This QR code contains your account ID only, never an amount.',
      requestInstead: 'Ask for an exact amount',
    },
    demo: {
      receive: { title: 'Receive', caption: 'Your account as a QR code, with a clear Testnet-only warning.' },
      send: { title: 'Send', caption: 'Recipient checked, balance shown, exact amount reviewed before your wallet signs.' },
      confirmDemo: 'Confirm and send (demo)',
      conceptNote: 'Demo data. The real Taply Wallet lives on your device; its sending stays off until separately approved.',
      showResult: 'Show result',
    },
  },

  walletNative: {
    switchLabel: 'Active wallet',
    external: 'External wallet',
    taply: 'Taply Wallet',
    switchNote: 'Instant Pay requests and payments always use your external wallet until Taply Wallet signing is approved.',
    unavailable: {
      title: 'Taply Wallet is not available in this browser',
      body: 'It needs a secure (HTTPS) page with modern Web Crypto and Web Locks. Use an external wallet instead.',
    },
    intro: {
      title: 'Taply Wallet',
      body: 'A NEAR Testnet wallet whose key is generated and encrypted on this device. Only you can unlock it.',
    },
    point1: 'NEAR Testnet only. Never use it for real funds.',
    point2: 'Encrypted with your passphrase on this device. Taply has no copy and cannot reset it.',
    point3: 'Sending and paying from Taply Wallet stay switched off until separately approved.',
    create: 'Create Taply Wallet',
    restore: 'Restore from encrypted backup',
    identityLabel: 'Account ID (implicit)',
    status: {
      checking: 'Checking NEAR Testnet…',
      localOnly: {
        title: 'Local only — not on NEAR Testnet',
        body: 'This identity exists only on this device. There is no NEAR Testnet account for it yet, so it has no balance.',
      },
      provisioned: {
        title: 'Active on NEAR Testnet',
        body: 'The account exists on NEAR Testnet and holds this wallet’s key.',
      },
      unknown: { title: 'Status unknown', body: 'NEAR Testnet could not be reached to check this account. Try again.' },
    },
    lock: {
      locked: 'Locked',
      unlocked: 'Unlocked',
      unlockTitle: 'Unlock Taply Wallet',
      unlock: 'Unlock',
      unlocking: 'Unlocking…',
      lockNow: 'Lock now',
      passphrase: 'Passphrase',
      autoLock: 'Locks automatically after 5 minutes, or when you leave or hide the page.',
    },
    backup: {
      title: 'Back up your wallet now',
      body: 'You need BOTH the backup file and your passphrase to recover this wallet. Taply cannot recover it for you.',
      fileWarning: 'The backup is encrypted, but anyone with the file can try to guess your passphrase offline. Keep it private and never share it.',
      download: 'Download encrypted backup',
      downloaded: 'Backup downloaded',
      confirm: 'I saved the encrypted backup and I will remember my passphrase.',
      finish: 'Finish',
      required: 'Download the backup to continue.',
    },
    createFlow: {
      title: 'Create Taply Wallet',
      stepOf: 'Step {n} of 3',
      understandTitle: 'Before you start',
      ack1: 'I understand Taply Wallet is for NEAR Testnet only.',
      ack2: 'I understand Taply cannot recover or reset my passphrase.',
      ack3: 'I understand sending and paying from Taply Wallet are switched off for now.',
      continue: 'Continue',
      back: 'Back',
      passTitle: 'Choose a strong passphrase',
      passLabel: 'Passphrase',
      passHint: 'At least 16 characters. Several unrelated words work well. Do not reuse a password.',
      confirmLabel: 'Repeat passphrase',
      show: 'Show',
      hide: 'Hide',
      mismatch: 'The passphrases do not match.',
      tooShort: 'Use at least 16 characters.',
      tooLong: 'This passphrase is too long.',
      strengthLabel: 'Strength',
      strength: { weak: 'Weak', fair: 'Fair', strong: 'Strong', excellent: 'Very strong' },
      creating: 'Creating and encrypting on this device…',
      createButton: 'Create wallet',
      createdTitle: 'Wallet created and locked',
      createdBody: 'Your new identity is local only until it receives its first NEAR Testnet transfer.',
    },
    restoreFlow: {
      title: 'Restore Taply Wallet',
      body: 'Choose your encrypted backup file and enter its passphrase. The wallet is restored locked.',
      file: 'Backup file',
      paste: 'Or paste the backup',
      restoring: 'Restoring…',
      restoreButton: 'Restore wallet',
      restored: 'Wallet restored. Unlock it to use it.',
    },
    errors: {
      BAD_PASSWORD_OR_DATA: 'Wrong passphrase, or the backup is damaged.',
      PASSWORD_POLICY: 'The passphrase must be at least 16 characters.',
      ALREADY_EXISTS: 'A Taply Wallet already exists on this device.',
      INVALID_RECORD: 'This is not a valid Taply Wallet backup.',
      STORAGE_UNAVAILABLE: 'This browser’s storage is unavailable.',
      CRYPTO_UNAVAILABLE: 'This browser does not support the required cryptography.',
      CANCELLED: 'The operation was interrupted. Try again.',
      LOCKED: 'Unlock the wallet first.',
      ACCOUNT_NOT_PROVISIONED: 'This wallet is not active on NEAR Testnet yet.',
      INVALID_ADDRESS: 'Enter a NEAR Testnet account: name.testnet or a 64-character implicit ID.',
      INVALID_AMOUNT: 'Enter an amount like 0.5.',
      INSUFFICIENT_AVAILABLE_BALANCE: 'More than the available balance after reserves.',
      NETWORK_MISMATCH: 'The connected RPC is not NEAR Testnet.',
      RPC_UNAVAILABLE: 'NEAR Testnet could not be reached.',
      UNAVAILABLE: 'Not available in this browser.',
      UNKNOWN: 'Something went wrong. Nothing was sent.',
    },
    send: {
      notActive: {
        title: 'Taply Wallet is not active on NEAR Testnet',
        body: 'A local-only identity has no account and no balance, so it cannot send. Switch to your external wallet to send today.',
      },
      available: 'Available after reserves',
      storageReserve: 'Storage reserve',
      gasReserve: 'Gas reserve (not a fee)',
      signingOff: 'Taply Wallet signing is switched off until a reviewed signer is separately approved. Nothing will be sent.',
      preparing: 'Checking the receiver and your balance on NEAR Testnet…',
    },
    home: {
      noBalance: 'No balance: not on NEAR Testnet yet',
      lockedHint: 'Unlock to use this wallet.',
    },
    receive: {
      localOnlyNote: 'This address has no NEAR Testnet account yet. Its first incoming NEAR Testnet transfer creates the account.',
    },
    nativeChip: 'Testnet · sending off',
    paymentsNote: 'Instant Pay uses your external wallet.',
    createdAlready: 'A Taply Wallet already exists on this device.',
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
