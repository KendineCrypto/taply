import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { nep413Payload } from '../src/nep413.mts';
import { ed25519PublicKeyFromHex } from '../../../packages/near-client/dist/wallet-chain.js';
// Disposable off-chain test key; never a wallet key and never persisted.
export function testSigner() {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = ed25519PublicKeyFromHex(keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex'));
  return (c: import('../src/auth.mts').Challenge) => ({ accountId: c.accountId, state: c.state, publicKey,
    signature: sign(null, createHash('sha256').update(nep413Payload(c.message, c.nonceBase64, c.recipient, c.callbackUrl)).digest(), keys.privateKey).toString('base64') });
}
