import { describe, expect, it } from 'vitest';
import type { PaymentRequestRead, ReadResult } from '@taply/near-client';
import { PROTECTED, PROTECTED_CONTRACT } from '@/test/protected-fixtures';
import type { ContractRequest } from '@/lib/protocol';
import { mapChainState } from '@/lib/payments/map-chain-state';
import type { JournalEntry } from '@/lib/payments/journal';
import { reconcile } from '@/lib/payments/submit';
import { buildProtectedView } from '../view';
import { protectedSigningGate, resolveProtectedSetup } from '../setup';
import { durationSeconds, estimateCutoff, formatCountdown } from '@/lib/format/countdown';

const BLOCK = '11111111111111111111111111111113';
const CODE = 'BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B';

function read(request: ContractRequest | null, timestampNs: string | bigint, overrides: Partial<ReadResult<PaymentRequestRead>['observation']> = {}): ReadResult<PaymentRequestRead> {
  return {
    observation: {
      source: 'rpc',
      assurance: 'verified_final',
      data: { id: request?.terms.id ?? 'ab'.repeat(32), request },
      observedBlock: { hash: BLOCK, height: '1000', timestampNs: timestampNs.toString() },
      checkedAt: '2026-11-09T12:00:00.000Z',
      stale: false,
      rpcAvailable: true,
      ...overrides,
    },
    error: null,
  };
}
const view = (request: ContractRequest, at: string | bigint, accountId: string | null = null, overrides = {}) =>
  buildProtectedView({ read: read(request, at, overrides), expectedContractId: PROTECTED_CONTRACT, accountId });
const cutoff = BigInt(PROTECTED.locked.cancelUntilNs!);
// The release snapshot's operation started at the cutoff; read it a little later.
const after = (r: ContractRequest) => BigInt(r.latestOperation?.resolvedAtNs ?? r.latestOperation?.startedAtNs ?? r.createdAtNs) + 1n;

