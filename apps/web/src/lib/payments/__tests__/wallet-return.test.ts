import { describe, expect, it } from 'vitest';
import { FIXTURES, memoryStorage } from '@/test/chain';
import { VerifierRpcError } from '@/lib/verify/rpc';
import type { VerifierRpc } from '@/lib/verify/rpc';
import { hashOf } from '@/lib/verify/__tests__/fake-chain';
import { SubmissionJournal, isBlocking } from '../journal';
import { inProcessJournalLock } from '../journal-lock';
import { reconcile } from '../submit';
import {
  WALLET_RETURN_MAX_ATTEMPTS,
  WALLET_RETURN_RPC_BUDGET,
  WALLET_RETURN_STORAGE_KEY,
  WalletReturnInbox,
  captureWalletReturn,
  matchTransaction,
  parseWalletReturn,
  processWalletReturns,
  stripWalletReturn,
} from '../wallet-return';

const { openRestricted } = FIXTURES;
const PAYER = openRestricted.terms.permittedPayerAccountId ?? 'payer.testnet';
const CONTRACT = openRestricted.terms.contractId;
const ID = openRestricted.terms.id;
const TX = hashOf('redirect-tx');
const OTHER_TX = hashOf('someone-else');

const T0 = new Date('2026-11-01T10:00:00.000Z');
const clock =
  (ms = 0) =>
  () =>
    new Date(T0.getTime() + ms);

/** A chain that knows a few transactions; anything else is UNKNOWN_TRANSACTION. */
function txRpc(
  known: Record<string, { signer: string; receiver: string; method: string; args: unknown; actions?: number }>,
): VerifierRpc & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    providerId: 'fake',
    calls,
    async call(method, params) {
      calls.push(method);
      if (method !== 'EXPERIMENTAL_tx_status') throw new VerifierRpcError('RPC_ERROR');
      const p = params as { tx_hash: string; sender_account_id: string };
      const tx = known[p.tx_hash];
      if (tx === undefined || tx.signer !== p.sender_account_id) throw new VerifierRpcError('UNKNOWN_TRANSACTION');
      const action = {
        FunctionCall: {
          method_name: tx.method,
          args: Buffer.from(JSON.stringify(tx.args)).toString('base64'),
          gas: 1,
          deposit: '1',
        },
      };
      return {
        transaction: {
          hash: p.tx_hash,
          signer_id: tx.signer,
          receiver_id: tx.receiver,
          actions: Array(tx.actions ?? 1).fill(action),
        },
      };
    },
  };
}

async function setup(now = clock()) {
  const storage = memoryStorage();
  const journal = new SubmissionJournal(storage, now, inProcessJournalLock());
  const inbox = new WalletReturnInbox(storage, now);
  const entry = await journal.begin({
    method: 'pay_instant_native',
    network: 'near-testnet',
    contractId: CONTRACT,
    requestId: ID,
    termsHash: openRestricted.termsHash,
    signerAccountId: PAYER,
    terms: null,
    operationNonce: null,
  });
  return { storage, journal, inbox, entry };
}

const payTx = {
  signer: PAYER,
  receiver: CONTRACT,
  method: 'pay_instant_native',
  args: { id: ID, expectedTermsHash: openRestricted.termsHash },
};

