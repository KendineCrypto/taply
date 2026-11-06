import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNearConnectAdapter } from '../near-connect';
import { WalletError, WalletNotDispatchedError } from '../adapter';
import { JOURNAL_STORAGE_KEY, SubmissionJournal, isBlocking } from '@/lib/payments/journal';
import type { JournalMethod, JournalStorage } from '@/lib/payments/journal';
import { inProcessJournalLock } from '@/lib/payments/journal-lock';
import { submitCall } from '@/lib/payments/submit';

const sdk = vi.hoisted(() => ({ send: vi.fn(), connected: vi.fn(), wallet: vi.fn() }));
vi.mock('@hot-labs/near-connect', () => ({
  NearConnector: class {
    getConnectedWallet = sdk.connected;
    wallet = sdk.wallet;
  },
}));
const ID = 'a'.repeat(64), HASH = 'b'.repeat(64), TX = '1'.repeat(32);
const wallet = { signAndSendTransaction: sdk.send, manifest: { id: 'fixture', name: 'Fixture' } };
const adapter = createNearConnectAdapter('https://rpc.example.test');
function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
function journal(storage: JournalStorage, lock = inProcessJournalLock()) {
  return new SubmissionJournal(storage, () => new Date('2026-11-06T10:00:00Z'), lock);
}
function submit(store: SubmissionJournal, method: JournalMethod = 'pay_instant_native', requestId = ID) {
  return submitCall({ journal: store, requestId, termsHash: HASH, signerAccountId: 'payer.testnet',
    ...(method === 'retry_native_transfer' ? { operationNonce: '1' } : {}),
    call: { receiverId: 'pay.testnet', methodName: method, args: { id: requestId }, gas: '50000000000000', depositYocto: '1' },
    signAndSend: call => adapter.signAndSendTransaction('payer.testnet', call) });
}
beforeEach(() => {
  vi.clearAllMocks();
  sdk.connected.mockResolvedValue({ wallet, accounts: [{ accountId: 'payer.testnet' }] });
  sdk.wallet.mockResolvedValue(wallet);
  sdk.send.mockResolvedValue(undefined);
});

const failures: Array<[string, () => unknown]> = [
  ['RPC rejection', () => new Error('Request rejected by RPC')],
  ['uncertain cancellation', () => new Error('Transaction cancelled')],
  ['dispatch abort', () => new Error('Connection aborted')],
  ['timeout', () => new Error('SDK timeout')],
  ['generic decline', () => new Error('User rejected')],
  ['rejection-shaped object', () => ({ code: 4001, message: 'User denied', kind: 'cancelled' })],
  ['raw string', () => 'Request cancelled'],
  ['null', () => null],
  ['undefined', () => undefined],
  ['SDK WalletError cancelled', () => new WalletError('cancelled')],
  ['SDK WalletError no_account', () => new WalletError('no_account')],
  ['SDK forged local error type', () => new WalletNotDispatchedError()],
  ['throwing message getter', () => Object.defineProperty({}, 'message', { get() { throw Error('getter'); } })],
];

describe.each(['pay_instant_native', 'retry_native_transfer', 'create_request', 'cancel_unfunded'] as const)('%s dispatch failures', method => {
  it.each(failures)('%s stays unknown and blocks reload/repeated attempts', async (_name, failure) => {
    sdk.send.mockRejectedValue(failure());
    const storage = memory(), lock = inProcessJournalLock(), first = journal(storage, lock);
    expect(await submit(first, method)).toEqual({ kind: 'unknown' });
    expect(first.entries()[0]).toMatchObject({ phase: 'OUTCOME_UNKNOWN' });
    const reloaded = journal(storage, lock);
    expect(isBlocking(reloaded.entries()[0]!)).toBe(true);
    expect((await submit(reloaded, method)).kind).toBe('blocked');
    expect((await submit(first, method)).kind).toBe('blocked');
    if (method === 'create_request') expect((await submit(reloaded, method, 'c'.repeat(64))).kind).toBe('blocked');
    expect(sdk.send).toHaveBeenCalledTimes(1);
  });
});

