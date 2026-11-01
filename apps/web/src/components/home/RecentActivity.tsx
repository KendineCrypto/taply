'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { Amount } from '@/components/primitives/Amount';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { useLocale, useT } from '@/lib/i18n/provider';
import { CHAIN_CONFIG, explorerAccountUrl } from '@/lib/near/config';
import { usePayments } from '@/lib/payments/context';
import type { JournalEntry } from '@/lib/payments/journal';
import { NEAR_NATIVE } from '@/lib/protocol';
import { useAccountId } from '@/lib/wallet/provider';

/**
 * Activity from real data only: this browser's submission journal (requests
 * created and payments approved here). Each row says what this device did and
 * the journal phase; the linked status page shows what the chain says. A full
 * history lives on the explorer. Nothing is invented.
 *
 * `preview` (home) shows the three latest rows and an "All activity" link;
 * the Activity tab shows every row for the connected account.
 */

const METHOD_ICON: Readonly<Record<JournalEntry['method'], IconName>> = {
  create_request: 'request',
  pay_instant_native: 'send',
  retry_native_transfer: 'refresh',
  cancel_unfunded: 'x',
};

const PHASE_TONE: Readonly<Record<JournalEntry['phase'], string>> = {
  AWAITING_SIGNATURE: 'text-[var(--tone-caution-fg)] bg-[var(--tone-caution-bg)]',
  OUTCOME_UNKNOWN: 'text-[var(--tone-caution-fg)] bg-[var(--tone-caution-bg)]',
  SUBMITTED: 'text-[var(--tone-caution-fg)] bg-[var(--tone-caution-bg)]',
  USER_REJECTED: 'text-[var(--text-muted)] bg-[var(--tone-muted-bg)]',
  RESOLVED: 'text-[var(--text-secondary)] bg-[var(--tone-neutral-bg)]',
};

export function RecentActivity({ preview = true }: { readonly preview?: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const accountId = useAccountId();
  const { journal, journalVersion } = usePayments();

  const entries = useMemo(() => {
    void journalVersion;
    if (accountId === null || journal === null || !journal.isReadable()) return [];
    const mine = journal
      .entries()
      .filter((e) => e.signerAccountId === accountId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return preview ? mine.slice(0, 3) : mine;
  }, [accountId, journal, journalVersion, preview]);

  const time = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  const explorer =
    accountId !== null && CHAIN_CONFIG.ok ? explorerAccountUrl(CHAIN_CONFIG.explorerBaseUrl, accountId) : null;

  return (
    <section aria-labelledby="activity-title">
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <h2 id="activity-title" className={preview ? 'text-base font-semibold tracking-tight' : 'sr-only'}>
          {t.walletUx.home.activityTitle}
        </h2>
        {preview && entries.length > 0 && (
          <Link href="/activity" className="text-sm font-medium text-[var(--taply-lime)] hover:underline">
            {t.oneTap.home.allActivity}
          </Link>
        )}
      </div>

      {entries.length > 0 ? (
        <ul className="flex flex-col">
          {entries.map((entry, i) => (
            <li
              key={`${entry.requestId}:${entry.method}`}
              className="stagger-item"
              style={{ '--i': i } as CSSProperties}
            >
              <Link
                href={`/pay/${entry.requestId}`}
                className="pressable -mx-1 flex min-h-[64px] items-center gap-3 rounded-[var(--radius-control)] px-2 py-2.5 hover:bg-[var(--tone-neutral-bg)]"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-[var(--text-primary)]">
                  <Icon name={METHOD_ICON[entry.method]} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem] font-semibold">{t.walletUx.activity.method[entry.method]}</span>
                  <span className="block text-xs text-[var(--text-muted)]">{time(entry.updatedAt)}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {entry.terms !== null && (
                    <Amount baseUnits={entry.terms.amountBaseUnits} asset={NEAR_NATIVE} display="compact" className="text-sm font-semibold" />
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PHASE_TONE[entry.phase]}`}>
                    {t.walletUx.activity.phase[entry.phase]}
                  </span>
                </span>
                <span className="sr-only">{t.walletUx.activity.open}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border-subtle)] px-5 py-7 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-[var(--tone-neutral-bg)] text-[var(--text-secondary)]">
            <Icon name="activity" />
          </span>
          <p className="mt-3 font-semibold">{t.home.activityEmptyTitle}</p>
          <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-[var(--text-secondary)]">
            {accountId === null ? t.home.activityConnectBody : t.walletUx.home.activityEmptyBody}
          </p>
        </div>
      )}

      {!preview && (
        <p className="mt-4 px-1 text-xs leading-relaxed text-[var(--text-muted)]">
          {t.oneTap.activity.scope}
          {explorer !== null && (
            <>
              {' '}
              <a
                href={explorer}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
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
