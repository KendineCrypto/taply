import type { ReactNode } from 'react';
import { Icon } from '@/components/shell/Icons';
import type { ErrorCopy } from '@/lib/i18n';

const TONES = {
  caution: 'border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] text-[var(--tone-caution-fg)]',
  danger: 'border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]',
  neutral: 'border-[var(--border-subtle)] bg-[var(--tone-neutral-bg)] text-[var(--text-primary)]',
} as const;

/**
 * Compact title + body notice for client-side states (wallet, balance,
 * connectivity). Text always carries the meaning; the icon and tone are
 * supplementary, so status is never colour-only.
 */
export function InlineNotice({
  copy,
  tone = 'caution',
  action,
  live = 'polite',
}: {
  readonly copy: ErrorCopy;
  readonly tone?: keyof typeof TONES;
  readonly action?: ReactNode;
  /** `assertive` only for something that interrupts what the person is doing. */
  readonly live?: 'polite' | 'assertive';
}) {
  return (
    <div
      className={`flex gap-3 rounded-[var(--radius-control)] border p-3 ${TONES[tone]}`}
      role={live === 'assertive' ? 'alert' : 'status'}
    >
      <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{copy.title}</p>
        <p className="mt-0.5 text-sm leading-snug text-[var(--text-secondary)]">{copy.body}</p>
        {action !== undefined && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