describe('parsing and stripping wallet return parameters', () => {
  it('capture cannot strip a newer wallet callback that arrives while the write is pending', async () => {
    const { inbox } = await setup();
    const location = { href: `https://app.example/?transactionHashes=${TX}`, search: `?transactionHashes=${TX}` };
    const replaced: string[] = [];
    const capturing = captureWalletReturn(inbox, location, (url) => replaced.push(url));
    location.href = `https://app.example/?transactionHashes=${OTHER_TX}`;
    location.search = `?transactionHashes=${OTHER_TX}`;
    await capturing;
    expect(replaced).toEqual([]);
    expect(inbox.items()[0]?.hashes).toEqual([TX]);
    await captureWalletReturn(inbox, location, (url) => replaced.push(url));
    expect(inbox.items().flatMap((item) => item.hashes).sort()).toEqual([TX, OTHER_TX].sort());
    expect(replaced).toEqual(['/']);
  });
  it('reads hashes, declines and errors; ignores unrelated URLs', () => {
    expect(parseWalletReturn(`?transactionHashes=${TX}`)).toEqual({ kind: 'hashes', hashes: [TX] });
    expect(parseWalletReturn(`?transactionHashes=${TX},${TX}`)).toEqual({ kind: 'hashes', hashes: [TX] });
    expect(parseWalletReturn('?errorCode=userRejected&errorMessage=User%20rejected')).toEqual({ kind: 'rejected' });
    expect(parseWalletReturn('?errorCode=Error')).toEqual({ kind: 'error' });
    expect(parseWalletReturn('?transactionHashes=not-a-hash')).toEqual({ kind: 'error' });
    expect(parseWalletReturn('?ftx=abc')).toBeNull();
    expect(parseWalletReturn('')).toBeNull();
  });

  it('strips only wallet parameters and keeps the rest', () => {
    expect(stripWalletReturn(`https://app.example/pay/${ID}?a=1&transactionHashes=${TX}&errorMessage=x#top`)).toBe(
      `/pay/${ID}?a=1#top`,
    );
  });

  it('captures into the inbox and rewrites the address bar once', async () => {
    const { inbox } = await setup();
    const replaced: string[] = [];
    const found = await captureWalletReturn(
      inbox,
      { href: `https://app.example/pay/${ID}?transactionHashes=${TX}`, search: `?transactionHashes=${TX}` },
      (u) => replaced.push(u),
    );
    expect(found).toBe(true);
    expect(replaced).toEqual([`/pay/${ID}`]);
    expect(inbox.items()).toHaveLength(1);
    expect(await captureWalletReturn(inbox, { href: 'https://app.example/', search: '' }, (u) => replaced.push(u))).toBe(
      false,
    );
  });

  it('never stores errorMessage', async () => {
    const { inbox, storage } = await setup();
    await captureWalletReturn(
      inbox,
      {
        href: 'https://a.example/?errorCode=userRejected&errorMessage=secret',
        search: '?errorCode=userRejected&errorMessage=secret',
      },
      () => undefined,
    );
    expect(storage.data.get(WALLET_RETURN_STORAGE_KEY)).not.toContain('secret');
  });
});

