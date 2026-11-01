'use client';

import Link from 'next/link';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { AccountId } from '@/components/primitives/Amount';
import { Monogram } from '@/components/experience/Basics';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';

/**
 * Shared merchant building blocks. Presentation only: none of these decide a
 * payment state or create anything.
 */

/** The exact receiving account, never truncated: it is what customers pay. */
export function ReceivingAccountCard({ accountId, children }: { readonly accountId: string; readonly children?: ReactNode }) {
  const t = useT();
  const m = t.commerce.merchant;
  return (
    <section
      aria-label={m.receivingAccount}
      className="relative overflow-hidden rounded-[var(--radius-hero)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-5 shadow-[var(--highlight-top)]"
    >
      <div className="flex items-center gap-3">
        <Monogram accountId={accountId} size={48} />
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-[var(--text-muted)]">{m.receivingAccount}</p>
          <AccountId accountId={accountId} className="mt-1 block break-all text-[1.0625rem] font-semibold" />
        </div>
      </div>
      <p className="mt-4 flex items-start gap-2 text-sm leading-snug text-[var(--text-secondary)]">
        <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-[var(--taply-lime)]" />
        {m.receivingNote}
      </p>
      {children}
    </section>
  );
}

/** Small honest label: what a sale request is today. */
export function InstantOnlyBadge() {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)]">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--taply-lime)]" />
      {t.commerce.instantOnlyBadge}
    </span>
  );
}

type Href = ComponentProps<typeof Link>['href'];

/** A large navigational tile. `disabled` tiles are not links and say why. */
export function MerchantTile({
  href,
  icon,
  title,
  body,
  primary = false,
  disabledLabel,
  index,
}: {
  readonly href?: string;
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
  readonly primary?: boolean;
  /** When set the tile is inert and shows this label instead of a chevron. */
  readonly disabledLabel?: string;
  readonly index: number;
}) {
  const inner = (
    <>
      <span
        aria-hidden="true"
        className={`grid size-12 shrink-0 place-items-center rounded-2xl ${
          primary
            ? 'bg-[var(--taply-lime)] text-[var(--taply-night)] shadow-[0_10px_24px_-12px_rgb(199_252_117/0.7)]'
            : 'bg-[var(--surface-2)] text-[var(--text-primary)] ring-1 ring-[var(--border-subtle)]'
        } ${disabledLabel !== undefined ? 'opacity-60' : ''}`}
      >
        <Icon name={icon} size={22} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`font-semibold ${disabledLabel !== undefined ? 'text-[var(--text-secondary)]' : ''}`}>{title}</span>
        <span className="text-[0.8125rem] leading-snug text-[var(--text-secondary)]">{body}</span>
      </span>
      {disabledLabel !== undefined ? (
        <span className="shrink-0 rounded-full border border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--tone-caution-fg)]">
          {disabledLabel}
        </span>
      ) : (
        <Icon name="chevron" size={18} className="shrink-0 text-[var(--text-muted)]" />
      )}
    </>
  );
  const style = { '--i': index } as CSSProperties;
  const base = 'stagger-item flex min-h-[76px] items-center gap-4 rounded-[var(--radius-card)] border p-4';
  if (disabledLabel !== undefined || href === undefined) {
    return (
      <div style={style} aria-disabled="true" className={`${base} border-dashed border-[var(--border-subtle)] bg-[var(--tone-muted-bg)]`}>
        {inner}
      </div>
    );
  }
  return (
    <Link
      href={href as Href}
      style={style}
      className={`${base} pressable border-[var(--border-subtle)] bg-[var(--surface-1)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] ${
        primary ? 'border-[rgb(199_252_117/0.28)]' : ''
      }`}
    >
      {inner}
    </Link>
  );
}

/** Back link to the merchant hub. */
export function MerchantBack({ label }: { readonly label: string }) {
  return (
    <Link
      href="/merchant"
      className="tap-target -ml-1 mb-1 inline-flex items-center gap-1.5 px-1 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
    >
      <Icon name="arrow-left" size={16} />
      {label}
    </Link>
  );
}

/** Three-step progress for the sale flow. Purely informational. */
export function SaleSteps({ current }: { readonly current: 0 | 1 | 2 }) {
  const t = useT();
  const s = t.commerce.sale;
  const steps = [s.stepAmount, s.stepReview, s.stepQr];
  return (
    <ol aria-label={s.stepsLabel} className="mb-5 flex items-center gap-2">
      {steps.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2" aria-current={i === current ? 'step' : undefined}>
          <span
            className={`h-1 flex-1 rounded-full transition-colors duration-200 ${i <= current ? 'bg-[var(--taply-lime)]' : 'bg-[var(--border-subtle)]'}`}
            aria-hidden="true"
          />
          <span className={`text-xs font-medium ${i === current ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>{label}</span>
        </li>
      ))}
    </ol>
  );
}
