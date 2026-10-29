import { describe, expect, it } from 'vitest';
import { ASSURANCES, CALLER_ROLES, CHAIN_STATES } from '@/lib/protocol';
import type {
  Assurance,
  CallerRole,
  ChainState,
  DerivedPaymentActions,
  ObservationSource,
  PaymentIntentResponse,
} from '@/lib/protocol';
import { en } from '@/lib/i18n/dictionaries/en';
import { tr } from '@/lib/i18n/dictionaries/tr';
import { isInFlight, isRecoverableFailure, mapChainState } from '../map-chain-state';
import type { MapInput, StatusPresentation } from '../map-chain-state';

/**
 * Safety tests for the only module permitted to decide payment presentation.
 *
 * Phase 0.5: every enum now comes from `@taply/shared`, so these assertions run
 * over the real protocol unions - including the five CallerRole members and the
 * three observation sources. The freeze section 9 prohibitions are checked over
 * the FULL cross-product, plus a maximally permissive derived projection, so a
 * future edit that leaks a success treatment or a live control fails here.
 */

type Incident = PaymentIntentResponse['incident'];
type FundingEligibility = PaymentIntentResponse['fundingEligibility'];

/** Deliberately maximally permissive: every gate open, retry claimed eligible. */
function permissiveDerived(callerRole: CallerRole): DerivedPaymentActions {
  return {
    callerRole,
    cancelWindowOpen: true,
    releaseEligible: true,
    retry: { eligible: true, operationNonce: '1', kind: 'PROTECTED_RELEASE' },
  };
}

function restrictiveDerived(callerRole: CallerRole): DerivedPaymentActions {
  return {
    callerRole,
    cancelWindowOpen: false,
    releaseEligible: false,
    retry: { eligible: false, operationNonce: null, kind: null },
  };
}

/** The only observation shape that may enable a financial control. */
function freshObservation(source: ObservationSource = 'rpc') {
  return { assurance: 'verified_final' as Assurance, source, stale: false, rpcAvailable: true };
}

function observation(assurance: Assurance, source: ObservationSource = 'rpc') {
  return { assurance, source, stale: false, rpcAvailable: true };
}

function run(
  state: ChainState,
  role: CallerRole,
  assurance: Assurance,
  derived: DerivedPaymentActions = permissiveDerived(role),
  source: ObservationSource = 'rpc',
  fundingEligibility: FundingEligibility = 'ELIGIBLE',
  incident: Incident = null,
): StatusPresentation {
  const input: MapInput = {
    state,
    observation: observation(assurance, source),
    derived,
    fundingEligibility,
    incident,
  };
  return mapChainState(input);
}

const EVERY_COMBINATION: ReadonlyArray<[ChainState, CallerRole, Assurance]> = CHAIN_STATES.flatMap(
  (state) =>
    CALLER_ROLES.flatMap((role) =>
      ASSURANCES.map((assurance) => [state, role, assurance] as [ChainState, CallerRole, Assurance]),
    ),
);

describe('mapChainState exhaustiveness over shared enums', () => {
  it('covers every ChainState x CallerRole x Assurance without throwing', () => {
    expect(CHAIN_STATES).toHaveLength(11);
    expect(CALLER_ROLES).toHaveLength(5);
    expect(ASSURANCES).toHaveLength(5);
    expect(EVERY_COMBINATION).toHaveLength(11 * 5 * 5);
    for (const [state, role, assurance] of EVERY_COMBINATION) {
      expect(() => run(state, role, assurance)).not.toThrow();
    }
  });

  it('has a base mapping for every ChainState member', () => {
    for (const state of CHAIN_STATES) {
      const result = run(state, 'payer', 'verified_final');
      expect(result.state).toBe(state);
      expect(result.copyKey).toBe(state);
    }
  });
});