describe('buildProtectedView', () => {
  it('opens funding only on a fresh read before expiry', () => {
    const v = view(PROTECTED.open, PROTECTED.open.createdAtNs, 'bob.testnet');
    expect(v.kind).toBe('ok');
    if (v.kind !== 'ok') return;
    expect(v.response.fundingEligibility).toBe('ELIGIBLE');
    const expired = view(PROTECTED.open, PROTECTED.open.terms.fundingExpiresAtNs);
    expect(expired.kind === 'ok' && expired.response.fundingEligibility).toBe('EXPIRED');
    const stale = view(PROTECTED.open, PROTECTED.open.createdAtNs, null, { stale: true });
    expect(stale.kind === 'ok' && stale.response.fundingEligibility).toBe('UNKNOWN');
  });

  it('LOCKED: cancel window by chain time, release exactly at the cutoff, never both', () => {
    const before = view(PROTECTED.locked, cutoff - 1n, 'bob.testnet');
    const at = view(PROTECTED.locked, cutoff, 'bob.testnet');
    expect(before.kind === 'ok' && before.response.derived).toMatchObject({ cancelWindowOpen: true, releaseEligible: false, callerRole: 'payer' });
    expect(at.kind === 'ok' && at.response.derived).toMatchObject({ cancelWindowOpen: false, releaseEligible: true });
    // A stale or unverified read projects nothing.
    const stale = view(PROTECTED.locked, cutoff - 1n, 'bob.testnet', { stale: true });
    expect(stale.kind === 'ok' && stale.response.derived).toMatchObject({ cancelWindowOpen: null, releaseEligible: null });
  });

  it('LOCKED is never paid, and CTAs follow role and chain time', () => {
    const payer = view(PROTECTED.locked, cutoff - 1n, 'bob.testnet');
    const recipient = view(PROTECTED.locked, cutoff - 1n, 'alice.testnet');
    const anyone = view(PROTECTED.locked, cutoff, 'carol.testnet');
    for (const v of [payer, recipient, anyone]) {
      expect(v.kind).toBe('ok');
      if (v.kind !== 'ok') return;
      const p = mapChainState({ state: v.request.status, observation: v.response.observation, derived: v.response.derived,
        fundingEligibility: v.response.fundingEligibility, incident: v.response.incident, settlementProof: 'contract_state_only' });
      expect(p.verifiedRibbon).toBe(false);
      expect(p.contractReportsPaid).toBe(false);
      expect(p.money).toBe('escrowed');
    }
    const ctas = (v: typeof payer) => v.kind === 'ok'
      ? mapChainState({ state: v.request.status, observation: v.response.observation, derived: v.response.derived,
        fundingEligibility: v.response.fundingEligibility, incident: v.response.incident, settlementProof: 'contract_state_only' }).ctas.map((c) => c.kind)
      : [];
    expect(ctas(payer)).toContain('cancel_protected');
    expect(ctas(recipient)).not.toContain('cancel_protected');
    expect(ctas(recipient)).not.toContain('release_protected');
    expect(ctas(anyone)).toContain('release_protected');
  });

  it('retry only for the beneficiary of the committed branch', () => {
    const at = after(PROTECTED.refundFailed);
    const payer = view(PROTECTED.refundFailed, at, 'bob.testnet');
    const recipient = view(PROTECTED.refundFailed, at, 'alice.testnet');
    expect(payer.kind === 'ok' && payer.response.derived.retry.eligible).toBe(true);
    expect(recipient.kind === 'ok' && recipient.response.derived.retry.eligible).toBe(false);
    const rAt = after(PROTECTED.releaseFailed);
    expect((() => { const v = view(PROTECTED.releaseFailed, rAt, 'alice.testnet'); return v.kind === 'ok' && v.response.derived.retry.eligible; })()).toBe(true);
    expect((() => { const v = view(PROTECTED.releaseFailed, rAt, 'bob.testnet'); return v.kind === 'ok' && v.response.derived.retry.eligible; })()).toBe(false);
  });

  it('refunded says refunded; long in-flight becomes an incident', () => {
    const r = view(PROTECTED.refunded, after(PROTECTED.refunded), 'bob.testnet');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    const p = mapChainState({ state: r.request.status, observation: r.response.observation, derived: r.response.derived,
      fundingEligibility: r.response.fundingEligibility, incident: r.response.incident, settlementProof: 'verified_receipt' });
    expect(p.verifiedRibbon).toBe(false);
    expect(p.money).toBe('returned_to_payer');
    const stuck = view(PROTECTED.releaseInFlight, BigInt(PROTECTED.releaseInFlight.latestOperation!.startedAtNs) + 301_000_000_000n);
    expect(stuck.kind === 'ok' && stuck.response.incident).toBe('RECONCILIATION_REQUIRED');
  });

  it('refuses requests from another contract or of instant mode', () => {
    expect(buildProtectedView({ read: read(PROTECTED.locked, cutoff), expectedContractId: 'other.testnet', accountId: null }).kind).toBe('wrong_contract');
    const instant = { ...PROTECTED.open, terms: { ...PROTECTED.open.terms, mode: 'instant' as const, cancelDurationNs: null } };
    expect(view(instant, PROTECTED.open.createdAtNs).kind).not.toBe('ok');
  });
});

