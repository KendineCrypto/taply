import type { PaymentDetail, PaymentState } from '@/lib/mainnet/status';

/**
 * Mainnet-only copy (English). Kept apart from the Testnet dictionaries so the
 * Testnet build's text is untouched. Every screen states: NEAR Mainnet, real
 * funds, unaudited candidate, capped.
 */
export interface MainnetCopy {
  readonly network: {
    readonly pill: string;
    readonly pillAria: string;
    readonly banner: string;
    readonly capLine: string;
    readonly capShort: string;
    readonly signingOn: string;
    readonly noGo: string;
    readonly fixtureBanner: string;
  };
  readonly home: {
    readonly title: string;
    readonly lead: string;
    readonly merchantCta: string;
    readonly merchantHint: string;
    readonly payCta: string;
    readonly payHint: string;
    readonly payPlaceholder: string;
    readonly payOpen: string;
    readonly payInvalid: string;
    readonly fixturesTitle: string;
    readonly fixturesHint: string;
    readonly contractTitle: string;
    readonly contractNotConfigured: string;
    readonly contractInvalid: string;
    readonly contractConfigured: string;
    readonly configBroken: string;
  };
  readonly wallet: {
    readonly connect: string;
    readonly connecting: string;
    readonly disconnect: string;
    readonly connectedAs: string;
    readonly notConnected: string;
    readonly unavailable: string;
    readonly failed: string;
    readonly rejected: string;
    readonly testnetAccount: string;
    readonly signingDisabled: string;
  };
  readonly create: {
    readonly title: string;
    readonly lead: string;
    readonly assetLabel: string;
    readonly amountLabel: string;
    readonly memoLabel: string;
    readonly memoHint: string;
    readonly receiveTo: string;
    readonly receiveToFixed: string;
    readonly connectFirst: string;
    readonly fixtureMerchant: string;
    readonly capNote: string;
    readonly storageTitle: string;
    readonly storageFixture: string;
    readonly storageQuote: string;
    readonly storageUnknown: string;
    readonly expiry: string;
    readonly errors: Readonly<Record<'invalid' | 'precision' | 'zero' | 'cap', string>>;
    readonly usdcRegTitle: string;
    readonly usdcRegistered: string;
    readonly usdcNotRegistered: string;
    readonly usdcRegUnknown: string;
    readonly usdcRegCta: string;
    readonly review: string;
    readonly reviewTitle: string;
    readonly saleTitle: string;
    readonly saleFreeze: { readonly frozen: string; readonly gated: string; readonly unavailable: string; readonly mismatch: string };
    readonly saleHelp: string;
    readonly saleBindError: string;
    readonly callTitle: string;
    readonly sign: string;
    readonly back: string;
  };
  readonly pay: {
    readonly title: string;
    readonly notFound: string;
    readonly loading: string;
    readonly readError: string;
    readonly merchant: string;
    readonly amount: string;
    readonly memo: string;
    readonly expires: string;
    readonly contract: string;
    readonly requestId: string;
    readonly fixedNote: string;
    readonly methodTitle: string;
    readonly methodBase: string;
    readonly methodBaseHint: string;
    readonly methodWallet: string;
    readonly methodWalletHint: string;
    readonly methodNativeOnly: string;
    readonly routerDisabled: string;
    readonly notPayable: string;
  };
  readonly intents: {
    readonly title: string;
    readonly lead: string;
    readonly sourceLabel: string;
    readonly sourceBaseUsdc: string;
    readonly refundLabel: string;
    readonly refundHint: string;
    readonly refundErrors: Readonly<Record<'format' | 'checksum' | 'forbidden', string>>;
    readonly prepare: string;
    readonly preparing: string;
    readonly reviewTitle: string;
    readonly youSend: string;
    readonly merchantGets: string;
    readonly toContract: string;
    readonly deadline: string;
    readonly estimate: string;
    readonly refundTo: string;
    readonly verifiedLine: string;
    readonly depositHidden: string;
    readonly depositHiddenDetail: string;
    readonly fixtureQuote: string;
    readonly dryQuote: string;
    readonly reused: string;
    readonly expired: string;
    readonly remaining: string;
    readonly feeNote: string;
    readonly originNotVerified: string;
    readonly errors: Readonly<Record<string, string>>;
    readonly errorFallback: string;
  };
  readonly status: {
    readonly title: string;
    readonly states: Readonly<Record<PaymentState, string>>;
    readonly details: Readonly<Record<PaymentDetail, string>>;
    readonly doNotRepay: string;
    readonly verifiedUnavailable: string;
    readonly recordedLimit: string;
    readonly hintLabel: string;
    readonly hintNone: string;
    readonly contractLabel: string;
    readonly lastChecked: string;
    readonly refresh: string;
    readonly originTx: string;
    readonly nearTx: string;
    readonly viewContract: string;
    readonly refundAddress: string;
    readonly refundedAmount: string;
  };
}