describe('verified-paid is unreachable except for FINAL_PAID + verified_final', () => {
  it('never sets verifiedRibbon for any state other than FINAL_PAID', () => {
    for (const [state, role, assurance] of EVERY_COMBINATION) {
      if (state === 'FINAL_PAID') continue;
      expect(run(state, role, assurance).verifiedRibbon, `${state}/${role}/${assurance}`).toBe(false);
    }
  });

  it('never uses the success tone for any state other than FINAL_PAID', () => {
    for (const [state, role, assurance] of EVERY_COMBINATION) {
      if (state === 'FINAL_PAID') continue;
      expect(run(state, role, assurance).tone, `${state}/${role}/${assurance}`).not.toBe('success');
    }
  });

  it('downgrades FINAL_PAID to caution unless assurance is verified_final', () => {
    for (const assurance of ASSURANCES) {
      for (const role of CALLER_ROLES) {
        const result = run('FINAL_PAID', role, assurance);
        if (assurance === 'verified_final') {
          expect(result.tone).toBe('success');
          expect(result.verifiedRibbon).toBe(true);
          expect(result.icon).toBe('check-shield');
          expect(result.money).toBe('to_recipient');
        } else {
          expect(result.tone, `FINAL_PAID/${assurance}`).not.toBe('success');
          expect(result.verifiedRibbon, `FINAL_PAID/${assurance}`).toBe(false);
          expect(result.icon, `FINAL_PAID/${assurance}`).not.toBe('check-shield');
          expect(result.money, `FINAL_PAID/${assurance}`).toBe('uncertain');
        }
      }
    }
  });

  it('never shows a verified ribbon for mock-sourced data, even when FINAL_PAID + verified_final', () => {
    for (const role of CALLER_ROLES) {
      const result = run('FINAL_PAID', role, 'verified_final', permissiveDerived(role), 'mock');
      expect(result.verifiedRibbon).toBe(false);
      expect(result.tone).not.toBe('success');
    }
  });

  it('never lets mock data claim funds reached the recipient, in any state', () => {
    for (const [state, role, assurance] of EVERY_COMBINATION) {
      const result = run(state, role, assurance, permissiveDerived(role), 'mock');
      expect(result.money, `${state}/${role}/${assurance}`).not.toBe('to_recipient');
      expect(result.verifiedRibbon, `${state}/${role}/${assurance}`).toBe(false);
    }
  });

  it('treats an index-sourced verified read as presentable', () => {
    // `index` is a legitimate source; only `mock` is barred from verification.
    const result = run('FINAL_PAID', 'payer', 'verified_final', permissiveDerived('payer'), 'index');
    expect(result.verifiedRibbon).toBe(true);
  });
});

describe('LOCKED is never paid', () => {
  it('is caution, escrowed, and carries no success signal for any role or assurance', () => {
    for (const role of CALLER_ROLES) {
      for (const assurance of ASSURANCES) {
        const result = run('LOCKED', role, assurance, restrictiveDerived(role));
        expect(result.verifiedRibbon).toBe(false);
        expect(result.tone).not.toBe('success');
        expect(result.money).not.toBe('to_recipient');
        if (assurance !== 'unknown' && assurance !== 'mismatch') {
          expect(result.money).toBe('escrowed');
        }
      }
    }
  });

  it('tells the recipient explicitly that it is not paid, in both locales', () => {
    expect(en.status.LOCKED.recipient).toContain('NOT PAID');
    expect(en.status.LOCKED.label.toLowerCase()).toContain('not paid');
    expect(tr.status.LOCKED.recipient).toContain('ÖDENMEDİ');
    expect(tr.status.LOCKED.payer).toContain('henüz ödenmedi');
  });

  it('gives payer_and_recipient the recipient reading, where the warning lives', () => {
    expect(run('LOCKED', 'payer_and_recipient', 'verified_final').audience).toBe('recipient');
  });
});

describe('in-flight states never look settled and never offer a new payment', () => {
  it('stays caution with in_flight or uncertain money', () => {
    for (const state of CHAIN_STATES.filter(isInFlight)) {
      for (const role of CALLER_ROLES) {
        for (const assurance of ASSURANCES) {
          const result = run(state, role, assurance);
          expect(result.verifiedRibbon).toBe(false);
          expect(result.tone).not.toBe('success');
          expect(['in_flight', 'uncertain']).toContain(result.money);
        }
      }
    }
  });

  it('offers only a chain-status check, never pay/cancel/release/retry', () => {
    for (const state of CHAIN_STATES.filter(isInFlight)) {
      for (const role of CALLER_ROLES) {
        const kinds = run(state, role, 'pending_finality').ctas.map((c) => c.kind);
        expect(kinds).toEqual(['check_chain_status']);
      }
    }
  });
});

