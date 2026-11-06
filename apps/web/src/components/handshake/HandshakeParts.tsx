'use client';

import type { ReactNode } from 'react';
import { AmountHero } from '@/components/experience/Basics';
import { AccountId } from '@/components/primitives/Amount';
import { Icon } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';
import type { IntentTerms } from '@/lib/protocol';

/**
 * Handshake building blocks. Presentation only: a matching code helps two
 * people compare terms; it is not identity, authorization or payment status.
 */

/** Six large characters. Spelled out for screen readers so similar glyphs are unambiguous. */
export function ComparisonCode({ code, tone = 'neutral' }: { readonly code: string | null; readonly tone?: 'neutral' | 'match' | 'mismatch' }) {
  const t = useT();
  const h = t.commerce.handshake;
  if (code === null) return <p className="text-sm text-[var(--text-muted)]">{h.codeUnavailable}</p>;
  const ring =
    tone === 'mismatch'
      ? 'border-[var(--tone-danger-border)] text-[var(--tone-danger-fg)]'
      : tone === 'match'
        ? 'border-[var(--tone-success-border)] text-[var(--text-primary)]'
        : 'border-[var(--border-strong)] text-[var(--text-primary)]';
  return (
    <div>
      <p className="eyebrow text-[var(--text-muted)]">{h.compareTitle}</p>
      <p className="mt-2 flex gap-1.5" aria-label={`${h.compareTitle}: ${code.split('').join(' ')}`} data-testid="comparison-code">
        {code.split('').map((ch, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={`grid h-12 w-9 place-items-center rounded-[10px] border bg-[var(--surface-2)] font-mono text-2xl font-semibold transition-colors duration-200 min-[400px]:w-10 ${ring}`}
          >
            {ch}
          </span>
        ))}
      </p>
      <p className="mt-2 text-xs text-[var(--text-muted)]">{h.compareHint}</p>
    </div>
  );
}

export function Presence({ connected, onLabel, offLabel }: { readonly connected: boolean; readonly onLabel: string; readonly offLabel: string }) {
  return (
    <p className="inline-flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${connected ? 'bg-[var(--taply-lime)]' : 'bg-[var(--text-muted)]'}`}
      />
      <span className={connected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}>{connected ? onLabel : offLabel}</span>
    </p>
  );
}

/** Immutable terms as both parties see them: exact amount and full receiving account. */
export function HandshakeTerms({ terms }: { readonly terms: IntentTerms }) {
  const t = useT();
  const h = t.commerce.handshake;
  return (
    <div className="flex flex-col gap-3">
      <AmountHero baseUnits={terms.amountBaseUnits} size="lg" />
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="text-[var(--text-muted)]">{t.commerce.sale.receivingLabel}</dt>
          <dd>
            <AccountId accountId={terms.creatorAccountId} className="break-all font-semibold" />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-[var(--text-muted)]">{t.common.network}</dt>
          <dd>
            {t.app.networkBadge} · {terms.mode === 'instant' ? t.mode.instant : t.mode.protected}
          </dd>
        </div>
      </dl>
      <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
        <Icon name="shield" size={14} />
        {h.termsImmutable}
      </p>
    </div>
  );
}

/** One device in the two-device preview. */
export function DeviceFrame({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className="flex min-w-0 flex-col gap-4 rounded-[var(--radius-hero)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 shadow-[var(--highlight-top)]"
    >
      <p className="flex items-center justify-between">
        <span className="eyebrow text-[var(--text-muted)]">{label}</span>
        <span aria-hidden="true" className="h-1 w-8 rounded-full bg-[var(--border-strong)]" />
      </p>
      {children}
    </section>
  );
}
