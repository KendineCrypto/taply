'use client';

import { useState } from 'react';
import { Amount, AccountId } from '@/components/primitives/Amount';
import { Card, DetailRow, ScreenHeader } from '@/components/primitives/Surface';
import { StatusBadge } from '@/components/status/StatusBadge';
import { MockBadge, VerificationChip } from '@/components/status/VerificationChip';
import { useT } from '@/lib/i18n/provider';
import { ASSURANCES, ROLES } from '@/lib/protocol';
import type { Assurance, Role } from '@/lib/protocol';
import { mapChainState } from '@/lib/payments/map-chain-state';
import {
  MOCK_AMOUNT_BASE_UNITS,
  MOCK_ACCOUNT_PAYER,
  MOCK_ACCOUNT_RECIPIENT,
  MOCK_ASSET,
  MOCK_STATE_MATRIX,
  mockDerived,
  mockDerivedReleaseEligible,
  mockObservation,
} from '@/lib/mock/fixtures';

/**
 * Status matrix — the only route where mock data may render.
 *
 * Its purpose is review: every ChainState, for every role, at every assurance
 * level, side by side. If a future change ever made LOCKED or an in-flight state
 * look settled, it would be visible here immediately — and the unit tests in
 * src/lib/payments/__tests__ would already have failed.
 */
export default function DemoPage() {
  const t = useT();
  const [role, setRole] = useState<Role>('payer');
  const [assurance, setAssurance] = useState<Assurance>('verified_final');

  return (
    <>
      <ScreenHeader
        title={t.screens.demo}
        description="Simulated states for visual review. Nothing here touches a chain."
        trailing={<MockBadge />}
      />

      <Card className="mb-4">
        <p className="text-sm text-[var(--tone-danger-fg)]">{t.mock.demoOnly}</p>
      </Card>

      <Card className="mb-4">
        <fieldset>
          <legend className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Viewer role</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {ROLES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRole(option)}
                aria-pressed={role === option}
                className={`tap-target rounded-[var(--radius-control)] border px-3 text-sm ${
                  role === option
                    ? 'border-[var(--taply-lime)] text-[var(--taply-lime)]'
                    : 'border-[var(--border-strong)] text-[var(--text-secondary)]'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-4">
          <legend className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Assurance</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {ASSURANCES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setAssurance(option)}
                aria-pressed={assurance === option}
                className={`tap-target rounded-[var(--radius-control)] border px-3 text-sm ${
                  assurance === option
                    ? 'border-[var(--taply-lime)] text-[var(--taply-lime)]'
                    : 'border-[var(--border-strong)] text-[var(--text-secondary)]'
                }`}
              >
                {t.assurance[option].label}
              </button>
            ))}
          </div>
        </fieldset>
      </Card>

      <Card className="mb-4">
        <dl>
          <DetailRow label={t.common.amount} emphasis>
            <Amount baseUnits={MOCK_AMOUNT_BASE_UNITS} asset={MOCK_ASSET} display="exact" />
          </DetailRow>
          <DetailRow label={t.common.payer}>
            <AccountId accountId={MOCK_ACCOUNT_PAYER} />
          </DetailRow>
          <DetailRow label={t.common.recipient}>
            <AccountId accountId={MOCK_ACCOUNT_RECIPIENT} />
          </DetailRow>
        </dl>
      </Card>

      <ul className="flex flex-col gap-3">
        {MOCK_STATE_MATRIX.map((state) => (
          <StateRow key={state} state={state} role={role} assurance={assurance} />
        ))}
        {/* LOCKED after the cutoff: release eligible, cancel closed. */}
        <StateRow
          key="LOCKED-after-cutoff"
          state="LOCKED"
          role={role}
          assurance={assurance}
          variantLabel="LOCKED (after cutoff)"
          releaseEligible
        />
      </ul>
    </>
  );
}

function StateRow({
  state,
  role,
  assurance,
  variantLabel,
  releaseEligible = false,
}: {
  readonly state: (typeof MOCK_STATE_MATRIX)[number];
  readonly role: Role;
  readonly assurance: Assurance;
  readonly variantLabel?: string;
  readonly releaseEligible?: boolean;
}) {
  const t = useT();
  const observation = mockObservation(assurance);
  const derived = releaseEligible ? mockDerivedReleaseEligible(role) : mockDerived(state, role);
  const presentation = mapChainState({ state, observation, role, derived });
  const copy = t.status[state];

  return (
    <Card as="li">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-[var(--text-muted)]">{variantLabel ?? state}</span>
        <StatusBadge state={state} observation={observation} role={role} derived={derived} />
      </div>

      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        {presentation.audience === 'recipient' ? copy.recipient : copy.payer}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <VerificationChip observation={observation} />
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          money: {presentation.money}
        </span>
        {presentation.projectionContradiction && (
          <span className="font-mono text-[10px] uppercase text-[var(--tone-danger-fg)]">
            projection contradiction
          </span>
        )}
      </div>

      {presentation.ctas.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {presentation.ctas.map((cta) => (
            <span
              key={cta.kind}
              className={`tap-target inline-flex items-center rounded-[var(--radius-control)] border px-3 text-sm ${
                cta.emphasis === 'primary'
                  ? 'border-[var(--taply-lime)] text-[var(--taply-lime)]'
                  : 'border-[var(--border-strong)] text-[var(--text-secondary)]'
              }`}
            >
              {cta.kind.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {/* Proof that the ribbon is unreachable from mock data. */}
      <p className="mt-2 font-mono text-[10px] text-[var(--text-muted)]">
        verifiedRibbon: {String(presentation.verifiedRibbon)} · tone: {presentation.tone}
      </p>
    </Card>
  );
}
