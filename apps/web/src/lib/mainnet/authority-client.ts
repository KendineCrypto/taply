import { canonicalJson } from '@taply/shared';
import { authorizeMainnetNearConnectCommand, mainnetAuthorityMessageParameters } from '@taply/near-client';
import type {
  bindMainnetCommerceTerms,
  EncryptedMainnetVault,
  MainnetAuthorityCommand,
  MainnetSigningProfiles,
  MainnetWalletAuthority,
} from '@taply/near-client';

/**
 * Browser side of Codex's authenticated Mainnet wallet authority
 * (docs/MAINNET_SIGNING_AUTHORITY.md). Every command is one round trip:
 *   POST challenge {publicKey, command} → server-issued NEP-413 challenge
 *   → the wallet authorizes exactly that command (Codex's fixed-purpose
 *     EncryptedMainnetVault.authorizeAuthorityCommand / authorizeMainnetNearConnectCommand)
 *   → POST execute {id, command, signed} → result.
 *
 * It implements Codex's `MainnetWalletAuthority` so Codex's own backend and
 * coordinator logic run unchanged; this file holds no ledger, no CAS, no Redis,
 * no transaction builder and no raw-message signer. The device credential is the
 * server's HttpOnly cookie; the browser never sees it. Any failure — endpoint
 * missing (every production deployment: the route is not mounted), refusal,
 * policy mismatch, closed signing gate — throws, and callers fail closed.
 *
 * Kept free of app aliases so the Node integration test can import it directly.
 */
export const AUTHORITY_BASE = '/api/mainnet/authority';

export interface SignedAuthorization { readonly accountId: string; readonly publicKey: string; readonly signature: string }
export interface AuthoritySigner {
  readonly accountId: string;
  readonly publicKey: string;
  /** Must validate the challenge against the command and the LOCALLY computed policy hash before signing. */
  authorize(challenge: unknown, command: MainnetAuthorityCommand, policyHash: string): Promise<SignedAuthorization>;
}

export type AuthorityErrorCode = 'AUTHORITY_UNAVAILABLE' | 'AUTHORITY_REFUSED' | 'INVALID_AUTHORITY_CHALLENGE' | 'SIGNING_DISABLED' | 'USER_REJECTED' | 'IDENTITY_MISMATCH';
export class AuthorityError extends Error {
  readonly code: AuthorityErrorCode;
  constructor(code: AuthorityErrorCode) { super(code); this.code = code; }
}

/** SHA-256 hex of the canonical signing profiles — computed locally, never copied from the server. */
export async function policyHashOf(profiles: MainnetSigningProfiles): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(profiles))));
  return Array.from(digest, (x) => x.toString(16).padStart(2, '0')).join('');
}

function mapSignerError(e: unknown): AuthorityError {
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : e instanceof Error ? e.message : '';
  if (code === 'SIGNING_DISABLED' || code === 'MAINNET_SIGNING_DISABLED') return new AuthorityError('SIGNING_DISABLED');
  if (code === 'CANCELLED' || code === 'USER_REJECTED') return new AuthorityError('USER_REJECTED');
  if (code === 'EXTERNAL_IDENTITY_MISMATCH') return new AuthorityError('IDENTITY_MISMATCH');
  if (code === 'INVALID_AUTHORITY_CHALLENGE') return new AuthorityError('INVALID_AUTHORITY_CHALLENGE');
  return new AuthorityError('AUTHORITY_REFUSED');
}

/** Taply Wallet: Codex's vault method (rejects while the signing gate is closed). */
export function vaultAuthoritySigner(vault: EncryptedMainnetVault, identity: { accountId: string; publicKey: string },
  confirm: (command: MainnetAuthorityCommand) => Promise<boolean>): AuthoritySigner {
  return {
    accountId: identity.accountId, publicKey: identity.publicKey,
    async authorize(challenge, command, policyHash) {
      try { return await vault.authorizeAuthorityCommand(challenge, command, policyHash, confirm); }
      catch (e) { throw mapSignerError(e); }
    },
  };
}

