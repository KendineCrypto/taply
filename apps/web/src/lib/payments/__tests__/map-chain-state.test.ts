import { describe, expect, it } from 'vitest';
import { ASSURANCES, CHAIN_STATES, ROLES } from '@/lib/protocol';
import type { Assurance, ChainState, DerivedProjection, Role } from '@/lib/protocol';
import { en } from '@/lib/i18n/dictionaries/en';
import { tr } from '@/lib/i18n/dictionaries/tr';
import { isInFlight, isRecoverableFailure, mapChainState } from '../map-chain-state';
import type { StatusPresentation } from '../map-chain-state';

/**
 * Safety tests for the only module permitted to decide payment presentation.
 *
 * These assert the freeze section 9 prohibitions across the FULL cross-product
 * of ChainState x Role x Assurance, plus the permissive-derived worst case
 * (every flag true), so a future edit that leaks a success treatment fails here.
 */

type Permissive = DerivedProjection;

/** Deliberately maximally permissive: every gate open, every retry allowed. */
function permissiveDerived(role: Role): Permissive {
  return {
    expired: false,
    cancelWindowOpen: true,
    releaseEligible: true,
    retry: { allowed: true, authorizedRoles: [...ROLES] },
    callerRole: role,
  };
}

function restrictiveDerived(role: Role): Permissive {
  return {
    expired: false,
    cancelWindowOpen: false,
    releaseEligible: false,
    retry: { allowed: false, authorizedRoles: [] },
    callerRole: role,
  };
}

function observation(assurance: Assurance, source: 'chain' | 'index' | 'mock' = 'chain') {
  return { assurance, source, stale: false, rpcAvailable: true } as const;
}

function run(
  state: ChainState,
  role: Role,
  assurance: Assurance,
  derived: Permissive = permissiveDerived(role),
  source: 'chain' | 'index' | 'mock' = 'chain',
): StatusPresentation {
  return mapChainState({ state, observation: observation(assurance, source), role, derived });
}

const EVERY_COMBINATION: ReadonlyArray<[ChainState, Role, Assurance]> = CHAIN_STATES.flatMap((state) =>
  ROLES.flatMap((role) => ASSURANCES.map((assurance) => [state, role, assurance] as [ChainState, Role, Assurance])),
);

