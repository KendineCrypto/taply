'use client';

import { useT } from '@/lib/i18n/provider';
import type { ChainObservation } from '@/lib/protocol';

/**
 * Freshness and provenance, shown as three INDEPENDENT axes because the freeze
 * treats them independently (section 3): "A final receipt can remain
 * historically verified when live RPC becomes unavailable; report freshness
 * separately."
 *
 *   assurance     how strongly the chain state is established
 *   stale         the index is behind
 *   rpcAvailable  live reads are currently possible
 */
type Observation = Pick<ChainObservation<unknown>, 'assurance' | 'source' | 'stale' | 'rpcAvailable'>;

const ASSURANCE_TONE = {
  unverified: 'text-[var(--tone-muted-fg)]',
  pending_finality: 'text-[var(--tone-caution-fg)]',
  verified_final: 'text-[var(--tone-success-fg)]',
  unknown: 'text-[var(--tone-caution-fg)]',
  mismatch: 'text-[var(--tone-danger-fg)]',
} as const;

export function VerificationChip({ observation }: { readonly observation: Observation }) {
  const t = useT();
  const copy = t.assurance[observation.assurance];

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span className={ASSURANCE_TONE[observation.assurance]}>{copy.label}</span>

      {observation.source === 'mock' && <MockBadge />}

      {observation.stale && (
        <span className="rounded border border-[var(--tone-caution-border)] px-1 text-[var(--tone-caution-fg)]">
          stale
        </span>
      )}

      {!observation.rpcAvailable && (
        <span className="rounded border border-[var(--tone-caution-border)] px-1 text-[var(--tone-caution-fg)]">
          RPC offline
        </span>
      )}

      <span className="sr-only">{copy.description}</span>
    </span>
  );
}

/**
 * Loud, unmistakable MOCK marker. Mock data is additionally prevented from
 * rendering outside /demo by lib/mock/guard.ts.
 */
export function MockBadge() {
  const t = useT();
  return (
    <span
      className="rounded border border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)] px-1.5 py-0.5 text-[10px] font-bold tracking-widest text-[var(--tone-danger-fg)]"
      title={t.mock.demoOnly}
    >
      {t.mock.badge}
    </span>
  );
}

/**
 * Shown whenever `mapChainState` sets `needsFreshnessWarning`, so a weakly
 * observed state never looks settled just because the badge is small.
 */
export function FreshnessNotice({ observation }: { readonly observation: Observation }) {
  const t = useT();
  const copy = t.assurance[observation.assurance];

  return (
    <p className="text-xs text-[var(--tone-caution-fg)]" role="status">
      {copy.description}
    </p>
  );
}
