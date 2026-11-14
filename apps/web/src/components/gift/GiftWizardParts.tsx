'use client';

import type { ReactNode } from 'react';
import { Button, Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { fill } from '@/lib/i18n/fill';
import { useT } from '@/lib/i18n/provider';

/**
 * Presentational pieces of the gift wizard (step header, type cards, step navigation,
 * review rows), shared by the Testnet and NEAR Mainnet builds. No wallet or chain code.
 */
export function GiftSteps({ step, labels }: { readonly step: number; readonly labels: readonly string[] }) {
  const t = useT();
  const g = t.gift;
  return (
    <div className="flex flex-col gap-2" aria-label={fill(g.stepOf, { n: String(step), total: String(labels.length) })}>
      <div className="gift-steps" aria-hidden="true">
        {labels.map((label, i) => (
          <span key={label} data-done={i < step ? 'true' : 'false'} />
        ))}
      </div>
      <p className="flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span>{fill(g.stepOf, { n: String(step), total: String(labels.length) })} · {labels[step - 1]}</span>
      </p>
    </div>
  );
}

export function GiftRow({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] py-2.5 last:border-0">
      <dt className="shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 text-right">{value}</dd>
    </div>
  );
}

export function StepNav({ onBack, onNext, busy = false, disabled = false }: { readonly onBack: () => void; readonly onNext: () => void; readonly busy?: boolean; readonly disabled?: boolean }) {
  const t = useT();
  return (
    <div className="flex gap-2">
      <Button variant="secondary" onClick={onBack} disabled={busy}>
        <Icon name="arrow-left" size={16} /> {t.gift.back}
      </Button>
      <Button block size="lg" onClick={onNext} disabled={busy || disabled}>
        {busy ? <Spinner /> : null} {t.gift.next} {!busy && <Icon name="arrow-right" size={18} />}
      </Button>
    </div>
  );
}

export function TypeCard({ icon, title, body, badge, disabled, note, primary = false, onSelect }: {
  readonly icon: 'send' | 'gift'; readonly title: string; readonly body: string; readonly badge: string; readonly disabled: boolean;
  readonly note: string | null; readonly primary?: boolean; readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`pressable surface-card flex w-full items-start gap-4 p-5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        primary && !disabled ? 'border-[var(--tone-success-border)]' : ''
      } hover:border-[var(--border-strong)]`}
    >
      <span className={`grid size-12 shrink-0 place-items-center rounded-2xl ${primary ? 'bg-[var(--taply-lime)] text-[var(--taply-night)]' : 'bg-[var(--surface-2)]'}`}>
        <Icon name={icon} size={24} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold">{title}</span>
          <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">{badge}</span>
        </span>
        <span className="mt-1 block text-sm leading-relaxed text-[var(--text-secondary)]">{body}</span>
        {note !== null && <span className="mt-2 block text-xs text-[var(--tone-caution-fg)]">{note}</span>}
      </span>
      {!disabled && <Icon name="chevron" size={18} className="mt-1 shrink-0 text-[var(--text-muted)]" />}
    </button>
  );
}