describe('refunded is refunded, not paid', () => {
  it('reports money returned to the payer and no success treatment', () => {
    for (const role of CALLER_ROLES) {
      const result = run('CANCELLED_REFUNDED', role, 'verified_final');
      expect(result.verifiedRibbon).toBe(false);
      expect(result.tone).toBe('muted');
      expect(result.money).toBe('returned_to_payer');
    }
  });

  it('never uses paid wording for CANCELLED_REFUNDED in either locale', () => {
    expect(en.status.CANCELLED_REFUNDED.label.toLowerCase()).toBe('refunded');
    expect(en.status.CANCELLED_REFUNDED.payer.toLowerCase()).not.toMatch(/\bpaid\b/);
    expect(en.status.CANCELLED_REFUNDED.recipient.toLowerCase()).toContain('not paid');
    expect(tr.status.CANCELLED_REFUNDED.label).toBe('İade edildi');
    expect(tr.status.CANCELLED_REFUNDED.payer).toContain('iade edildi');
  });
});

describe('unknown, mismatched and stale observations are not trusted', () => {
  it('treats mismatch as blocked, danger, and strips every action', () => {
    for (const state of CHAIN_STATES) {
      for (const role of CALLER_ROLES) {
        const result = run(state, role, 'mismatch');
        expect(result.blocked).toBe(true);
        expect(result.tone).toBe('danger');
        expect(result.verifiedRibbon).toBe(false);
        expect(result.ctas).toEqual([]);
      }
    }
  });

  it('flags a freshness warning for every non-final assurance', () => {
    for (const assurance of ASSURANCES) {
      if (assurance === 'verified_final' || assurance === 'mismatch') continue;
      expect(run('OPEN', 'payer', assurance).needsFreshnessWarning, assurance).toBe(true);
    }
  });

  it('keeps a stale or offline final receipt verified while flagging freshness', () => {
    // Freeze section 3: a final receipt stays historically verified when live
    // RPC is unavailable; freshness is reported separately.
    for (const facts of [
      { assurance: 'verified_final' as Assurance, source: 'rpc' as ObservationSource, stale: true, rpcAvailable: true },
      { assurance: 'verified_final' as Assurance, source: 'rpc' as ObservationSource, stale: false, rpcAvailable: false },
    ]) {
      const result = mapChainState({
        state: 'FINAL_PAID',
        observation: facts,
        derived: permissiveDerived('payer'),
        fundingEligibility: 'NOT_OPEN',
        incident: null,
      });
      expect(result.needsFreshnessWarning).toBe(true);
      expect(result.verifiedRibbon).toBe(true);
      // ...but a receipt link is all it may offer.
      expect(result.ctas.map((c) => c.kind)).toEqual(['view_receipt']);
    }
  });

  it('withholds every financial action unless the observation is actionable', () => {
    // Mirrors PaymentIntentResponseSchema: "Uncertain/mock/stale observations
    // cannot enable financial actions."
    const unactionable: ReadonlyArray<{ assurance: Assurance; source: ObservationSource; stale: boolean; rpcAvailable: boolean }> = [
      { assurance: 'unverified', source: 'rpc', stale: false, rpcAvailable: true },
      { assurance: 'pending_finality', source: 'rpc', stale: false, rpcAvailable: true },
      { assurance: 'unknown', source: 'rpc', stale: false, rpcAvailable: true },
      { assurance: 'verified_final', source: 'rpc', stale: true, rpcAvailable: true },
      { assurance: 'verified_final', source: 'rpc', stale: false, rpcAvailable: false },
      { assurance: 'unverified', source: 'mock', stale: false, rpcAvailable: true },
    ];

    const financial = ['review_and_pay', 'cancel_protected', 'release_protected', 'retry_same_operation', 'cancel_unfunded', 'share_request'];

    for (const facts of unactionable) {
      for (const state of CHAIN_STATES) {
        for (const role of CALLER_ROLES) {
          const kinds = mapChainState({
            state,
            observation: facts,
            derived: permissiveDerived(role),
            fundingEligibility: 'ELIGIBLE',
            incident: null,
          }).ctas.map((c) => c.kind);
          for (const kind of kinds) {
            expect(
              financial.includes(kind),
              `${state}/${role}/${facts.assurance}/${facts.source} offered ${kind}`,
            ).toBe(false);
          }
        }
      }
    }
  });
});

