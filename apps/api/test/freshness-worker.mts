// Disposable child-process fixture. Service test keys only; never wallet keys.
import { SqliteFencedRepository, FencedTransactions, type FreshnessAuthority, type FreshnessAnchor, type FencedState } from '../src/freshness.mts';
let sequence = 0;
const pending = new Map<number, (value: unknown) => void>();
function rpc(method: string, args: unknown[]): Promise<unknown> {
  const id = ++sequence;
  return new Promise(resolve => { pending.set(id, resolve); process.send?.({ kind: 'authority', id, method, args }); });
}
process.on('message', async (message: any) => {
  if (message.kind === 'reply') { const resolve = pending.get(message.id); pending.delete(message.id); resolve?.(message.value); return; }
  if (message.kind !== 'start') return;
  const authority: FreshnessAuthority = {
    read: async scope => await rpc('read', [scope]) as FreshnessAnchor,
    compareAndSwap: async (scope, old, next) => await rpc('cas', [scope, old, next]) as boolean,
  };
  const initial = (): FencedState<{ used: boolean }> => ({ format: 'taply.fenced-state.v1', epoch: 'a'.repeat(64), revision: '0', state: { used: false } });
  const repo = new SqliteFencedRepository(message.path, Buffer.from(message.key, 'hex'), 'process-test', message.scope, initial);
  try {
    const result = await new FencedTransactions(repo, authority, message.scope).transaction(s => {
      if (s.used) throw Error('ALREADY_USED'); s.used = true; return 'accepted';
    });
    process.send?.({ kind: 'done', accepted: result === 'accepted' });
  } catch { process.send?.({ kind: 'done', accepted: false }); }
  finally { repo.close(); process.disconnect(); }
});
