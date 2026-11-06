import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FencedTransactions, SqliteFencedRepository, freshnessAnchor, type FreshnessAnchor, type FreshnessAuthority, type FencedState } from '../src/freshness.mts';

// Controlled external-authority MODEL only. The object survives restoration of
// local SQLite and is shared by workers; it is NOT a production freshness service.
class Authority implements FreshnessAuthority {
  head: FreshnessAnchor; uncertain = false;
  constructor(head: FreshnessAnchor) { this.head = structuredClone(head); }
  async read() { return structuredClone(this.head); }
  async compareAndSwap(_scope: string, expected: FreshnessAnchor, next: FreshnessAnchor) {
    if (JSON.stringify(this.head) !== JSON.stringify(expected)) return false;
    assert.equal(next.epoch, expected.epoch); assert.equal(BigInt(next.revision), BigInt(expected.revision) + 1n);
    this.head = structuredClone(next);
    if (this.uncertain) throw Error('AUTHORITY_TIMEOUT_UNKNOWN');
    return true;
  }
}
const scope = 'test:independent-deployment';
type Decisions = { challenges: string[]; joins: string[]; sessions: string[] };
const initial = (): FencedState<Decisions> => ({ format: 'taply.fenced-state.v1', epoch: 'a'.repeat(64), revision: '0', state: { challenges: [], joins: [], sessions: ['cookie'] } });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'taply-freshness-')), path = join(dir, 'new.db'), key = randomBytes(32);
  const open = (initialize = false) => new SqliteFencedRepository(path, key, 'fenced-test', scope, initial, initialize);
  const repo = open(true), authority = new Authority(freshnessAnchor(scope, repo.read()));
  return { dir, path, open, repo, authority, tx: (r = repo) => new FencedTransactions(r, authority, scope) };
}
test('restoring valid encrypted backups cannot resurrect consumed challenges/joins or logged-out sessions under an external head', async () => {
  for (const decision of ['challenges', 'joins', 'sessions'] as const) {
    const f = setup(); let repo = f.repo;
    try {
      repo.close(); const backup = readFileSync(f.path); repo = f.open();
      await f.tx(repo).transaction(s => { if (decision === 'sessions') s.sessions = []; else s[decision].push('used'); });
      repo.close(); writeFileSync(f.path, backup); repo = f.open();
      let invoked = false;
      const restored = f.tx(repo);
      await assert.rejects(restored.transaction(() => { invoked = true; }), /VERIFICATION_UNAVAILABLE/);
      assert.equal(invoked, false);
      await assert.rejects(restored.transaction(() => true), /VERIFICATION_UNAVAILABLE/);
    } finally { repo.close(); rmSync(f.dir, { recursive: true, force: true }); }
  }
});
test('competing workers can acknowledge a one-use decision only once and committed reopen retains it', async () => {
  const f = setup(), b = f.open();
  try {
    const results = await Promise.allSettled([f.tx(f.repo), f.tx(b)].map(worker => worker.transaction(s => {
      assert.equal(s.joins.length, 0); s.joins.push('used'); return 'accepted';
    })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);
    assert.equal(f.repo.read().state.joins.length, 1);
    assert.equal(await f.tx().transaction(s => s.joins.length), 1);
  } finally { f.repo.close(); b.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
test('authority timeout after CAS fences restored state; no automatic reset, retry or silent recovery', async () => {
  const f = setup();
  try {
    f.authority.uncertain = true; const tx = f.tx();
    await assert.rejects(tx.transaction(s => { s.challenges.push('used'); return true; }), /TIMEOUT_UNKNOWN/);
    assert.equal(f.repo.read().state.challenges.length, 0); // Local commit never occurred.
    await assert.rejects(tx.transaction(() => true), /VERIFICATION_UNAVAILABLE/);
    f.authority.uncertain = false;
    await assert.rejects(f.tx().transaction(() => true), /VERIFICATION_UNAVAILABLE/);
  } finally { f.repo.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
test('ordinary decision failure rolls back without advancing head; asynchronous actions are forbidden', async () => {
  const f = setup();
  try {
    const tx = f.tx(), before = structuredClone(f.authority.head);
    await assert.rejects(tx.transaction(s => { s.joins.push('used'); throw Error('DENIED'); }), /DENIED/);
    assert.deepEqual(f.authority.head, before); assert.equal(f.repo.read().state.joins.length, 0);
    await assert.rejects(tx.transaction(async () => true), /INVALID_ARGUMENT/);
    assert.deepEqual(f.authority.head, before);
    assert.equal(await tx.transaction(() => true), true);
  } finally { f.repo.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('independent processes share external CAS fencing: exactly one acknowledged token decision', async () => {
  const { fork } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'taply-fence-process-')), path = join(dir, 'test.db'), key = randomBytes(32);
  const start = (): FencedState<{ used: boolean }> => ({ format: 'taply.fenced-state.v1', epoch: 'a'.repeat(64), revision: '0', state: { used: false } });
  const repo = new SqliteFencedRepository(path, key, 'process-test', scope, start, true);
  const authority = new Authority(freshnessAnchor(scope, repo.read()));
  const children: import('node:child_process').ChildProcess[] = [];
  try {
    const run = () => new Promise<boolean>((resolve, reject) => {
      const child = fork(new URL('./freshness-worker.mts', import.meta.url), [], { execPath: process.execPath, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      children.push(child); let completed = false; let accepted = false; let stderr = '';
      child.stderr?.on('data', data => { stderr += String(data); });
      const timer = setTimeout(() => { child.kill(); reject(Error('CHILD_TIMEOUT')); }, 10000);
      child.on('message', async (message: any) => {
        if (message.kind === 'done') { completed = true; accepted = message.accepted; return; }
        if (message.kind === 'authority') {
          const [s, old, next] = message.args;
          const value = message.method === 'read' ? await authority.read() : await authority.compareAndSwap(s, old, next);
          child.send({ kind: 'reply', id: message.id, value });
        }
      });
      child.on('error', reject);
      child.on('exit', code => { clearTimeout(timer); if (code !== 0 || !completed) reject(Error('CHILD_FAILURE:' + stderr)); else resolve(accepted); });
      child.send({ kind: 'start', path, key: key.toString('hex'), scope });
    });
    assert.equal((await Promise.all([run(), run()])).filter(Boolean).length, 1);
    assert.equal(repo.read().state.used, true);
    assert.equal(authority.head.revision, '1');
  } finally { for (const child of children) if (child.exitCode === null) child.kill(); repo.close(); rmSync(dir, { recursive: true, force: true }); }
});
