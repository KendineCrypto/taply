'use client';

import { useT } from '@/lib/i18n/provider';
import { mapChainState } from '@/lib/payments/map-chain-state';
import type { MapInput, StatusPresentation, StatusTone } from '@/lib/payments/map-chain-state';

/**
 * The only component that renders a payment status.
 *
 * It takes a ChainState plus an observation and a role - never a boolean. There
 * is deliberately no `paid`, `verified` or `settled` prop, and no way to
 * override the tone from a call site (freeze section 9).
 */

const TONE_STYLE: Readonly<Record<StatusTone, string>> = {
  neutral: 'bg-[var(--tone-neutral-bg)] text-[var(--tone-neutral-fg)] border-[var(--border-subtle)]',
  caution: 'bg-[var(--tone-caution-bg)] text-[var(--tone-caution-fg)] border-[var(--tone-caution-border)]',
  success: 'bg-[var(--tone-success-bg)] text-[var(--tone-success-fg)] border-[var(--tone-success-border)]',
  danger: 'bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)] border-[var(--tone-danger-border)]',
  muted: 'bg-[var(--tone-muted-bg)] text-[var(--tone-muted-fg)] border-[var(--border-subtle)]',
};

/**
 * Status is never colour-only (UX_FLOWS.md accessibility): every tone also
 * carries a distinct glyph, and the label text states the state in words.
 */
const ICON_GLYPH: Readonly<Record<StatusPresentation['icon'], string>> = {
  clock: '◷',
  lock: '🔒',
  spinner: '◌',
  'check-shield': '✓',
  // Contract reports paid, settlement proof pending: a plain check, no shield.
  check: '✔',
  undo: '↩',
  alert: '!',
  x: '×',
};

export function StatusBadge(props: MapInput) {
  const t = useT();
  const presentation = mapChainState(props);
  const copy = presentation.contractReportsPaid ? t.payment.contractPaid : t.status[presentation.copyKey];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${TONE_STYLE[presentation.tone]}`}
    >
      <span aria-hidden="true">{ICON_GLYPH[presentation.icon]}</span>
      <span>{copy.label}</span>
      {/* The full money position goes to assistive tech, not just the label. */}
      <span className="sr-only">{copy.announce}</span>
    </span>
  );
}

/**
 * The verified-paid treatment. Rendering this is gated on
 * `presentation.verifiedRibbon`, which is true only for FINAL_PAID +
 * verified_final from a non-mock source.
 *
 * Distinctness from a lime CTA (freeze section 9) comes from layout + the check
 * glyph + the word "verified" + the settlement evidence, not from colour.
 */
export function VerifiedPaidRibbon({
  presentation,
  settlementTxHash,
}: {
  readonly presentation: StatusPresentation;
  readonly settlementTxHash?: string | undefined;
}) {
  const t = useT();
  if (!presentation.verifiedRibbon) return null;

  return (
    <div
      className="flex w-full flex-col gap-1 rounded-[var(--radius-card)] border border-[var(--tone-success-border)] bg-[var(--tone-success-bg)] p-4"
      role="status"
    >
      <div className="flex items-center gap-2 text-[var(--tone-success-fg)]">
        <span aria-hidden="true" className="text-lg">
          ✓
        </span>
        <span className="font-semibold">{t.status.FINAL_PAID.label}</span>
        <span className="text-xs uppercase tracking-wide opacity-80">{t.assurance.verified_final.label}</span>
      </div>
      <p className="text-sm text-[var(--text-secondary)]">
        {presentation.audience === 'recipient' ? t.status.FINAL_PAID.recipient : t.status.FINAL_PAID.payer}
      </p>
      {settlementTxHash !== undefined && (
        <p className="chain-id text-[var(--text-muted)]">{settlementTxHash}</p>
      )}
    </div>
  );
}