describe('mapChainState exhaustiveness', () => {
  it('covers every ChainState x Role x Assurance without throwing', () => {
    expect(EVERY_COMBINATION).toHaveLength(CHAIN_STATES.length * ROLES.length * ASSURANCES.length);
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
      for (const role of ROLES) {
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
    for (const role of ROLES) {
      const result = run('FINAL_PAID', role, 'verified_final', permissiveDerived(role), 'mock');
      expect(result.verifiedRibbon).toBe(false);
      expect(result.tone).not.toBe('success');
    }
  });
});

describe('LOCKED is never paid', () => {
  it('is caution, escrowed, and carries no success signal for any role or assurance', () => {
    for (const role of ROLES) {
      for (const assurance of ASSURANCES) {
        const result = run('LOCKED', role, assurance);
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
});

describe('in-flight states never look settled and never offer a new payment', () => {
  it('stays caution with in_flight or uncertain money', () => {
    for (const state of CHAIN_STATES.filter(isInFlight)) {
      for (const role of ROLES) {
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
      for (const role of ROLES) {
        const kinds = run(state, role, 'pending_finality').ctas.map((c) => c.kind);
        expect(kinds).toEqual(['check_chain_status']);
      }
    }
  });
});

describe('refunded is refunded, not paid', () => {
  it('reports money returned to the payer and no success treatment', () => {
    for (const role of ROLES) {
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

describe('unknown and mismatched observations are not trusted', () => {
  it('treats mismatch as blocked, danger, and strips every action', () => {
    for (const state of CHAIN_STATES) {
      for (const role of ROLES) {
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
      const result = run('OPEN', 'payer', assurance);
      if (assurance === 'verified_final' || assurance === 'mismatch') continue;
      expect(result.needsFreshnessWarning, assurance).toBe(true);
    }
  });

  it('flags a freshness warning when stale or RPC is unavailable', () => {
    const stale = mapChainState({
      state: 'FINAL_PAID',
      observation: { assurance: 'verified_final', source: 'chain', stale: true, rpcAvailable: true },
      role: 'payer',
      derived: permissiveDerived('payer'),
    });
    expect(stale.needsFreshnessWarning).toBe(true);
    // Freeze section 3: a final receipt stays historically verified when live
    // RPC is unavailable; freshness is reported separately.
    expect(stale.verifiedRibbon).toBe(true);

    const offline = mapChainState({
      state: 'FINAL_PAID',
      observation: { assurance: 'verified_final', source: 'chain', stale: false, rpcAvailable: false },
      role: 'payer',
      derived: permissiveDerived('payer'),
    });
    expect(offline.needsFreshnessWarning).toBe(true);
    expect(offline.verifiedRibbon).toBe(true);
  });
});

describe('CTA authorization is deny-by-default', () => {
  it('offers cancel_protected only to the payer and only while the window is open', () => {
    for (const role of ROLES) {
      const open = run('LOCKED', role, 'verified_final', {
        ...restrictiveDerived(role),
        cancelWindowOpen: true,
      });
      const kinds = open.ctas.map((c) => c.kind);
      if (role === 'payer') expect(kinds).toContain('cancel_protected');
      else expect(kinds).not.toContain('cancel_protected');
    }
  });

  it('never offers cancel_protected when cancelWindowOpen is false or null', () => {
    for (const windowOpen of [false, null] as const) {
      const result = run('LOCKED', 'payer', 'verified_final', {
        ...restrictiveDerived('payer'),
        cancelWindowOpen: windowOpen,
      });
      expect(result.ctas.map((c) => c.kind)).not.toContain('cancel_protected');
    }
  });

  it('never offers release_protected unless releaseEligible is exactly true', () => {
    for (const eligible of [false, null] as const) {
      for (const role of ROLES) {
        const result = run('LOCKED', role, 'verified_final', {
          ...restrictiveDerived(role),
          releaseEligible: eligible,
        });
        expect(result.ctas.map((c) => c.kind)).not.toContain('release_protected');
      }
    }
  });

  it('offers release_protected to any role once the chain says it is eligible', () => {
    for (const role of ROLES) {
      const result = run('LOCKED', role, 'verified_final', {
        ...restrictiveDerived(role),
        releaseEligible: true,
      });
      expect(result.ctas.map((c) => c.kind)).toContain('release_protected');
    }
  });

  it('never offers both cancel and release in the same presentation', () => {
    for (const role of ROLES) {
      for (const cancelWindowOpen of [true, false, null] as const) {
        for (const releaseEligible of [true, false, null] as const) {
          const kinds = run('LOCKED', role, 'verified_final', {
            expired: false,
            cancelWindowOpen,
            releaseEligible,
            retry: null,
            callerRole: role,
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
    for (const role of ROLES) {
      const result = run('LOCKED', role, 'verified_final', {
        expired: false,
        cancelWindowOpen: true,
        releaseEligible: true,
        retry: null,
        callerRole: role,
      });
      expect(result.projectionContradiction).toBe(true);
      expect(result.needsFreshnessWarning).toBe(true);
      expect(result.ctas.map((c) => c.kind)).toEqual(['check_chain_status']);
    }
  });

  it('reports no contradiction for a consistent projection', () => {
    for (const role of ROLES) {
      const cancelOnly = run('LOCKED', role, 'verified_final', {
        ...restrictiveDerived(role),
        cancelWindowOpen: true,
      });
      expect(cancelOnly.projectionContradiction).toBe(false);

      const releaseOnly = run('LOCKED', role, 'verified_final', {
        ...restrictiveDerived(role),
        releaseEligible: true,
      });
      expect(releaseOnly.projectionContradiction).toBe(false);
    }
  });

  it('withholds retry unless retry.allowed and the role is authorized', () => {
    for (const state of CHAIN_STATES.filter(isRecoverableFailure)) {
      const denied = run(state, 'payer', 'verified_final', restrictiveDerived('payer'));
      expect(denied.ctas.map((c) => c.kind)).not.toContain('retry_same_branch');

      const wrongRole = run(state, 'payer', 'verified_final', {
        ...restrictiveDerived('payer'),
        retry: { allowed: true, authorizedRoles: ['recipient'] },
      });
      expect(wrongRole.ctas.map((c) => c.kind)).not.toContain('retry_same_branch');

      const allowed = run(state, 'recipient', 'verified_final', {
        ...restrictiveDerived('recipient'),
        retry: { allowed: true, authorizedRoles: ['recipient'] },
      });
      expect(allowed.ctas.map((c) => c.kind)).toContain('retry_same_branch');
    }
  });

  it('withholds the pay CTA on an expired request for every role', () => {
    for (const role of ROLES) {
      const result = run('OPEN', role, 'verified_final', {
        ...permissiveDerived(role),
        expired: true,
      });
      expect(result.ctas.map((c) => c.kind)).not.toContain('review_and_pay');
    }
  });

  it('offers the pay CTA on an unexpired OPEN request to the payer', () => {
    const result = run('OPEN', 'payer', 'verified_final');
    expect(result.ctas.map((c) => c.kind)).toContain('review_and_pay');
  });

  it('never offers a payment-initiating CTA in any terminal state', () => {
    for (const state of ['FINAL_PAID', 'CANCELLED_REFUNDED', 'CANCELLED_UNFUNDED'] as const) {
      for (const role of ROLES) {
        const kinds = run(state, role, 'verified_final').ctas.map((c) => c.kind);
        expect(kinds).not.toContain('review_and_pay');
        expect(kinds).not.toContain('cancel_protected');
        expect(kinds).not.toContain('release_protected');
        expect(kinds).not.toContain('retry_same_branch');
      }
    }
  });
});

describe('role-aware audience selection', () => {
  it('reads as recipient only for the recipient role', () => {
    expect(run('LOCKED', 'recipient', 'verified_final').audience).toBe('recipient');
    for (const role of ['payer', 'creator', 'observer'] as const) {
      expect(run('LOCKED', role, 'verified_final').audience).toBe('payer');
    }
  });
});