describe('protected journal reconciliation', () => {
  const entry = (method: JournalEntry['method'], request: ContractRequest, operationNonce: string | null = null): JournalEntry => ({
    method, network: 'near-testnet', contractId: PROTECTED_CONTRACT, requestId: request.terms.id, termsHash: request.termsHash,
    signerAccountId: 'bob.testnet', terms: null, operationNonce, phase: 'SUBMITTED', transactionHash: BLOCK,
    startedAt: '2026-11-09T12:00:00.000Z', updatedAt: '2026-11-09T12:00:00.000Z',
  });
  const reconcileAt = (e: JournalEntry, request: ContractRequest, at: bigint) => {
    const v = view(request, at, 'bob.testnet');
    return reconcile(e, v, 0n);
  };

  it('fund: pending while OPEN and unexpired, resolved once locked or expired', () => {
    expect(reconcileAt(entry('fund_protected_native', PROTECTED.open), PROTECTED.open, BigInt(PROTECTED.open.createdAtNs))).toBe('pending');
    expect(reconcileAt(entry('fund_protected_native', PROTECTED.open), PROTECTED.locked, cutoff - 1n)).toBe('resolved');
    expect(reconcileAt(entry('fund_protected_native', PROTECTED.open), PROTECTED.open, BigInt(PROTECTED.open.terms.fundingExpiresAtNs))).toBe('resolved');
  });

  it('cancel: still LOCKED before cutoff is pending; at/after the cutoff it can never execute', () => {
    expect(reconcileAt(entry('cancel_protected', PROTECTED.locked), PROTECTED.locked, cutoff - 1n)).toBe('pending');
    expect(reconcileAt(entry('cancel_protected', PROTECTED.locked), PROTECTED.locked, cutoff)).toBe('resolved');
    expect(reconcileAt(entry('cancel_protected', PROTECTED.locked), PROTECTED.refundInFlight, after(PROTECTED.refundInFlight))).toBe('resolved');
  });

  it('release: only a committed branch explains it', () => {
    expect(reconcileAt(entry('release_protected', PROTECTED.locked), PROTECTED.locked, cutoff + 10n)).toBe('pending');
    expect(reconcileAt(entry('release_protected', PROTECTED.locked), PROTECTED.releaseInFlight, after(PROTECTED.releaseInFlight))).toBe('resolved');
  });

  it('retry of a failed refund stays pending until the failure nonce changes', () => {
    const e = entry('retry_native_transfer', PROTECTED.refundFailed, PROTECTED.refundFailed.latestOperation!.nonce);
    expect(reconcileAt(e, PROTECTED.refundFailed, after(PROTECTED.refundFailed))).toBe('pending');
    expect(reconcileAt(e, PROTECTED.refunded, after(PROTECTED.refunded))).toBe('resolved');
  });
});

describe('protected setup and signing gate', () => {
  const env = { flag: true, contractId: PROTECTED_CONTRACT, codeHash: CODE, qa: undefined };
  it('fails closed without flag, config, or for the G1 pilot', () => {
    expect(resolveProtectedSetup({ ...env, flag: false }).status).toBe('flag_off');
    expect(resolveProtectedSetup({ ...env, contractId: undefined, codeHash: undefined }).status).toBe('not_configured');
    expect(resolveProtectedSetup({ ...env, codeHash: undefined }).status).toBe('invalid');
    expect(resolveProtectedSetup({ ...env, contractId: 'taply-pay-pilot-1.testnet' }).status).toBe('pilot_refused');
  });
  it('an unreviewed candidate signs only on an explicit QA build', () => {
    const prod = resolveProtectedSetup(env);
    const qa = resolveProtectedSetup({ ...env, qa: 'on' });
    expect(protectedSigningGate(prod, PROTECTED.config)).toEqual({ allowed: false, problems: ['UNREVIEWED_CANDIDATE'] });
    expect(protectedSigningGate(qa, PROTECTED.config)).toEqual({ allowed: true, unreviewed: true });
    // Other problems are never waivable.
    expect(protectedSigningGate(qa, { ...PROTECTED.config, testFaultBuild: true }).allowed).toBe(false);
  });
});

describe('countdown', () => {
  it('is an estimate from the last final block, never below zero', () => {
    const base = { cancelUntilNs: '60000000000', observedAtNs: '0', observedAtLocalMs: 1_000 };
    expect(estimateCutoff({ ...base, nowMs: 1_000 })).toEqual({ phase: 'open', remainingMs: 60_000 });
    expect(estimateCutoff({ ...base, nowMs: 31_000 })).toEqual({ phase: 'open', remainingMs: 30_000 });
    expect(estimateCutoff({ ...base, nowMs: 61_000 })).toEqual({ phase: 'reached_by_estimate' });
    // A device clock going backwards does not add time.
    expect(estimateCutoff({ ...base, nowMs: 0 })).toEqual({ phase: 'open', remainingMs: 60_000 });
    expect(formatCountdown(61_500)).toBe('1:02');
    expect(formatCountdown(-5)).toBe('0:00');
    expect(durationSeconds('3600000000000')).toBe(3600);
  });
});
