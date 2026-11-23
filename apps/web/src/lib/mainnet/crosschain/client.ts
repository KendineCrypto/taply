import { PublicSession, Secret, type PublicQuote } from './model';
export const SECRET_KEY = 'taply.mainnet.crosschain.owner.v1';
export const PENDING_KEY = 'taply.mainnet.crosschain.pending.v1';
export const HISTORY_KEY = 'taply.mainnet.crosschain.history.v1';
export function ownerSecret(storage: Storage): string {
  const old = storage.getItem(SECRET_KEY);
  if (old !== null) return Secret.parse(old);
  const secret = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
  storage.setItem(SECRET_KEY, secret); return secret;
}
export async function api(action: 'quote' | 'session' | 'archive', body: unknown) {
  const r = await fetch(`/api/mainnet/crosschain/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(30000) });
  const value = await r.json();
  if (!r.ok) throw new Error(typeof value?.error === 'string' ? value.error : 'SERVICE_UNAVAILABLE');
  return value;
}
export function saveResult(storage: Storage, value: unknown) {
  const session = PublicSession.parse(value);
  const values: unknown = JSON.parse(storage.getItem(HISTORY_KEY) ?? '[]');
  if (!Array.isArray(values)) throw new Error('STORAGE_INVALID');
  const entries = values.map(v => PublicSession.parse(v)).filter(v => v.quote?.correlationId !== session.quote?.correlationId);
  storage.setItem(HISTORY_KEY, JSON.stringify([...entries, session].slice(-30)));
}
export function checkedQuote(value: unknown, expected: PublicQuote['input'], funded: boolean): PublicQuote {
  // Server-side signature verification is mandatory. This check also prevents
  // a stale/mismatched HTTP response from being displayed for another form.
  const q = PublicSession.shape.quote.unwrap().parse(value);
  if (JSON.stringify(q.input) !== JSON.stringify(expected) || q.funded !== funded || BigInt(q.minAmountOut) <= 0n || BigInt(q.amountOut) < BigInt(q.minAmountOut) || q.amountIn !== expected.amount || !Number.isFinite(Date.parse(q.deadline))) throw new Error('QUOTE_INVALID');
  return q;
}
