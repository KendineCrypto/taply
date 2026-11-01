import { describe, expect, it } from 'vitest';
import type { PaymentRequestRead, ReadResult } from '@taply/near-client';
import { FIXTURES } from '@/test/chain';
import { resolveContractSetting, resolveChainConfig } from '@/lib/near/config';
import { resolveFlags } from '@/lib/flags/features';
import { calculateRequestId, calculateTermsHash } from '@/lib/protocol';
import type { ContractRequest } from '@/lib/protocol';
import { WalletError } from '@/lib/wallet/adapter';
import { transactionHashOf } from '@/lib/wallet/adapter';
import { buildInstantTerms, newCreationNonce, payLink, validateRequestForm } from '../create';
import { buildPaymentView, callerRoleFor, IN_FLIGHT_INCIDENT_AFTER_NS } from '../intent';
import { JournalBlockedError, SubmissionJournal } from '../journal';
import type { JournalEntry } from '../journal';
import { reconcile, submitCall } from '../submit';
import { signingBlockFor } from '../context';

const { openRestricted, paidRestricted, open, failed, inFlight, cancelled } = FIXTURES;
const TX = '11111111111111111111111111111113';

function read(request: ContractRequest | null, timestampNs: string, overrides: Partial<ReadResult<PaymentRequestRead>['observation']> = {}): ReadResult<PaymentRequestRead> {
  const id = request?.terms.id ?? 'ab'.repeat(32);
  return {
    observation: {
      source: 'rpc',
      assurance: 'verified_final',
      data: { id, request },
      observedBlock: { hash: TX, height: '1000', timestampNs },
      checkedAt: '2026-10-31T21:00:00.000Z',
      stale: false,
      rpcAvailable: true,
      ...overrides,
    },
    error: null,
  };
}

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe('buildPaymentView', () => {
  const contractId = open.terms.contractId;

  it('validates against the shared PaymentIntentResponse schema and derives eligibility from chain time', () => {
    const before = buildPaymentView({ read: read(open, '1793476890000000000'), expectedContractId: contractId, accountId: 'payer.testnet' });
    expect(before.kind).toBe('ok');
    if (before.kind !== 'ok') return;
    expect(before.response.fundingEligibility).toBe('ELIGIBLE');
    expect(before.response.derived.callerRole).toBe('observer');
    const at = buildPaymentView({ read: read(open, open.terms.fundingExpiresAtNs), expectedContractId: contractId, accountId: null });
    expect(at.kind === 'ok' && at.response.fundingEligibility).toBe('EXPIRED');
  });

  it('never makes an uncertain, stale, mock or offline read actionable', () => {
    for (const overrides of [
      { stale: true },
      { rpcAvailable: false, stale: true },
      { assurance: 'pending_finality' as const },
    ]) {
      const view = buildPaymentView({ read: read(open, '1793476890000000000', overrides), expectedContractId: contractId, accountId: 'x.testnet' });
      expect(view.kind === 'ok' && view.response.fundingEligibility, JSON.stringify(overrides)).not.toBe('ELIGIBLE');
    }
    const mock = buildPaymentView({
      read: read(failed, '1793476909000000000', { source: 'mock', assurance: 'unverified', observedBlock: null, rpcAvailable: false }),
      expectedContractId: failed.terms.contractId,
      accountId: failed.recipientAccountId,
    });
    expect(mock.kind).toBe('unavailable'); // no block provenance at all
  });

  it('retry is derived only for the recipient of a recorded failure', () => {
    const recipient = buildPaymentView({ read: read(failed, '1793476909000000000'), expectedContractId: failed.terms.contractId, accountId: failed.recipientAccountId });
    expect(recipient.kind === 'ok' && recipient.response.derived.retry).toEqual({ eligible: true, operationNonce: '1', kind: 'INSTANT_PAYOUT' });
    const payer = buildPaymentView({ read: read(failed, '1793476909000000000'), expectedContractId: failed.terms.contractId, accountId: failed.payerAccountId });
    expect(payer.kind === 'ok' && payer.response.derived.retry.eligible).toBe(false);
  });

  it('a long in-flight transfer becomes RECONCILIATION_REQUIRED, never retryable', () => {
    const started = BigInt(inFlight.latestOperation!.startedAtNs);
    const fresh = buildPaymentView({ read: read(inFlight, (started + 1n).toString()), expectedContractId: inFlight.terms.contractId, accountId: inFlight.recipientAccountId });
    expect(fresh.kind === 'ok' && fresh.response.incident).toBeNull();
    const old = buildPaymentView({
      read: read(inFlight, (started + IN_FLIGHT_INCIDENT_AFTER_NS + 1n).toString()),
      expectedContractId: inFlight.terms.contractId,
      accountId: inFlight.recipientAccountId,
    });
    expect(old.kind === 'ok' && old.response.incident).toBe('RECONCILIATION_REQUIRED');
    expect(old.kind === 'ok' && old.response.derived.retry.eligible).toBe(false);
  });

  it('fails closed on another contract, a block older than the state, or a missing request', () => {
    expect(buildPaymentView({ read: read(open, '1793476890000000000'), expectedContractId: 'other.testnet', accountId: null }).kind).toBe('wrong_contract');
    expect(buildPaymentView({ read: read(paidRestricted, '1'), expectedContractId: paidRestricted.terms.contractId, accountId: null }).kind).toBe('inconsistent');
    expect(buildPaymentView({ read: read(null, '1793476890000000000'), expectedContractId: contractId, accountId: null }).kind).toBe('not_found');
  });

  it('caller roles', () => {
    expect(callerRoleFor(openRestricted, null)).toBe('anonymous');
    expect(callerRoleFor(openRestricted, openRestricted.terms.permittedPayerAccountId)).toBe('payer');
    expect(callerRoleFor(openRestricted, openRestricted.recipientAccountId)).toBe('recipient');
    expect(callerRoleFor(paidRestricted, paidRestricted.payerAccountId)).toBe('payer');
    expect(callerRoleFor(open, 'someone.testnet')).toBe('observer');
  });
});

