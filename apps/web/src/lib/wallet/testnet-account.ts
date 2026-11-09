/**
 * `username.testnet` onboarding helpers (owner decision 2026-11-09: no gasless,
 * Testnet only). Pure rules + the public NEAR Testnet faucet call.
 *
 * The faucet response is never treated as proof: the account counts as created
 * only after a FINAL chain read shows it holds the vault's key
 * (`WalletChain.provisioning`).
 */

/** Public NEAR Testnet helper. Creates a funded top-level `.testnet` account
 * (CORS allows browser calls; no secret, no Taply server). */
export const TESTNET_HELPER_ACCOUNT_URL = 'https://helper.testnet.near.org/account';
export const USERNAME_MIN = 2;
export const USERNAME_MAX = 40;
const SUFFIX = '.testnet';

export type UsernameProblem = 'too_short' | 'too_long' | 'invalid_chars' | 'bad_separator';

/** Lower-cases, trims and drops a typed `.testnet` suffix. Never changes other characters. */
export function normalizeUsername(input: string): string {
  const value = input.trim().toLowerCase();
  return value.endsWith(SUFFIX) ? value.slice(0, -SUFFIX.length) : value;
}

/**
 * NEAR account syntax for one name part: a-z, 0-9, and `_`/`-` only between
 * letters or digits. No dots: the account is always a direct `.testnet` name.
 */
export function usernameProblem(name: string): UsernameProblem | null {
  if (name.length < USERNAME_MIN) return 'too_short';
  if (name.length > USERNAME_MAX) return 'too_long';
  if (!/^[a-z0-9_-]+$/.test(name)) return 'invalid_chars';
  if (!/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(name)) return 'bad_separator';
  return null;
}

export function usernameAccountId(name: string): string {
  return `${name}${SUFFIX}`;
}

export type FaucetFailure = 'rate_limited' | 'rejected' | 'unavailable';
export type FaucetResult = { readonly ok: true } | { readonly ok: false; readonly reason: FaucetFailure };

/**
 * Asks the Testnet faucet to create `accountId` with `publicKey` as its full-access
 * key. Returns only a coarse outcome; response bodies are never shown or trusted.
 * A success here still does NOT mean the account exists.
 */
export async function requestTestnetAccount(
  accountId: string,
  publicKey: string,
  options: { readonly fetcher?: typeof fetch; readonly timeoutMs?: number } = {},
): Promise<FaucetResult> {
  const fetcher = options.fetcher ?? ((url, init) => globalThis.fetch(url, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const response = await fetcher(TESTNET_HELPER_ACCOUNT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    // Drain without reading into UI state.
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return { ok: true };
    if (response.status === 429) return { ok: false, reason: 'rate_limited' };
    if (response.status >= 400 && response.status < 500) return { ok: false, reason: 'rejected' };
    return { ok: false, reason: 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}