type NearConnectAuthWallet = Parameters<typeof authorizeMainnetNearConnectCommand>[0];
/** External NEAR Connect wallet: Codex's wrapper (exact payload, identity checks; rejects while gated). */
export function nearConnectAuthoritySigner(wallet: NearConnectAuthWallet, identity: { accountId: string; publicKey: string },
  confirm: (command: MainnetAuthorityCommand) => Promise<boolean>): AuthoritySigner {
  return {
    accountId: identity.accountId, publicKey: identity.publicKey,
    async authorize(challenge, command, policyHash) {
      try { return await authorizeMainnetNearConnectCommand(wallet, challenge, { accountId: identity.accountId, publicKey: identity.publicKey, command, policyHash }, confirm); }
      catch (e) { throw mapSignerError(e); }
    },
  };
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type Bound = ReturnType<typeof bindMainnetCommerceTerms>;
export type HttpMainnetAuthority = MainnetWalletAuthority & {
  bindCommerce(...args: Parameters<typeof bindMainnetCommerceTerms>): Promise<Bound>;
  /** Pre-flight: the server's challenge parses and binds THIS command and THIS policy (no signing). */
  checkChallenge(command: MainnetAuthorityCommand): Promise<void>;
  /** Server-issued device id from the latest valid challenge (null before one). Not a credential. */
  deviceId(): string | null;
};

export function createHttpMainnetAuthority(input: { signer: AuthoritySigner; profiles: MainnetSigningProfiles; base?: string; fetcher?: Fetcher }): HttpMainnetAuthority {
  const base = input.base ?? AUTHORITY_BASE;
  const fetcher: Fetcher = input.fetcher ?? ((u, i) => globalThis.fetch(u, i));
  const signer = input.signer;
  let policy: Promise<string> | null = null;
  let device: string | null = null;
  const policyHash = () => (policy ??= policyHashOf(input.profiles));

  async function post(path: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetcher(`${base}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    } catch { throw new AuthorityError('AUTHORITY_UNAVAILABLE'); }
    if (res.status === 404) throw new AuthorityError('AUTHORITY_UNAVAILABLE');
    let json: unknown;
    try { json = await res.json(); } catch { throw new AuthorityError('AUTHORITY_UNAVAILABLE'); }
    if (!res.ok) throw new AuthorityError(res.status === 503 || res.status === 403 ? 'AUTHORITY_REFUSED' : 'AUTHORITY_UNAVAILABLE');
    return json;
  }
  async function challenge(command: MainnetAuthorityCommand): Promise<unknown> {
    const issued = await post('challenge', { publicKey: signer.publicKey, command });
    // Validate before any wallet prompt: exact account/key, this command, the locally computed policy.
    try { await mainnetAuthorityMessageParameters(issued, { accountId: signer.accountId, publicKey: signer.publicKey, command, policyHash: await policyHash() }); }
    catch { throw new AuthorityError('INVALID_AUTHORITY_CHALLENGE'); }
    device = (issued as { deviceId: string }).deviceId;
    return issued;
  }
  async function run(command: MainnetAuthorityCommand): Promise<unknown> {
    const issued = await challenge(command);
    const signed = await signer.authorize(issued, command, await policyHash());
    if (signed.accountId !== signer.accountId || signed.publicKey !== signer.publicKey) throw new AuthorityError('IDENTITY_MISMATCH');
    const out = await post('execute', { id: (issued as { id: string }).id, command, signed: { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature } });
    if (!out || typeof out !== 'object' || !('result' in out)) throw new AuthorityError('AUTHORITY_UNAVAILABLE');
    return (out as { result: unknown }).result;
  }
  const own = (accountId: string) => { if (accountId !== signer.accountId) throw new AuthorityError('IDENTITY_MISMATCH'); };
  type A = MainnetWalletAuthority;
  return Object.freeze({
    async read(accountId: string) { own(accountId); return (await run({ method: 'read' })) as Awaited<ReturnType<A['read']>>; },
    async reserve(...args: Parameters<A['reserve']>) { return (await run({ method: 'reserve', args })) as Awaited<ReturnType<A['reserve']>>; },
    async handoff(...args: Parameters<A['handoff']>) { return (await run({ method: 'handoff', args })) as Awaited<ReturnType<A['handoff']>>; },
    async uncertain(...args: Parameters<A['uncertain']>) { return (await run({ method: 'uncertain', args })) as Awaited<ReturnType<A['uncertain']>>; },
    async reconcile(accountId: string, hashHint?: string) {
      own(accountId);
      return (await run(hashHint === undefined ? { method: 'reconcile' } : { method: 'reconcile', hashHint })) as Awaited<ReturnType<A['reconcile']>>;
    },
    async bindCommerce(...args: Parameters<typeof bindMainnetCommerceTerms>) { return (await run({ method: 'bindCommerce', args })) as Bound; },
    async checkChallenge(command: MainnetAuthorityCommand) { await challenge(command); },
    deviceId: () => device,
  });
}