describe('journal and submission', () => {
  const base = {
    method: 'pay_instant_native' as const,
    network: 'near-testnet' as const,
    contractId: open.terms.contractId,
    requestId: open.terms.id,
    termsHash: open.termsHash,
    signerAccountId: 'payer.testnet',
    terms: null,
    operationNonce: null,
  };
  const call = {
    receiverId: open.terms.contractId,
    methodName: 'pay_instant_native' as const,
    args: { id: open.terms.id, expectedTermsHash: open.termsHash },
    gas: '50000000000000',
    depositYocto: open.terms.amountBaseUnits,
  };
  const submit = (journal: SubmissionJournal | null, signAndSend: Parameters<typeof submitCall>[0]['signAndSend']) =>
    submitCall({ journal, call, signerAccountId: 'payer.testnet', requestId: open.terms.id, termsHash: open.termsHash, signAndSend });

  it('journals before signing; outcomes map to phases; an unexplained attempt blocks the next', async () => {
    const storage = memory();
    const journal = new SubmissionJournal(storage);
    let seenBeforeSigning: JournalEntry | null = null;
    const first = await submit(journal, async () => {
      seenBeforeSigning = journal.find(open.terms.id, 'pay_instant_native', 'payer.testnet');
      return { kind: 'unknown' };
    });
    expect(seenBeforeSigning).toMatchObject({ phase: 'AWAITING_SIGNATURE' });
    expect(first).toEqual({ kind: 'unknown' });
    const second = await submit(journal, async () => {
      throw new Error('must not be called');
    });
    expect(second.kind).toBe('blocked');
    expect(() => journal.begin(base)).toThrow(JournalBlockedError);
  });

  it('decline -> USER_REJECTED (not blocking); hash -> SUBMITTED; wrong account -> nothing sent', async () => {
    const journal = new SubmissionJournal(memory());
    expect(await submit(journal, async () => Promise.reject(new WalletError('cancelled')))).toEqual({ kind: 'rejected' });
    expect(journal.find(open.terms.id, 'pay_instant_native', 'payer.testnet')?.phase).toBe('USER_REJECTED');
    expect(await submit(journal, async () => ({ kind: 'submitted', transactionHash: TX }))).toEqual({ kind: 'submitted', transactionHash: TX });
    expect(journal.find(open.terms.id, 'pay_instant_native', 'payer.testnet')).toMatchObject({ phase: 'SUBMITTED', transactionHash: TX });
    const other = new SubmissionJournal(memory());
    expect(await submitCall({ journal: other, call, signerAccountId: 'payer.testnet', requestId: open.terms.id, termsHash: open.termsHash,
      signAndSend: async () => Promise.reject(new WalletError('no_account')) })).toEqual({ kind: 'wrong_account' });
  });

  it('refuses to sign without a readable journal', async () => {
    const signed: unknown[] = [];
    expect(await submit(null, async () => (signed.push(1), { kind: 'unknown' }))).toEqual({ kind: 'no_journal' });
    const corrupt = memory();
    corrupt.setItem('taply.journal.v1', '{"version":1,"entries":[{"phase":"PAID"}]}');
    expect(await submit(new SubmissionJournal(corrupt), async () => (signed.push(1), { kind: 'unknown' }))).toEqual({ kind: 'no_journal' });
    expect(signed).toHaveLength(0);
  });

  it('stores only public data', async () => {
    const storage = memory();
    await submit(new SubmissionJournal(storage), async () => ({ kind: 'submitted', transactionHash: TX }));
    expect(storage.data.get('taply.journal.v1')).not.toMatch(/ed25519|secret|private|seed/i);
  });

  it('reconcile: only a finalized read explains an attempt', () => {
    const entry = { ...base, phase: 'OUTCOME_UNKNOWN' as const, transactionHash: null, startedAt: '2026-10-31T21:00:00.000Z', updatedAt: '2026-10-31T21:00:00.000Z' };
    const startedNs = BigInt(Date.parse(entry.startedAt)) * 1_000_000n;
    const at = (seconds: bigint) => (startedNs + seconds * 1_000_000_000n).toString();
    // 24 h funding window, so it is still fundable at these chain times.
    const openView = (ns: string) => buildPaymentView({ read: read(openRestricted, ns), expectedContractId: openRestricted.terms.contractId, accountId: 'payer.testnet' });
    // OPEN shortly after: unexplained. OPEN 2+ minutes later: a person may deliberately re-review.
    expect(reconcile(entry, openView(at(10n)), startedNs)).toBe('pending');
    expect(reconcile(entry, openView(at(130n)), startedNs)).toBe('may_reattempt');
    // Funded or cancelled by anyone: resolved (the contract accepts one funding).
    const funded = buildPaymentView({ read: read(paidRestricted, at(10n)), expectedContractId: paidRestricted.terms.contractId, accountId: null });
    expect(reconcile({ ...entry, requestId: paidRestricted.terms.id }, funded, startedNs)).toBe('resolved');
    const gone = buildPaymentView({ read: read(cancelled, at(10n)), expectedContractId: cancelled.terms.contractId, accountId: null });
    expect(reconcile(entry, gone, startedNs)).toBe('resolved');
    // OPEN at a final block at/after expiry: a payment can no longer land, so it is explained.
    const expiredOpen = buildPaymentView({ read: read(open, open.terms.fundingExpiresAtNs), expectedContractId: open.terms.contractId, accountId: null });
    expect(reconcile(entry, expiredOpen, BigInt(open.terms.fundingExpiresAtNs))).toBe('resolved');
    // ...but an unexplained cancel of that expired request is not (it can still be cancelled).
    expect(reconcile({ ...entry, method: 'cancel_unfunded' }, expiredOpen, BigInt(open.terms.fundingExpiresAtNs))).toBe('pending');
    // A failed read explains nothing.
    expect(reconcile(entry, { kind: 'unavailable', error: 'RPC_TIMEOUT' }, startedNs)).toBe('pending');
    // Retry: a newer operation nonce means the retry was used or superseded.
    const retryEntry = { ...entry, method: 'retry_native_transfer' as const, requestId: failed.terms.id, operationNonce: '1' };
    const stillFailed = buildPaymentView({ read: read(failed, at(10n)), expectedContractId: failed.terms.contractId, accountId: null });
    expect(reconcile(retryEntry, stillFailed, startedNs)).toBe('pending');
    expect(reconcile({ ...retryEntry, operationNonce: '7' }, stillFailed, startedNs)).toBe('resolved');
  });
});

