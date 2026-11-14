'use client';

import Link from 'next/link';
import type { Route } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';

/**
 * Activity rows (home preview and Activity tab), presentational only. The Testnet
 * build feeds its submission journal, the NEAR Mainnet build its contract-state reads
 * of saved requests. Each row opens a status page that reads the chain.
 */
export type ActivityTone = 'caution' | 'muted' | 'neutral' | 'success';

export interface ActivityRowData {
  readonly key: string;
  readonly href: string;
  readonly icon: IconName;
  readonly title: string;
  readonly time: string;
  readonly amount: ReactNode;
  readonly phase: string;
  readonly tone: ActivityTone;
}

const TONE: Readonly<Record<ActivityTone, string>> = {
  caution: 'text-[var(--tone-caution-fg)] bg-[var(--tone-caution-bg)]',
  muted: 'text-[var(--text-muted)] bg-[var(--tone-muted-bg)]',
  neutral: 'text-[var(--text-secondary)] bg-[var(--tone-neutral-bg)]',
  success: 'text-[var(--taply-lime)] bg-[var(--tone-success-bg)]',
};

export function RecentActivityView({
  preview,
  rows,
  allHref,
  emptyBody,
  explorerHref,
  filters,
}: {
  readonly preview: boolean;
  readonly rows: ReadonlyArray<ActivityRowData>;
  readonly allHref: string;
  readonly emptyBody: string;
  readonly explorerHref?: string | null;
  /** Optional row filter (NEAR Mainnet: received / paid / open). */
  readonly filters?: ReactNode;
}) {
  const t = useT();
  return (
    <section aria-labelledby="activity-title">
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <h2 id="activity-title" className={preview ? 'text-base font-semibold tracking-tight' : 'sr-only'}>
          {t.walletUx.home.activityTitle}
        </h2>
        {preview && rows.length > 0 && (
          <Link href={allHref as Route} className="inline-flex min-h-[44px] items-center text-sm font-medium text-[var(--taply-lime)] hover:underline">
            {t.oneTap.home.allActivity}
          </Link>
        )}
      </div>
      {filters}

      {rows.length > 0 ? (
        <ul className="flex flex-col" data-testid="activity-list">
          {rows.map((row, i) => (
            <li key={row.key} className="stagger-item" style={{ '--i': i } as CSSProperties}>
              <Link
                href={row.href as Route}
                data-testid="activity-row"
                className="pressable -mx-1 flex min-h-[64px] items-center gap-3 rounded-[var(--radius-control)] px-2 py-2.5 hover:bg-[var(--tone-neutral-bg)]"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-[var(--text-primary)]">
                  <Icon name={row.icon} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem] font-semibold">{row.title}</span>
                  <span className="block text-xs text-[var(--text-muted)]">{row.time}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {row.amount}
                  <span data-testid="activity-state" className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[row.tone]}`}>
                    {row.phase}
                  </span>
                </span>
                <span className="sr-only">{t.walletUx.activity.open}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border-subtle)] px-5 py-7 text-center" data-testid="activity-empty">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-[var(--tone-neutral-bg)] text-[var(--text-secondary)]">
            <Icon name="activity" />
          </span>
          <p className="mt-3 font-semibold">{t.home.activityEmptyTitle}</p>
          <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-[var(--text-secondary)]">{emptyBody}</p>
        </div>
      )}

      {!preview && (
        <p className="mt-4 px-1 text-xs leading-relaxed text-[var(--text-muted)]">
          {t.oneTap.activity.scope}
          {explorerHref !== undefined && explorerHref !== null && (
            <>
              {' '}
              <a
                href={explorerHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-1 font-medium text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
              >
                {t.walletUx.home.explorer}
                <Icon name="external" size={12} />
              </a>
            </>
          )}
        </p>
      )}
    </section>
  );
}