describe('processWalletReturns', () => {
  it('a return added while an RPC pass is in flight survives its snapshot commit', async () => {
    const { journal, inbox } = await setup();
    await inbox.add({ kind: 'hashes', hashes: [TX] });
    let resume!: () => void;
    let queried!: () => void;
    const started = new Promise<void>((resolve) => { queried = resolve; });
    const rpc = txRpc({});
    const delayed = { ...rpc, async call(...args: Parameters<VerifierRpc['call']>) {
      queried();
      await new Promise<void>((resolve) => { resume = resolve; });
      return rpc.call(...args);
    } };
    const processing = processWalletReturns({ inbox, journal, rpc: delayed, now: clock(1000) });
    await started;
    await inbox.add({ kind: 'hashes', hashes: [OTHER_TX] });
    resume();
    expect((await processing).pending).toBe(2);
    expect(inbox.items().flatMap((item) => item.hashes).sort()).toEqual([TX, OTHER_TX].sort());
  });

  it('a stale concurrent pass cannot resurrect a return another pass already consumed', async () => {
    const { journal, inbox } = await setup();
    await inbox.add({ kind: 'hashes', hashes: [TX] });
    const snapshot = inbox.items();
    await processWalletReturns({ inbox, journal, rpc: txRpc({ [TX]: payTx }), now: clock(1000) });
    await inbox.complete(snapshot, snapshot);
    expect(inbox.items()).toEqual([]);
  });

  it('concurrent tabs serialize inbox arrivals and do not evict references when full', async () => {
    const { storage } = await setup();
    const lock = inProcessJournalLock();
    const one = new WalletReturnInbox(storage, clock(), lock);
    const two = new WalletReturnInbox(storage, clock(), lock);
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? one : two).add({ kind: 'hashes', hashes: [hashOf(`return-${i}`)] })));
    expect(one.items()).toHaveLength(20);
    await expect(two.add({ kind: 'hashes', hashes: [OTHER_TX] })).rejects.toThrow('full');
    expect(one.items()).toHaveLength(20);
  });

  it('bounds RPC work for a batch of untrusted hashes and keeps undecided references', async () => {
    const { journal, inbox } = await setup();
    await inbox.add({ kind: 'hashes', hashes: Array.from({ length: 8 }, (_, i) => hashOf(`unknown-${i}`)) });
    const rpc = txRpc({});
    expect((await processWalletReturns({ inbox, journal, rpc, now: clock(1000) })).pending).toBe(1);
    expect(rpc.calls).toHaveLength(WALLET_RETURN_RPC_BUDGET);
    expect(inbox.items()[0]?.hashes).toHaveLength(8);
    await processWalletReturns({ inbox, journal, rpc, now: clock(6000) });
    expect(rpc.calls).toHaveLength(2 * WALLET_RETURN_RPC_BUDGET);
  });
  it('success: binds the returned hash after the chain confirms signer, contract, method and request', async () => {
    const { journal, inbox, entry } = await setup();
    await inbox.add({ kind: 'hashes', hashes: [TX] });
    const rpc = txRpc({ [TX]: payTx });
    const result = await processWalletReturns({ inbox, journal, rpc, now: clock(1000) });
    expect(result).toEqual({ journalChanged: true, pending: 0 });
    expect(journal.find(ID, 'pay_instant_native', PAYER)).toMatchObject({ phase: 'SUBMITTED', transactionHash: TX });
    expect(inbox.items()).toEqual([]);
    // Still blocking: SUBMITTED waits for a finalized read like any other attempt.
    expect(isBlocking({ ...entry, phase: 'SUBMITTED' })).toBe(true);
    expect(rpc.calls).toEqual(['EXPERIMENTAL_tx_status']);
  });

  it('an unsigned redirect decline cannot remove the duplicate brake', async () => {
    const { journal, inbox } = await setup();
    await inbox.add({ kind: 'rejected' });
    await processWalletReturns({ inbox, journal, rpc: txRpc({}), now: clock(1000) });
    expect(journal.find(ID, 'pay_instant_native', PAYER)?.phase).toBe('OUTCOME_UNKNOWN');
  });

  it('rejection cannot touch an attempt that already returned a hash or was explained', async () => {
    const { journal, inbox } = await setup();
    await journal.update(
      { requestId: ID, method: 'pay_instant_native', signerAccountId: PAYER },
      { phase: 'SUBMITTED', transactionHash: TX },
    );
    await inbox.add({ kind: 'rejected' });
    await processWalletReturns({ inbox, journal, rpc: txRpc({}), now: clock(1000) });
    expect(journal.find(ID, 'pay_instant_native', PAYER)).toMatchObject({ phase: 'SUBMITTED', transactionHash: TX });
  });

  it('timeout: a hash the chain does not know yet keeps the attempt blocking and is retried later', async () => {
    const { journal, inbox } = await setup();
    await inbox.add({ kind: 'hashes', hashes: [TX] });
    const result = await processWalletReturns({ inbox, journal, rpc: txRpc({}), now: clock(1000) });
    expect(result.pending).toBe(1);
    const entry = journal.find(ID, 'pay_instant_native', PAYER);
    expect(entry?.phase).toBe('OUTCOME_UNKNOWN');
    expect(entry !== null && isBlocking(entry)).toBe(true);
    // Later the chain knows it.
    const later = await processWalletReturns({ inbox, journal, rpc: txRpc({ [TX]: payTx }), now: clock(6000) });
    expect(later.pending).toBe(0);
    expect(journal.find(ID, 'pay_instant_native', PAYER)).toMatchObject({ phase: 'SUBMITTED', transactionHash: TX });
  });

  it('RPC lag: keeps the hash after the backoff cap, and binds it when it becomes available', async () => {
    const { journal, inbox, storage } = await setup();
    storage.setItem(
      WALLET_RETURN_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        items: [
          {
            id: `hashes:${TX}`,
            kind: 'hashes',
            hashes: [TX],
            receivedAt: T0.toISOString(),
            attempts: WALLET_RETURN_MAX_ATTEMPTS,
          },
        ],
      }),
    );
    const result = await processWalletReturns({ inbox, journal, rpc: txRpc({}), now: clock(1000) });
    expect(result.pending).toBe(1);
    const entry = journal.find(ID, 'pay_instant_native', PAYER);
    expect(entry !== null && isBlocking(entry)).toBe(true);
    const later = await processWalletReturns({ inbox, journal, rpc: txRpc({ [TX]: payTx }), now: clock(3600_000) });
    expect(later.pending).toBe(0);
    expect(journal.find(ID, 'pay_instant_native', PAYER)?.transactionHash).toBe(TX);
  });

  it('duplicate callback: the same return twice is stored once and binds once', async () => {
    const { journal, inbox } = await setup();
    const href = `https://app.example/pay/${ID}?transactionHashes=${TX}`;
    await captureWalletReturn(inbox, { href, search: `?transactionHashes=${TX}` }, () => undefined);
    await captureWalletReturn(inbox, { href, search: `?transactionHashes=${TX}` }, () => undefined);
    expect(inbox.items()).toHaveLength(1);
    const rpc = txRpc({ [TX]: payTx });
    await processWalletReturns({ inbox, journal, rpc, now: clock(1000) });
    const first = journal.find(ID, 'pay_instant_native', PAYER);
    // Delivered again after processing: nothing left to bind, nothing changes.
    await captureWalletReturn(inbox, { href, search: `?transactionHashes=${TX}` }, () => undefined);
    const again = await processWalletReturns({ inbox, journal, rpc, now: clock(2000) });
    expect(again.journalChanged).toBe(false);
    expect(journal.find(ID, 'pay_instant_native', PAYER)).toEqual(first);
  });

  it('stale state: a return older than 24 hours is dropped without changing the journal', async () => {
    const { journal, inbox } = await setup();
    await inbox.add({ kind: 'hashes', hashes: [TX] });
    const result = await processWalletReturns({
      inbox,
      journal,
      rpc: txRpc({ [TX]: payTx }),
      now: clock(25 * 3600 * 1000),
    });
    expect(result).toEqual({ journalChanged: false, pending: 0 });
    expect(journal.find(ID, 'pay_instant_native', PAYER)?.phase).toBe('AWAITING_SIGNATURE');
  });

  it('stale state: a hash for a different call is never bound', async () => {
    const { journal, inbox } = await setup();
    await inbox.add({ kind: 'hashes', hashes: [OTHER_TX] });
    const rpc = txRpc({
      [OTHER_TX]: { ...payTx, args: { id: 'f'.repeat(64), expectedTermsHash: openRestricted.termsHash } },
    });
    const result = await processWalletReturns({ inbox, journal, rpc, now: clock(1000) });
    expect(result.pending).toBe(0);
    const entry = journal.find(ID, 'pay_instant_native', PAYER);
    expect(entry?.transactionHash).toBeNull();
    expect(entry?.phase).toBe('OUTCOME_UNKNOWN');
  });

  it('reload: the inbox and journal survive new instances over the same storage', async () => {
    const { storage, inbox } = await setup();
    await inbox.add({ kind: 'hashes', hashes: [TX] });
    // "Reload": fresh objects, same storage.
    const journal2 = new SubmissionJournal(storage, clock(5000));
    const inbox2 = new WalletReturnInbox(storage, clock(5000));
    expect(inbox2.items()).toHaveLength(1);
    await processWalletReturns({ inbox: inbox2, journal: journal2, rpc: txRpc({ [TX]: payTx }), now: clock(5000) });
    expect(journal2.find(ID, 'pay_instant_native', PAYER)?.transactionHash).toBe(TX);
  });

  it('a lost reference never unblocks or resubmits: the entry waits for the chain to explain it', async () => {
    const { journal, inbox, entry } = await setup();
    await inbox.add({ kind: 'error' });
    await processWalletReturns({ inbox, journal, rpc: txRpc({}), now: clock(1000) });
    const after = journal.find(ID, 'pay_instant_native', PAYER);
    expect(after?.phase).toBe('OUTCOME_UNKNOWN');
    expect(after !== null && isBlocking(after)).toBe(true);
    // Still OPEN at a final block one minute later: not explained, re-attempt not offered.
    const view = {
      kind: 'ok' as const,
      request: openRestricted,
      response: {} as never,
      observedAtNs: (BigInt(Date.parse(entry.startedAt)) * 1_000_000n + 60_000_000_000n).toString(),
    };
    expect(after !== null && reconcile(after, view, BigInt(Date.parse(entry.startedAt)) * 1_000_000n)).toBe('pending');
  });

  it('without an RPC the return is kept for later and nothing is bound', async () => {
    const { journal, inbox } = await setup();
    await inbox.add({ kind: 'hashes', hashes: [TX] });
    const result = await processWalletReturns({ inbox, journal, rpc: null, now: clock(1000) });
    expect(result.pending).toBe(1);
    expect(journal.find(ID, 'pay_instant_native', PAYER)?.transactionHash).toBeNull();
  });
});