describe('request creation', () => {
  it('validates the form with exact base units', () => {
    expect(validateRequestForm({ amount: '1.5', memo: '', payer: '' }, 'me.testnet')).toEqual({
      ok: true,
      value: { amountBaseUnits: '1500000000000000000000000', memo: '', permittedPayerAccountId: null },
    });
    expect(validateRequestForm({ amount: '', memo: 'x'.repeat(257), payer: 'Bad Account' }, 'me.testnet')).toEqual({
      ok: false,
      errors: ['amount_required', 'memo_too_long', 'payer_invalid'],
    });
    expect(validateRequestForm({ amount: '0', memo: '', payer: 'me.testnet' }, 'me.testnet')).toEqual({ ok: false, errors: ['amount_zero', 'payer_is_recipient'] });
    expect(validateRequestForm({ amount: '1e3', memo: '', payer: '' }, 'me.testnet')).toEqual({ ok: false, errors: ['amount_invalid'] });
    // 256 bytes of multi-byte text is allowed; 257 is not.
    expect(validateRequestForm({ amount: '1', memo: 'ğ'.repeat(128), payer: '' }, 'me.testnet').ok).toBe(true);
    expect(validateRequestForm({ amount: '1', memo: 'ğ'.repeat(128) + 'a', payer: '' }, 'me.testnet').ok).toBe(false);
  });

  it('builds terms whose id and hash come from @taply/shared; nonces are 32 random bytes', () => {
    const nonce = newCreationNonce();
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(newCreationNonce()).not.toBe(nonce);
    const { terms, termsHash } = buildInstantTerms({
      contractId: 'pay.testnet',
      creatorAccountId: 'me.testnet',
      creationNonce: nonce,
      form: { amountBaseUnits: '7', memo: '', permittedPayerAccountId: null },
      chainNowNs: '1000',
      lifetime: '1h',
    });
    expect(terms.id).toBe(calculateRequestId({ contractId: 'pay.testnet', creationNonce: nonce, creatorAccountId: 'me.testnet', network: 'near-testnet' }));
    expect(termsHash).toBe(calculateTermsHash(terms));
    expect(terms.fundingExpiresAtNs).toBe((1000n + 3_600_000_000_000n).toString());
  });

  it('share links are https (or local dev) and contain only the request id', () => {
    expect(payLink('https://taply.app', open.terms.id)).toBe(`https://taply.app/pay/${open.terms.id}`);
    expect(payLink('http://localhost:3000', open.terms.id)).toBe(`http://localhost:3000/pay/${open.terms.id}`);
    expect(() => payLink('http://evil.example', open.terms.id)).toThrow();
  });
});