describe('an open incident withholds every financial action', () => {
  const incidents: ReadonlyArray<NonNullable<Incident>> = [
    'CALLBACK_FAILED',
    'OUTCOME_UNKNOWN',
    'RECONCILIATION_REQUIRED',
  ];

  it('marks the presentation and refuses cancel/release/retry/pay', () => {
    for (const incident of incidents) {
      for (const state of CHAIN_STATES) {
        for (const role of CALLER_ROLES) {
          const result = mapChainState({
            state,
            observation: freshObservation(),
            derived: permissiveDerived(role),
            fundingEligibility: 'ELIGIBLE',
            incident,
          });
          expect(result.incidentOpen, `${incident}/${state}`).toBe(true);
          expect(result.needsFreshnessWarning).toBe(true);
          const kinds = result.ctas.map((c) => c.kind);
          expect(kinds).not.toContain('review_and_pay');
          expect(kinds).not.toContain('cancel_protected');
          expect(kinds).not.toContain('release_protected');
          expect(kinds).not.toContain('retry_same_operation');
        }
      }
    }
  });

  it('degrades the money position away from a settled claim', () => {
    const result = mapChainState({
      state: 'LOCKED',
      observation: freshObservation(),
      derived: restrictiveDerived('payer'),
      fundingEligibility: 'NOT_OPEN',
      incident: 'RECONCILIATION_REQUIRED',
    });
    expect(result.money).toBe('uncertain');
  });
});