describe('Phase 6A: mobile redirect race', () => {
  it('a hash returned after the screen already RESOLVED the attempt is still attached; the entry stays RESOLVED', async () => {
    const { journal, inbox } = await setup();
    // The payment screen saw FINAL_PAID first and resolved the hash-less attempt.
    await journal.update({ requestId: ID, method: 'pay_instant_native', signerAccountId: PAYER }, { phase: 'RESOLVED' });
    await inbox.add({ kind: 'hashes', hashes: [TX] });
    const result = await processWalletReturns({ inbox, journal, rpc: txRpc({ [TX]: payTx }), now: clock(1000) });
    expect(result).toEqual({ journalChanged: true, pending: 0 });
    const after = journal.find(ID, 'pay_instant_native', PAYER);
    expect(after).toMatchObject({ phase: 'RESOLVED', transactionHash: TX });
    expect(after !== null && isBlocking(after)).toBe(false);
  });

  it('a hash that does not match on chain is never attached to a resolved attempt', async () => {
    const { journal, inbox } = await setup();
    await journal.update({ requestId: ID, method: 'pay_instant_native', signerAccountId: PAYER }, { phase: 'RESOLVED' });
    await inbox.add({ kind: 'hashes', hashes: [OTHER_TX] });
    await processWalletReturns({
      inbox,
      journal,
      rpc: txRpc({ [OTHER_TX]: { ...payTx, args: { id: '0'.repeat(64) } } }),
      now: clock(1000),
    });
    expect(journal.find(ID, 'pay_instant_native', PAYER)).toMatchObject({ phase: 'RESOLVED', transactionHash: null });
  });

  it('a late outcome cannot re-block an explained attempt (RESOLVED is sticky); a new begin still replaces it', async () => {
    const { journal } = await setup();
    const target = { requestId: ID, method: 'pay_instant_native' as const, signerAccountId: PAYER };
    await journal.update(target, { phase: 'RESOLVED' });
    await journal.update(target, { phase: 'OUTCOME_UNKNOWN' });
    expect(journal.find(ID, 'pay_instant_native', PAYER)?.phase).toBe('RESOLVED');
    await journal.update(target, { phase: 'SUBMITTED', transactionHash: TX });
    expect(journal.find(ID, 'pay_instant_native', PAYER)).toMatchObject({ phase: 'RESOLVED', transactionHash: TX });
    const again = await journal.begin({
      ...target,
      network: 'near-testnet',
      contractId: CONTRACT,
      termsHash: openRestricted.termsHash,
      terms: null,
      operationNonce: null,
    });
    expect(again).toMatchObject({ phase: 'AWAITING_SIGNATURE', transactionHash: null });
  });
});

