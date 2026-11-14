'use client';

import type { ReactNode } from 'react';
import { formatBaseUnits } from '@/lib/format/amount';
import { nsToDate } from '@/lib/format/time';
import { useLocale, useT } from '@/lib/i18n/provider';
import { NEAR_NATIVE } from '@/lib/protocol';

/**
 * Small building blocks shared by the request ticket, review, progress and
 * receipt. Presentation only: they never decide a payment state.
 */

/** Two-letter avatar from an account ID. Decorative; the full ID is always shown next to it. */
export function Monogram({ accountId, tone = 'dark', size = 44 }: { readonly accountId: string; readonly tone?: 'dark' | 'paper'; readonly size?: number }) {
  const name = accountId.split('.')[0] ?? accountId;
  const parts = name.split(/[-_]/).filter(Boolean);
  const letters = (parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2)).toUpperCase();
  const colors =
    tone === 'paper'
      ? 'bg-[var(--ink)] text-[var(--paper)]'
      : 'bg-[var(--surface-2)] text-[var(--text-primary)] ring-1 ring-[var(--border-strong)]';
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full font-semibold tracking-tight ${colors}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {letters}
    </span>
  );
}

/**
 * Hero money figure. Always the EXACT amount (no rounding): it is shown at
 * decision points. Long fractions wrap rather than shrink into illegibility.
 */
export function AmountHero({
  baseUnits,
  tone = 'dark',
  size = 'xl',
  className,
  asset = NEAR_NATIVE,
}: {
  readonly baseUnits: string;
  /** Token decimals + symbol; NEAR by default (Mainnet USDC requests pass USDC). */
  readonly asset?: { readonly decimals: number; readonly symbol: string };
  readonly tone?: 'dark' | 'paper';
  readonly size?: 'lg' | 'xl';
  readonly className?: string;
}) {
  const { locale } = useLocale();
  const t = useT();
  const formatted = formatBaseUnits(baseUnits, asset.decimals, { locale, maxFractionDigits: asset.decimals });
  const [whole, fraction] = formatted.exact.split(locale === 'tr' ? ',' : '.');
  const muted = tone === 'paper' ? 'text-[var(--ink-muted)]' : 'text-[var(--text-muted)]';
  const figure = size === 'xl' ? 'text-[3.25rem] min-[400px]:text-[3.75rem]' : 'text-[2.5rem]';
  return (
    <p className={`display-amount flex min-w-0 flex-wrap items-baseline gap-x-2 ${className ?? ''}`}>
      {/* Exact amounts can have 24 decimals: let long fractions wrap instead of overflowing. */}
      <span className={`${figure} min-w-0 [overflow-wrap:anywhere]`} aria-hidden="true">
        {whole}
        {fraction !== undefined && (
          <span className={muted}>
            {locale === 'tr' ? ',' : '.'}
            {fraction}
          </span>
        )}
      </span>
      <span className={`text-xl font-semibold tracking-tight ${muted}`} aria-hidden="true">
        {asset.symbol}
      </span>
      <span className="sr-only">
        {formatted.exact} {asset.symbol}. {t.common.exactBaseUnits}: {formatted.baseUnits}
      </span>
    </p>
  );
}

/** A label/value row tuned for cream paper. */
export function PaperRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--ink-line)] py-3 last:border-b-0">
      <dt className="shrink-0 whitespace-nowrap text-sm text-[var(--ink-muted)]">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

/** Ticket tear line: two notches and a dashed rule, like a torn-off stub. */
export function TicketTear() {
  return (
    <div aria-hidden="true" className="relative my-1 h-6">
      <span className="absolute -left-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-[var(--surface-0)]" />
      <span className="absolute -right-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-[var(--surface-0)]" />
      <span className="absolute inset-x-5 top-1/2 border-t-2 border-dashed border-[var(--ink-line)]" />
    </div>
  );
}

/**
 * Unmissable DEMO marker for synthetic content on cream paper. Rendered as a
 * diagonal stamp plus a readable line, so a screenshot can never be mistaken
 * for a real Testnet payment.
 */
export function DemoStamp() {
  const t = useT();
  return (
    <p className="mb-4 flex items-center justify-center gap-2 rounded-full bg-[rgb(201_115_107/0.14)] px-3 py-1.5 text-center text-xs font-semibold text-[#8a3c35]">
      <span
        aria-hidden="true"
        className="-rotate-6 rounded border-2 border-[#a5463e] px-1.5 text-[11px] font-bold tracking-[0.2em] text-[#a5463e]"
      >
        {t.experience.demo.badge}
      </span>
      {t.experience.demo.synthetic}
    </p>
  );
}

/** Short, human date-time for tickets (chain time in the viewer's zone, no seconds). */
export function useShortDateTime(): (ns: string) => string {
  const { locale } = useLocale();
  return (ns) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(nsToDate(ns));
}

/** Pill showing the only network Taply runs on. */
export function NetworkPill({ tone = 'dark' }: { readonly tone?: 'dark' | 'paper' }) {
  const t = useT();
  const colors =
    tone === 'paper'
      ? 'bg-[var(--ink)] text-[var(--paper)]'
      : 'border border-[var(--border-strong)] text-[var(--text-secondary)]';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${colors}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--taply-lime)]" />
      {t.app.networkBadge}
    </span>
  );
}
