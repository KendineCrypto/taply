import { PublicKey } from 'near-api-js';
import { MainnetAccountSchema } from '@taply/shared';

/** A one-use, origin/account-bound NEP-413 message. Never authorizes a transaction. */
export function createMainnetWalletKeyProof(accountId: string, origin: string, now = Date.now) {
  MainnetAccountSchema.parse(accountId);
  if (!origin.startsWith('https://') || new URL(origin).origin !== origin) throw Error('INVALID_ORIGIN');
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const expiresAt = now() + 120_000;
  const message = `Taply wallet connection verification\nNetwork: NEAR Mainnet\nAccount: ${accountId}\nOrigin: ${origin}\nExpires: ${expiresAt}\nThis message does not send funds or add access keys.`;
  const params = { network: 'mainnet' as const, signerId: accountId, recipient: origin, message, nonce };
  let consumed = false;
  return { params, async accept(value: unknown): Promise<string> {
    if (consumed || now() >= expiresAt) throw Error('KEY_PROOF_EXPIRED');
    consumed = true;
    const s = value as { accountId?: unknown; publicKey?: unknown; signature?: unknown } | null;
    if (!s || s.accountId !== accountId || typeof s.publicKey !== 'string' || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.publicKey) || typeof s.signature !== 'string') throw Error('KEY_PROOF_INVALID');
    const sig = Uint8Array.from(atob(s.signature), c => c.charCodeAt(0));
    if (sig.length !== 64 || btoa(String.fromCharCode(...sig)) !== s.signature) throw Error('KEY_PROOF_INVALID');
    const text = (v: string) => { const b = new TextEncoder().encode(v), n = new Uint8Array(4); new DataView(n.buffer).setUint32(0, b.length, true); return [...n, ...b]; };
    const tag = new Uint8Array(4); new DataView(tag.buffer).setUint32(0, 2147484061, true);
    const payload = new Uint8Array([...tag, ...text(message), ...nonce, ...text(origin), 0]);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
    if (!PublicKey.fromString(s.publicKey).verify(hash, sig)) throw Error('KEY_PROOF_INVALID');
    return s.publicKey;
  } };
}