it.each([undefined, null, {}, { transaction: { hash: 'malformed' } }, { error: 'User rejected' }])('redirect/malformed SDK result %j remains unknown', async result => {
  sdk.send.mockResolvedValue(result);
  const storage = memory();
  expect(await submit(journal(storage))).toEqual({ kind: 'unknown' });
  expect((await submit(journal(storage))).kind).toBe('blocked');
  expect(sdk.send).toHaveBeenCalledTimes(1);
});
it('a throwing SDK outcome accessor is unknown', async () => {
  sdk.send.mockResolvedValue(Object.defineProperty({}, 'transaction', { get() { throw Error('closed'); } }));
  const store = journal(memory());
  expect(await submit(store)).toEqual({ kind: 'unknown' });
  expect(isBlocking(store.entries()[0]!)).toBe(true);
});
it('an SDK wallet lookup error cannot masquerade as local no-dispatch evidence', async () => {
  sdk.wallet.mockRejectedValue(new WalletNotDispatchedError());
  const store = journal(memory());
  expect(await submit(store)).toEqual({ kind: 'unknown' });
  expect(isBlocking(store.entries()[0]!)).toBe(true);
  expect(sdk.send).not.toHaveBeenCalled();
});
it('proven pre-dispatch account mismatch permits retry only after account correction', async () => {
  const storage = memory(), store = journal(storage);
  sdk.connected.mockResolvedValue({ wallet, accounts: [{ accountId: 'other.testnet' }] });
  expect(await submit(store)).toEqual({ kind: 'wrong_account' });
  expect(store.entries()[0]).toMatchObject({ phase: 'USER_REJECTED', notDispatched: true });
  expect(isBlocking(store.entries()[0]!)).toBe(false);
  expect(sdk.wallet).not.toHaveBeenCalled();
  expect(sdk.send).not.toHaveBeenCalled();
  sdk.connected.mockResolvedValue({ wallet, accounts: [{ accountId: 'payer.testnet' }] });
  sdk.send.mockResolvedValue({ transaction: { hash: TX } });
  expect(await submit(journal(storage))).toEqual({ kind: 'submitted', transactionHash: TX });
  expect(store.entries()[0]?.notDispatched).toBeUndefined();
  expect(sdk.send).toHaveBeenCalledTimes(1);
});
it.each(['pay_instant_native', 'retry_native_transfer'] as const)('concurrent tabs invoke %s once, before and after an ambiguous failure', async method => {
  let reject!: (reason: unknown) => void;
  sdk.send.mockImplementation(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
  const storage = memory(), lock = inProcessJournalLock(), one = journal(storage, lock), two = journal(storage, lock);
  const pending = submit(one, method);
  await vi.waitFor(() => expect(sdk.send).toHaveBeenCalledTimes(1));
  expect((await submit(two, method)).kind).toBe('blocked');
  reject(new Error('Connection aborted'));
  expect(await pending).toEqual({ kind: 'unknown' });
  expect((await submit(two, method)).kind).toBe('blocked');
  expect(sdk.send).toHaveBeenCalledTimes(1);
});
it('failed outcome write leaves durable AWAITING_SIGNATURE blocking on reload', async () => {
  const backing = memory(); let failWrites = false;
  const storage = { getItem: backing.getItem, setItem(key: string, value: string) { if (failWrites) throw Error('quota'); backing.setItem(key, value); } };
  sdk.send.mockImplementation(async () => { failWrites = true; throw Error('Transaction cancelled'); });
  expect(await submit(journal(storage))).toEqual({ kind: 'unknown' });
  expect(journal(storage).entries()[0]?.phase).toBe('AWAITING_SIGNATURE');
  failWrites = false;
  expect((await submit(journal(storage))).kind).toBe('blocked');
  expect(sdk.send).toHaveBeenCalledTimes(1);
});
it('failed initial journal write prevents dispatch entirely', async () => {
  const storage = { getItem: () => null, setItem() { throw Error('quota'); } };
  expect(await submit(journal(storage))).toEqual({ kind: 'no_journal' });
  expect(sdk.send).not.toHaveBeenCalled();
});
it('legacy USER_REJECTED without local evidence becomes unknown, even long after navigation', async () => {
  const storage = memory(), store = journal(storage);
  await submit(store);
  const raw = JSON.parse(storage.getItem(JOURNAL_STORAGE_KEY)!) as { entries: Array<{ phase: string; startedAt: string; updatedAt: string }> };
  raw.entries[0]!.phase = 'USER_REJECTED';
  raw.entries[0]!.startedAt = raw.entries[0]!.updatedAt = '2020-01-01T00:00:00.000Z';
  storage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(raw));
  expect(journal(storage).entries()[0]?.phase).toBe('OUTCOME_UNKNOWN');
  expect((await submit(journal(storage))).kind).toBe('blocked');
  expect(sdk.send).toHaveBeenCalledTimes(1);
});
it.each([new WalletError('cancelled'), new WalletError('no_account'), { kind: 'cancelled' }, new Error('No accounts found')])('submit itself distrusts generic thrown errors: %j', async error => {
  const store = journal(memory());
  const result = await submitCall({ journal: store, requestId: ID, termsHash: HASH, signerAccountId: 'payer.testnet',
    call: { receiverId: 'pay.testnet', methodName: 'pay_instant_native', args: {}, gas: '1', depositYocto: '1' },
    signAndSend: async () => { throw error; } });
  expect(result).toEqual({ kind: 'unknown' });
  expect(isBlocking(store.entries()[0]!)).toBe(true);
});
it('a declined creation blocks until a verified final read after its expiry finds nothing, then a new sale is allowed', async () => {
  const { reconcile, dateToNs } = await import('@/lib/payments/submit');
  const { FIXTURES } = await import('@/test/chain');
  const terms = FIXTURES.open.terms;
  const expiry = BigInt(terms.fundingExpiresAtNs);
  const storage = memory(), lock = inProcessJournalLock();
  const store = new SubmissionJournal(storage, () => new Date(Number((expiry - 600_000_000_000n) / 1_000_000n)), lock);
  sdk.send.mockRejectedValue(new Error('User rejected'));
  const result = await submitCall({ journal: store, requestId: terms.id, termsHash: HASH, signerAccountId: 'payer.testnet', terms,
    call: { receiverId: 'pay.testnet', methodName: 'create_request', args: {}, gas: '1', depositYocto: '1' },
    signAndSend: call => adapter.signAndSendTransaction('payer.testnet', call) });
  expect(result).toEqual({ kind: 'unknown' });
  const entry = store.entries()[0]!;
  // Account-wide creation gate: a different new sale is blocked too.
  expect((await submit(store, 'create_request', 'c'.repeat(64))).kind).toBe('blocked');
  const startedNs = dateToNs(entry.startedAt);
  expect(reconcile(entry, { kind: 'not_found', observedAtNs: (expiry - 1n).toString(), verifiedFinal: true }, startedNs)).toBe('pending');
  expect(reconcile(entry, { kind: 'not_found', observedAtNs: expiry.toString() }, startedNs)).toBe('pending');
  expect(reconcile(entry, { kind: 'not_found', observedAtNs: expiry.toString(), verifiedFinal: true }, startedNs)).toBe('resolved');
  await store.update(entry, { phase: 'RESOLVED' });
  sdk.send.mockResolvedValue({ transaction: { hash: TX } });
  expect(await submit(journal(storage, lock), 'create_request', 'c'.repeat(64))).toEqual({ kind: 'submitted', transactionHash: TX });
  expect(sdk.send).toHaveBeenCalledTimes(2);
});