describe('CTA authorization is deny-by-default', () => {
  it('offers cancel_protected only to the payer side and only while the window is open', () => {
    for (const role of CALLER_ROLES) {
      const kinds = run('LOCKED', role, 'verified_final', {
        ...restrictiveDerived(role),
        cancelWindowOpen: true,
      }).ctas.map((c) => c.kind);

      if (role === 'payer' || role === 'payer_and_recipient') {
        expect(kinds, role).toContain('cancel_protected');
      } else {
        expect(kinds, role).not.toContain('cancel_protected');
      }
    }
  });

  it('never offers cancel_protected when cancelWindowOpen is false or null', () => {
    for (const windowOpen of [false, null] as const) {
      const kinds = run('LOCKED', 'payer', 'verified_final', {
        ...restrictiveDerived('payer'),
        cancelWindowOpen: windowOpen,
      }).ctas.map((c) => c.kind);
      expect(kinds).not.toContain('cancel_protected');
    }
  });

  it('never offers release_protected unless releaseEligible is exactly true', () => {
    for (const eligible of [false, null] as const) {
      for (const role of CALLER_ROLES) {
        const kinds = run('LOCKED', role, 'verified_final', {
          ...restrictiveDerived(role),
          releaseEligible: eligible,
        }).ctas.map((c) => c.kind);
        expect(kinds).not.toContain('release_protected');
      }
    }
  });

  it('offers release_protected to any role once the chain says it is eligible', () => {
    // Freeze section 4: after the cutoff, release is permissionless.
    for (const role of CALLER_ROLES) {
      const kinds = run('LOCKED', role, 'verified_final', {
        ...restrictiveDerived(role),
        releaseEligible: true,
      }).ctas.map((c) => c.kind);
      expect(kinds, role).toContain('release_protected');
    }
  });

  it('never offers both cancel and release in the same presentation', () => {
    for (const role of CALLER_ROLES) {
      for (const cancelWindowOpen of [true, false, null] as const) {
        for (const releaseEligible of [true, false, null] as const) {
          const kinds = run('LOCKED', role, 'verified_final', {
            callerRole: role,
            cancelWindowOpen,
            releaseEligible,
            retry: { eligible: false, operationNonce: null, kind: null },
          }).ctas.map((c) => c.kind);
          const both = kinds.includes('cancel_protected') && kinds.includes('release_protected');
          // The contract branch is atomic and irreversible; the UI must not
          // present it as a simultaneous choice.
          expect(both, `${role} cancel=${cancelWindowOpen} release=${releaseEligible}`).toBe(false);
        }
      }
    }
  });

  it('fails closed on a contradictory projection claiming both branches', () => {
    for (const role of CALLER_ROLES) {
      const result = run('LOCKED', role, 'verified_final', {
        callerRole: role,
        cancelWindowOpen: true,
        releaseEligible: true,
        retry: { eligible: false, operationNonce: null, kind: null },
      });
      expect(result.projectionContradiction).toBe(true);
      expect(result.needsFreshnessWarning).toBe(true);
      expect(result.ctas.map((c) => c.kind)).toEqual(['check_chain_status']);
    }
  });

  it('reports no contradiction for a consistent projection', () => {
    for (const role of CALLER_ROLES) {
      expect(
        run('LOCKED', role, 'verified_final', {
          ...restrictiveDerived(role),
          cancelWindowOpen: true,
        }).projectionContradiction,
      ).toBe(false);

      expect(
        run('LOCKED', role, 'verified_final', {
          ...restrictiveDerived(role),
          releaseEligible: true,
        }).projectionContradiction,
      ).toBe(false);
    }
  });

  it('withholds retry unless retry.eligible and the role matches the operation kind', () => {
    for (const state of CHAIN_STATES.filter(isRecoverableFailure)) {
      const denied = run(state, 'payer', 'verified_final', restrictiveDerived('payer'));
      expect(denied.ctas.map((c) => c.kind)).not.toContain('retry_same_operation');

      // A release retry belongs to the recipient, so the payer must not see it.
      const wrongRole = run(state, 'payer', 'verified_final', {
        ...restrictiveDerived('payer'),
        retry: { eligible: true, operationNonce: '1', kind: 'PROTECTED_RELEASE' },
      });
      expect(wrongRole.ctas.map((c) => c.kind)).not.toContain('retry_same_operation');

      const rightRole = run(state, 'recipient', 'verified_final', {
        ...restrictiveDerived('recipient'),
        retry: { eligible: true, operationNonce: '1', kind: 'PROTECTED_RELEASE' },
      });
      expect(rightRole.ctas.map((c) => c.kind)).toContain('retry_same_operation');

      // A refund retry belongs to the payer.
      const refundByRecipient = run(state, 'recipient', 'verified_final', {
        ...restrictiveDerived('recipient'),
        retry: { eligible: true, operationNonce: '1', kind: 'PROTECTED_REFUND' },
      });
      expect(refundByRecipient.ctas.map((c) => c.kind)).not.toContain('retry_same_operation');

      const refundByPayer = run(state, 'payer', 'verified_final', {
        ...restrictiveDerived('payer'),
        retry: { eligible: true, operationNonce: '1', kind: 'PROTECTED_REFUND' },
      });
      expect(refundByPayer.ctas.map((c) => c.kind)).toContain('retry_same_operation');
    }
  });

  it('never offers retry when the operation kind is missing', () => {
    for (const state of CHAIN_STATES.filter(isRecoverableFailure)) {
      const kinds = run(state, 'payer_and_recipient', 'verified_final', {
        ...restrictiveDerived('payer_and_recipient'),
        retry: { eligible: true, operationNonce: '1', kind: null },
      }).ctas.map((c) => c.kind);
      expect(kinds).not.toContain('retry_same_operation');
    }
  });

  it('withholds the pay CTA unless funding is ELIGIBLE', () => {
    for (const eligibility of ['EXPIRED', 'NOT_OPEN', 'UNSUPPORTED', 'UNKNOWN'] as const) {
      for (const role of CALLER_ROLES) {
        const kinds = run(
          'OPEN',
          role,
          'verified_final',
          permissiveDerived(role),
          'rpc',
          eligibility,
        ).ctas.map((c) => c.kind);
        expect(kinds, `${role}/${eligibility}`).not.toContain('review_and_pay');
      }
    }
  });

  it('offers the pay CTA on a fundable OPEN request to a prospective payer', () => {
    for (const role of ['anonymous', 'observer', 'payer'] as const) {
      const kinds = run('OPEN', role, 'verified_final').ctas.map((c) => c.kind);
      expect(kinds, role).toContain('review_and_pay');
    }
  });

  it('never offers the pay CTA to the request owner', () => {
    for (const role of ['recipient', 'payer_and_recipient'] as const) {
      const kinds = run('OPEN', role, 'verified_final').ctas.map((c) => c.kind);
      expect(kinds, role).not.toContain('review_and_pay');
      expect(kinds, role).toContain('cancel_unfunded');
    }
  });

  it('never offers a payment-initiating CTA in any terminal state', () => {
    for (const state of ['FINAL_PAID', 'CANCELLED_REFUNDED', 'CANCELLED_UNFUNDED'] as const) {
      for (const role of CALLER_ROLES) {
        const kinds = run(state, role, 'verified_final').ctas.map((c) => c.kind);
        expect(kinds).not.toContain('review_and_pay');
        expect(kinds).not.toContain('cancel_protected');
        expect(kinds).not.toContain('release_protected');
        expect(kinds).not.toContain('retry_same_operation');
      }
    }
  });
});

describe('role-aware audience selection', () => {
  it('reads as recipient for recipient and payer_and_recipient only', () => {
    expect(run('LOCKED', 'recipient', 'verified_final').audience).toBe('recipient');
    expect(run('LOCKED', 'payer_and_recipient', 'verified_final').audience).toBe('recipient');
    for (const role of ['payer', 'observer', 'anonymous'] as const) {
      expect(run('LOCKED', role, 'verified_final').audience, role).toBe('payer');
    }
  });
});
