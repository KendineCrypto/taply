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
 *  - Taply holds no keys. Sign-in requests no function-call access key, so no
 *    private key is created, stored or handled by this app (CLAUDE.md: "Do not
 *    invent own private-key storage").
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

export interface WalletAdapter {
  /** Restores a session the wallet still considers connected, or null. Never opens UI. */
  restore(): Promise<WalletSession | null>;
  /** Opens the wallet picker. Resolves with the session or rejects with WalletError. */
  connect(): Promise<WalletSession>;
  disconnect(): Promise<void>;
  /** Wallet-initiated changes (sign-out in the wallet, account switch). */
  subscribe(listener: (session: WalletSession | null) => void): () => void;
}

/**
 * Maps whatever a wallet SDK throws onto our four kinds. SDK messages are not
 * localised or stable, so they are matched loosely and never shown to people.
 */
export function classifyWalletError(cause: unknown): WalletErrorKind {
  if (cause instanceof WalletError) return cause.kind;
  const message = (cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '').toLowerCase();
  if (/reject|cancel|denied|declin|closed|abort/.test(message)) return 'cancelled';
  if (/no accounts?|failed to sign in/.test(message)) return 'no_account';
  if (/manifest|not found|no wallet/.test(message)) return 'unavailable';
  return 'failed';
}