describe('configuration and signing gate', () => {
  it('contract setting fails closed', () => {
    expect(resolveContractSetting(undefined, undefined)).toEqual({ status: 'not_configured' });
    expect(resolveContractSetting('pay.testnet', undefined)).toEqual({ status: 'invalid' });
    expect(resolveContractSetting(undefined, '11111111111111111111111111111111')).toEqual({ status: 'invalid' });
    expect(resolveContractSetting('Pay.Testnet', '11111111111111111111111111111111')).toEqual({ status: 'invalid' });
    expect(resolveContractSetting('pay.testnet', 'not-base58-0OIl')).toEqual({ status: 'invalid' });
    expect(resolveContractSetting('pay.testnet', '1111111111111111111111111111111')).toEqual({ status: 'invalid' }); // 31 bytes
    expect(resolveContractSetting('pay.testnet', '11111111111111111111111111111111')).toEqual({
      status: 'configured',
      accountId: 'pay.testnet',
      expectedCodeHash: '11111111111111111111111111111111',
    });
    const chain = resolveChainConfig({ contractId: 'pay.testnet', contractCodeHash: '11111111111111111111111111111111' });
    expect(chain.ok && chain.client.contract).toEqual({ accountId: 'pay.testnet', expectedCodeHash: '11111111111111111111111111111111' });
    const half = resolveChainConfig({ contractId: 'pay.testnet' });
    expect(half.ok && half.client.contract).toBeNull();
  });

  it('the instantPay signing flag is off by default and only env can turn it on', () => {
    expect(resolveFlags({}).instantPay.enabled).toBe(false);
    expect(resolveFlags({ NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY: 'on' }).instantPay.enabled).toBe(true);
    expect(resolveFlags({ NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY: 'yes' }).instantPay.enabled).toBe(false);
  });

  it('signing needs a ready setup, a verified contract and the flag, in that order', () => {
    const ready = { status: 'ready' as const, contractId: 'p.testnet', expectedCodeHash: 'h', signingFlag: true, explorerBaseUrl: 'https://x', reader: {} as never, verifierRpc: null };
    const verified = { status: 'verified' as const, config: {} as never, observedAtNs: '1' };
    expect(signingBlockFor({ status: 'not_configured' }, verified)).toBe('not_configured');
    expect(signingBlockFor(ready, { status: 'checking' })).toBe('contract_unverified');
    expect(signingBlockFor(ready, { status: 'rejected', problems: ['TEST_FAULT_BUILD'] })).toBe('contract_rejected');
    expect(signingBlockFor({ ...ready, signingFlag: false }, verified)).toBe('signing_flag_off');
    expect(signingBlockFor(ready, verified)).toBeNull();
  });

  it('wallet outcomes yield a transaction hash only when one is well-formed', () => {
    expect(transactionHashOf({ transaction: { hash: TX } })).toBe(TX);
    expect(transactionHashOf({ transaction_outcome: { id: TX } })).toBe(TX);
    expect(transactionHashOf({ transaction: { hash: '<img>' } })).toBeNull();
    expect(transactionHashOf(null)).toBeNull();
  });
});
