import { createHash, createPublicKey, verify } from 'node:crypto';
import { AccountIdSchema, parseStrictJson, isWellFormedUnicode } from '../../../packages/shared/dist/index.js';
import { createWalletChain, ed25519PublicKeyFromHex } from '../../../packages/near-client/dist/wallet-chain.js';
import type { Challenge, Nep413Verifier, VerifiedIdentity } from './auth.mts';

const refuse = (): never => { throw Error('AUTH_SIGNATURE_INVALID'); };
export function base64(value: string, length: number): Buffer {
  if (typeof value !== 'string' || value.length > 128) return refuse();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== length || bytes.toString('base64') !== value) return refuse();
  return bytes;
}
function text(value: string): Buffer {
  if (typeof value !== 'string' || !isWellFormedUnicode(value) || Buffer.byteLength(value) > 4096) return refuse();
  const bytes = Buffer.from(value); const size = Buffer.alloc(4); size.writeUInt32LE(bytes.length);
  return Buffer.concat([size, bytes]);
}
/** NEP-413 Borsh: u32 tag, string, [u8;32], string, Option<string>. */
export function nep413Payload(message: string, nonce: string, recipient: string, callbackUrl?: string): Buffer {
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2147484061);
  return Buffer.concat([tag, text(message), base64(nonce, 32), text(recipient),
    callbackUrl === undefined ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), text(callbackUrl)])]);
}
function publicBytes(key: string): Buffer {
  if (typeof key !== 'string' || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key)) return refuse();
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n; for (const c of key.slice(8)) n = n * 58n + BigInt(alphabet.indexOf(c));
  if (n >= 1n << 256n) return refuse();
  const bytes = Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
  if (ed25519PublicKeyFromHex(bytes.toString('hex')) !== key) return refuse();
  return bytes;
}
export type KeyAssociation = (account: string, publicKey: string) => Promise<VerifiedIdentity>;
export function finalizedTestnetKeys(): KeyAssociation {
  const chain = createWalletChain({ network: 'near-testnet', rpcUrl: 'https://rpc.testnet.near.org',
    rpcProviderId: 'near-public-testnet', contract: null, timeoutMs: 10000, maxResponseBytes: 65536 });
  return async (accountId, publicKey) => {
    // Existing reader checks Testnet genesis, finalized block, exact account/key,
    // FullAccess permission and matching block hash/height. No mainnet fallback.
    const value = await chain.snapshot(accountId, publicKey);
    if (!value) throw Error('VERIFICATION_UNAVAILABLE');
    return { accountId, publicKey, blockHash: value.blockHash, blockHeight: value.blockHeight };
  };
}
export function createNep413Verifier(origin: string, contractId: string, association: KeyAssociation,
  now = Date.now): Nep413Verifier {
  if (new URL(origin).origin !== origin || !origin.startsWith('https://')) throw Error('INVALID_ARGUMENT');
  AccountIdSchema.parse(contractId);
  return { async verify(challenge: Challenge, signed: unknown) {
    if (!signed || typeof signed !== 'object' || Array.isArray(signed)) return refuse();
    const s = signed as Record<string, unknown>;
    if (Object.keys(s).sort().join() !== 'accountId,publicKey,signature,state'
      || Object.values(s).some(v => typeof v !== 'string' || v.length > 256)) return refuse();
    if (s.accountId !== challenge.accountId || s.state !== challenge.state || challenge.origin !== origin
      || challenge.recipient !== origin || challenge.network !== 'near-testnet' || challenge.purpose !== 'merchant-login') return refuse();
    AccountIdSchema.parse(challenge.accountId);
    if (now() >= challenge.expiresAtMs || challenge.expiresAtMs > now() + 120000) throw Error('AUTH_CHALLENGE_EXPIRED');
    if (challenge.callbackUrl !== undefined && challenge.callbackUrl !== `${origin}/auth/callback`) return refuse();
    const { message, callbackUrl, ...fields } = challenge;
    // Bind every server field, including account, purpose, origin and nonce.
    const expected = { ...fields, ...(callbackUrl === undefined ? {} : { callbackUrl }), contractId };
    const parsed = parseStrictJson(message);
    if (JSON.stringify(parsed) !== JSON.stringify(expected)) return refuse();
    const payload = nep413Payload(message, challenge.nonceBase64, challenge.recipient, callbackUrl);
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicBytes(s.publicKey as string)]), format: 'der', type: 'spki' });
    if (!verify(null, createHash('sha256').update(payload).digest(), key, base64(s.signature as string, 64))) return refuse();
    const identity = await association(challenge.accountId, s.publicKey as string);
    if (now() >= challenge.expiresAtMs) throw Error('AUTH_CHALLENGE_EXPIRED');
    if (identity.accountId !== challenge.accountId || identity.publicKey !== s.publicKey
      || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(identity.blockHash) || !/^(0|[1-9][0-9]*)$/.test(identity.blockHeight)) return refuse();
    return identity;
  } };
}
