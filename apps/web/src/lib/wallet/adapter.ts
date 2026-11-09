/**
 * Wallet adapter boundary.
 *
 * The rest of the app talks to this interface, never to a wallet SDK directly,
 * so the SDK can be swapped and the UI can be tested with a fake.
 *
 * What a connected session means - and does not mean:
 *  - The wallet REPORTED this account ID. Nothing has been signed yet, so this
 *    is not proof of key ownership (that arrives later with NEP-413, owned by
 *    the API). It is enough to read a public balance; it is never enough to
 *    authorise anything.
 *  - The external connector holds no keys in Taply. The separate experimental
 *    Taply-local controller uses an encrypted, explicitly unlocked vault and is
 *    never automatically substituted for the external connector. Its signing
 *    path stays disabled pending independent SDK integration/security approval.
 */

export interface WalletSession {
  readonly accountId: string;
  readonly walletId: string;
  readonly walletName: string;
}

export type WalletErrorKind =
  /** The person closed the wallet picker or declined in the wallet. */
  | 'cancelled'
  /** The wallet list could not be loaded or no Testnet wallet is available. */
  | 'unavailable'
  /** The wallet returned no account, or an unusable account ID. */
  | 'no_account'
  /** Anything else. Never retried automatically. */
  | 'failed';

export class WalletError extends Error {
  readonly kind: WalletErrorKind;
  constructor(kind: WalletErrorKind, options?: { cause?: unknown }) {
    super(`wallet:${kind}`, options);
    this.name = 'WalletError';
    this.kind = kind;
  }
}

/** Local control-flow evidence: throw only before invoking a signing SDK.
 * SDK exceptions must never be converted into this type after dispatch. */
export class WalletNotDispatchedError extends WalletError {
  constructor() {
    super('no_account');
    this.name = 'WalletNotDispatchedError';
  }
}

/**
 * One contract call, exactly as `@taply/near-client` prepared it. The adapter
 * passes it to the wallet unchanged; the person approves or declines there.
 */
export interface WalletCall {
  readonly receiverId: string;
  readonly methodName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly gas: string;
  readonly depositYocto: string;
  /**
   * Optional: the COMPLETE ordered list of function calls of one transaction to
   * `receiverId` (e.g. register + wrap + swap). When present it replaces the single
   * call above, and its first entry must equal it. Payment calls never use this.
   */
  readonly actions?: ReadonlyArray<{
    readonly methodName: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly gas: string;
    readonly depositYocto: string;
  }>;
}

/**
 * What a wallet reported after a signing request. Neither variant means the call
 * succeeded: only a finalized chain read can say that.
 *  - submitted: the wallet returned a transaction hash.
 *  - unknown:   anything else after dispatch. The transaction
 *               may or may not have been broadcast, so the caller must reconcile
 *               with the chain and must not offer a blind retry.
 * No external SDK cancellation signal currently proves absence of broadcast.
 */
export type SignOutcome =
  | { readonly kind: 'submitted'; readonly transactionHash: string }
  | { readonly kind: 'unknown'; readonly transactionHash?: string };

const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Pulls a transaction hash out of a wallet's (untyped) final outcome, or null. */
export function transactionHashOf(outcome: unknown): string | null {
  // Some wallets answer a single-transaction request with a one-item list.
  if (Array.isArray(outcome)) return outcome.length === 1 ? transactionHashOf(outcome[0]) : null;
  if (typeof outcome !== 'object' || outcome === null) return null;
  const record = outcome as Record<string, unknown>;
  const tx = record['transaction'];
  const fromTx = typeof tx === 'object' && tx !== null ? (tx as Record<string, unknown>)['hash'] : undefined;
  const txOutcome = record['transaction_outcome'];
  const fromOutcome =
    typeof txOutcome === 'object' && txOutcome !== null ? (txOutcome as Record<string, unknown>)['id'] : undefined;
  for (const candidate of [fromTx, fromOutcome]) {
    if (typeof candidate === 'string' && TX_HASH.test(candidate)) return candidate;
  }
  return null;
}

export interface WalletAdapter {
  /** Restores a session the wallet still considers connected, or null. Never opens UI. */
  restore(): Promise<WalletSession | null>;
  /** Opens the wallet picker. Resolves with the session or rejects with WalletError. */
  connect(): Promise<WalletSession>;
  disconnect(): Promise<void>;
  /** Wallet-initiated changes (sign-out in the wallet, account switch). */
  subscribe(listener: (session: WalletSession | null) => void): () => void;
  /**
   * Asks the connected wallet to sign and send ONE function call as
   * `signerAccountId`. Only a local pre-dispatch account check may throw
   * WalletNotDispatchedError. All failures after SDK invocation are unknown.
   */
  signAndSendTransaction(signerAccountId: string, call: WalletCall): Promise<SignOutcome>;
}

/**
 * Connection UI classification only (picker closed, no account, no wallet).
 * Never use it for signing: message text cannot prove a transaction was not
 * broadcast, so `submitCall` and the signing adapter do not call it (F-01).
 */
export function classifyWalletError(cause: unknown): WalletErrorKind {
  if (cause instanceof WalletError) return cause.kind;
  const message = (cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '').toLowerCase();
  if (/reject|cancel|denied|declin|closed|abort/.test(message)) return 'cancelled';
  if (/no accounts?|failed to sign in/.test(message)) return 'no_account';
  if (/manifest|not found|no wallet/.test(message)) return 'unavailable';
  return 'failed';
}