export const mainnetEn: MainnetCopy = {
  network: {
    pill: 'NEAR Mainnet',
    pillAria: 'Network: NEAR Mainnet. Real funds. Unaudited candidate, capped.',
    banner: 'NEAR Mainnet · real funds · unaudited candidate',
    capLine: 'Capped at 1 NEAR or 25 USDC per request by the contract.',
    capShort: 'max 1 NEAR / 25 USDC',
    noGo: 'Real-money payments are not enabled yet. You can review every step; nothing can be signed or funded.',
    signingOn: 'Sending is on (Taply Wallet). Keep this browser\'s data.',
    fixtureBanner: 'FIXTURE DATA — not on chain. For testing the screens only.',
  },
  home: {
    title: 'Taply on NEAR Mainnet',
    lead: 'Your wallet, payments, merchant tools and gifts — together on Mainnet. Explore the development candidate; real-money signing remains disabled.',
    merchantCta: 'Create a request',
    merchantHint: 'For merchants: NEAR or USDC, fixed amount, your account receives it.',
    payCta: 'Pay a request',
    payHint: 'Paste a Taply mainnet link or request ID.',
    payPlaceholder: 'https://mainnet.taplyapp.xyz/m/pay/… or 64-character ID',
    payOpen: 'Open',
    payInvalid: 'That is not a Taply mainnet request link or ID.',
    fixturesTitle: 'Fixture scenarios',
    fixturesHint: 'Each opens a pay screen backed by fixture data, so every state can be checked without funds.',
    contractTitle: 'Contract',
    contractNotConfigured: 'No mainnet contract is pinned in this build. Chain reads are off.',
    contractInvalid: 'The configured contract is not an approved account with a valid code hash. Chain reads are off.',
    contractConfigured: 'Pinned contract {account}, code hash {hash}. Every read checks mainnet genesis and this hash at a final block.',
    configBroken: 'This mainnet build is misconfigured (RPC or explorer). It fails closed: nothing is read or signed.',
  },
  wallet: {
    connect: 'Connect NEAR wallet',
    connecting: 'Connecting…',
    disconnect: 'Disconnect',
    connectedAs: 'Connected: {account}',
    notConnected: 'No wallet connected.',
    unavailable: 'No mainnet wallet is available in this browser.',
    failed: 'The wallet could not connect. Nothing was signed.',
    rejected: 'You closed the wallet. Nothing was signed.',
    testnetAccount: 'That is a Testnet account. This is the NEAR Mainnet build.',
    signingDisabled: 'Signing is disabled on this build until the owner approves real-money release.',
  },
  create: {
    title: 'New mainnet request',
    lead: 'The amount and your receiving account are fixed in the request. Customers cannot change them.',
    assetLabel: 'Asset',
    amountLabel: 'Amount',
    memoLabel: 'Note (optional)',
    memoHint: 'Shown to the customer. Up to 256 bytes.',
    receiveTo: 'Paid to',
    receiveToFixed: 'The request pays only the account that creates it.',
    connectFirst: 'Connect the wallet that should receive the money.',
    fixtureMerchant: 'Previewing as the fixture merchant {account}.',
    capNote: 'Maximum {cap} per request.',
    storageTitle: 'Per-sale storage cost',
    storageFixture: '{amount} NEAR (fixture value from the sandbox; real requests use the contract quote).',
    storageQuote: '{amount} NEAR, kept by the contract permanently.',
    storageUnknown: 'Read from the contract before signing.',
    expiry: 'Open for 1 hour.',
    errors: {
      invalid: 'Enter an amount like 12.50.',
      precision: 'Too many decimal places for this asset.',
      zero: 'The amount must be more than zero.',
      cap: 'Above the per-request cap.',
    },
    usdcRegTitle: 'USDC registration',
    usdcRegistered: 'Your account is registered on USDC and can receive the payout.',
    usdcNotRegistered: 'Your account is not registered on USDC. The payout would fail until you register.',
    usdcRegUnknown: 'Registration is checked against the USDC contract before signing.',
    usdcRegCta: 'Register on USDC (storage deposit)',
    review: 'Review request',
    reviewTitle: 'Review',
    saleFreeze: { frozen: 'Frozen by the payment authority: this session can never carry other terms.', gated: 'Not frozen by the payment authority: wallet authorization stays disabled until the release review.', unavailable: 'Not frozen: the payment authority is not reachable from this build.', mismatch: 'The payment authority returned different terms. Do not use this sale.' },
    saleTitle: 'Sale commitment (this sale only)',
    saleHelp: 'Show this to the customer. Its link carries the sale commitment; the pay page refuses any request that does not match it.',
    saleBindError: 'This sale could not be bound (the note may be too long for the sale commitment). Shorten the note.',
    callTitle: 'Transaction your wallet would sign',
    sign: 'Sign with wallet',
    back: 'Back',
  },
  pay: {
    title: 'Pay',
    notFound: 'No request with this ID on the pinned contract.',
    loading: 'Reading the contract at a final block…',
    readError: 'Could not read the contract. Nothing is assumed; try again shortly.',
    merchant: 'Merchant receives',
    amount: 'Exact amount',
    memo: 'Note',
    expires: 'Open until',
    contract: 'Taply contract',
    requestId: 'Request ID',
    fixedNote: 'Account and amount come from the contract and cannot be changed here.',
    methodTitle: 'How do you want to pay?',
    methodBase: 'Pay from Base (USDC)',
    methodBaseHint: 'Send USDC on Base; NEAR Intents delivers exact USDC to the contract.',
    methodWallet: 'Pay with NEAR wallet',
    methodWalletHint: 'Sign one transaction from your NEAR account.',
    methodNativeOnly: 'This is a NEAR request. It can only be paid from a NEAR wallet.',
    routerDisabled: 'Cross-chain delivery is switched off on this contract (intentsRouter: false).',
    notPayable: 'This request is not open for payment.',
  },
  intents: {
    title: 'Pay from Base',
    lead: 'Taply asks NEAR Intents (1Click) for a signed quote that delivers exactly the requested USDC to the Taply contract.',
    sourceLabel: 'You pay with',
    sourceBaseUsdc: 'USDC on Base',
    refundLabel: 'Your Base refund address',
    refundHint: 'If anything fails, 1Click refunds your USDC here on Base. Use an address you control.',
    refundErrors: {
      format: 'Enter a Base address: 0x followed by 40 hex characters.',
      checksum: 'The capitalisation does not match the address checksum. Copy it again.',
      forbidden: 'That address cannot receive refunds.',
    },
    prepare: 'Get quote',
    preparing: 'Asking 1Click and checking the signature…',
    reviewTitle: 'Payment instructions',
    youSend: 'You send on Base',
    merchantGets: 'Merchant receives (exact)',
    toContract: 'Delivered to',
    deadline: 'Quote valid until',
    estimate: 'Estimated time',
    refundTo: 'Refunds go to',
    verifiedLine: 'Quote signature verified with the official 1Click key path; recipient, asset, amount and message match.',
    depositHidden: 'Deposit address withheld',
    depositHiddenDetail: 'Funded quotes are not approved for real money yet. Do not send anything.',
    fixtureQuote: 'FIXTURE quote, signed with a test key. Not a real 1Click quote.',
    dryQuote: 'Dry quote from 1Click: price check only, no deposit address.',
    reused: 'Showing the quote already prepared for this request.',
    expired: 'This quote has expired.',
    remaining: '{time} left',
    feeNote: 'The amount includes the 1Click slippage buffer; any unused part is refunded to your address.',
    originNotVerified: 'The Base leg is reported by 1Click and is not verified by Taply.',
    errors: {
      ONECLICK_DISABLED: 'Cross-chain payment is turned off on this build.',
      FUNDED_QUOTES_NOT_APPROVED: 'Funded quotes are not approved for real money yet.',
      CONTRACT_NOT_CONFIGURED: 'No mainnet contract is pinned on the server.',
      STORE_UNAVAILABLE: 'The quote service is unavailable.',
      INVALID_INPUT: 'Something in the request was not valid.',
      ORIGIN_NOT_ALLOWED: 'Only USDC on Base is accepted.',
      REFUND_ADDRESS_INVALID: 'The refund address is not valid.',
      CONTRACT_CONFIG_REJECTED: 'The contract configuration did not pass Taply checks. No quote was requested.',
      CHAIN_UNAVAILABLE: 'Could not read NEAR right now. No quote was requested.',
      REQUEST_NOT_FOUND: 'This request does not exist on the contract.',
      REQUEST_NOT_OPEN: 'This request is no longer open.',
      REQUEST_NOT_USDC: 'Only USDC requests can be paid from another chain.',
      REQUEST_NOT_INSTANT: 'Only instant requests can be paid from another chain.',
      REQUEST_PAYER_RESTRICTED: 'This request can only be paid by a specific NEAR account.',
      REQUEST_EXPIRES_TOO_SOON: 'The request expires too soon for a cross-chain payment.',
      AMOUNT_BELOW_MINIMUM: 'Cross-chain payments need at least 0.50 USDC.',
      CONTRACT_NOT_REGISTERED: 'The Taply contract is not registered on USDC.',
      MERCHANT_NOT_REGISTERED: 'The merchant is not registered on USDC, so the payout would fail.',
      ORIGIN_NOT_LISTED: '1Click no longer lists USDC on Base the way Taply expects.',
      ACTIVE_QUOTE_EXISTS: 'A quote with a different refund address is already active for this request.',
      PREVIOUS_QUOTE_IN_PROGRESS: 'An earlier payment for this request may still be in progress. Do not pay again.',
      QUOTE_LIMIT_REACHED: 'Too many quotes for this request.',
      BUSY: 'A quote is being prepared already. Wait a moment.',
      QUOTE_REJECTED: 'The quote from 1Click failed Taply verification and was discarded.',
      NO_QUOTE: 'No quote exists for this request yet.',
      STATUS_MISMATCH: 'The status from 1Click did not match this quote.',
      UPSTREAM_MIN_AMOUNT: '1Click says the amount is too small to bridge.',
      UPSTREAM_NO_LIQUIDITY: '1Click has no route for this amount right now.',
      UPSTREAM_UNAVAILABLE: '1Click is unavailable right now.',
      UPSTREAM_RATE_LIMITED: '1Click is busy. Try again shortly.',
      UPSTREAM_UNAUTHORIZED: 'The quote service is misconfigured.',
      UPSTREAM_BAD_REQUEST: '1Click refused the quote request.',
    },
    errorFallback: 'The quote could not be prepared.',
  },
  status: {
    title: 'Payment status',
    states: {
      AWAITING_PAYMENT: 'Awaiting payment',
      DEPOSIT_OBSERVED: 'Deposit observed',
      PROCESSING: 'Processing',
      PAYMENT_RECORDED: 'Payment recorded',
      VERIFIED: 'Independently verified',
      FAILED: 'Failed',
      REFUNDED: 'Refunded',
      UNKNOWN: 'Unknown — needs investigation',
    },
    details: {
      none: '',
      contract_unreadable: 'The contract could not be read. Nothing is assumed.',
      request_missing: 'The contract has no request with this ID.',
      oneclick_success_awaiting_contract: '1Click reports delivery. Waiting for the contract to record the payout.',
      payout_in_flight: 'The contract has started the payout to the merchant.',
      payout_in_flight_stale: 'The payout started but its result was never recorded (R-2). Funds are not lost; the owner must investigate. No automatic retry.',
      payout_failed_recoverable: 'The payout to the merchant failed and the contract holds the funds. Only the merchant can retry.',
      incomplete_deposit: 'Less than the quoted amount arrived. 1Click refunds it to your address.',
      cancelled: 'The merchant cancelled this request before payment.',
      delivery_after_close: 'Funds were delivered after the request closed. They are held by the contract for manual refund.',
      success_not_settled: '1Click reported delivery long ago but the contract never recorded a payout. The delivery may be held as unclaimed. Contact the merchant; do not pay again.',
      hint_contradicts_contract: 'The contract recorded the payout; 1Click reports otherwise. The contract state is shown.',
      contract_only: 'Recorded by the contract at a final block.',
    },
    doNotRepay: 'Do not pay again for this request.',
    verifiedUnavailable: 'Independent verification is not available on mainnet yet.',
    recordedLimit: '"Payment recorded" comes from contract state only, not from an independent receipt check.',
    hintLabel: 'Cross-chain hint (1Click)',
    hintNone: 'No cross-chain activity.',
    contractLabel: 'Contract status',
    lastChecked: 'Last checked {time}',
    refresh: 'Check again',
    originTx: 'Base transaction',
    nearTx: 'NEAR transaction',
    viewContract: 'View contract on nearblocks',
    refundAddress: 'Refund address',
    refundedAmount: 'Refunded',
  },
};