describe('matchTransaction', () => {
  const entry = async () => (await setup()).entry;

  it.each([
    ['another signer', { ...payTx, signer: 'mallory.testnet' }, 'unknown'],
    ['another contract', { ...payTx, receiver: 'other.testnet' }, 'mismatch'],
    ['another method', { ...payTx, method: 'cancel_unfunded' }, 'mismatch'],
    ['two actions', { ...payTx, actions: 2 }, 'mismatch'],
    ['another request', { ...payTx, args: { id: '0'.repeat(64) } }, 'mismatch'],
    ['another terms hash', { ...payTx, args: { id: ID, expectedTermsHash: '0'.repeat(64) } }, 'mismatch'],
    ['the journaled call', payTx, 'match'],
  ])('%s -> %s', async (_label, tx, expected) => {
    expect(await matchTransaction(txRpc({ [TX]: tx }), TX, await entry())).toBe(expected);
  });

  it('create_request matches on terms.id', async () => {
    const storage = memoryStorage();
    const journal = new SubmissionJournal(storage, clock(), inProcessJournalLock());
    const created = await journal.begin({
      method: 'create_request',
      network: 'near-testnet',
      contractId: CONTRACT,
      requestId: ID,
      termsHash: openRestricted.termsHash,
      signerAccountId: openRestricted.recipientAccountId,
      terms: openRestricted.terms,
      operationNonce: null,
    });
    const rpc = txRpc({
      [TX]: {
        signer: openRestricted.recipientAccountId,
        receiver: CONTRACT,
        method: 'create_request',
        args: { terms: openRestricted.terms, quoteVersion: '1' },
      },
    });
    expect(await matchTransaction(rpc, TX, created)).toBe('match');
  });

  it('a retry hash must match the expected operation nonce, not just the request ID', async () => {
    const target = { ...(await entry()), method: 'retry_native_transfer' as const, operationNonce: '2' };
    const tx = { ...payTx, method: 'retry_native_transfer', args: { id: ID, expectedOperationNonce: '1' } };
    expect(await matchTransaction(txRpc({ [TX]: tx }), TX, target)).toBe('mismatch');
  });
});
