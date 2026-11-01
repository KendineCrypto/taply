'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Amount } from '@/components/primitives/Amount';
import { ButtonLink } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { useLocale, useT } from '@/lib/i18n/provider';
import { CHAIN_CONFIG, explorerAccountUrl } from '@/lib/near/config';
import { usePayments } from '@/lib/payments/context';
import type { JournalEntry } from '@/lib/payments/journal';
import { NEAR_NATIVE } from '@/lib/protocol';
import { useAccountId } from '@/lib/wallet/provider';

/**
 * Recent activity from real data only: this browser's submission journal
 * (requests created and payments approved here). Each row says what this
 * device did and the journal phase; the linked status page shows what the
 * chain says. A full history lives on the explorer. Nothing is invented.
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

export function RecentActivity() {
  const t = useT();
  const { locale } = useLocale();
  const accountId = useAccountId();
  const { journal, journalVersion } = usePayments();

  const entries = useMemo(() => {
    void journalVersion;
    if (accountId === null || journal === null || !journal.isReadable()) return [];
    return journal
      .entries()
      .filter((e) => e.signerAccountId === accountId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 6);
  }, [accountId, journal, journalVersion]);

  const time = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  return (
    <section aria-labelledby="activity-title">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="activity-title" className="text-base font-semibold tracking-tight">
          {t.walletUx.home.activityTitle}
        </h2>
        {accountId !== null && CHAIN_CONFIG.ok && (
          <a
            href={explorerAccountUrl(CHAIN_CONFIG.explorerBaseUrl, accountId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {t.walletUx.home.explorer}
            <Icon name="external" size={13} />
          </a>
        )}
      </div>

      {entries.length > 0 ? (
        <>
          <ul className="surface-card divide-y divide-[var(--border-subtle)] overflow-hidden">
            {entries.map((entry) => (
              <li key={`${entry.requestId}:${entry.method}`}>
                <Link
                  href={`/pay/${entry.requestId}`}
                  className="flex min-h-[64px] items-center gap-3 px-4 py-3 hover:bg-[rgb(244_243_232/0.03)]"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-[var(--text-primary)] ring-1 ring-[var(--border-subtle)]">
                    <Icon name={METHOD_ICON[entry.method]} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{t.walletUx.activity.method[entry.method]}</span>
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
          <p className="mt-2 px-1 text-xs text-[var(--text-muted)]">{t.walletUx.home.activityScope}</p>
        </>
      ) : (
        <div className="surface-card px-5 py-7 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--tone-neutral-bg)] text-[var(--text-secondary)]">
            <Icon name="activity" />
          </span>
          <p className="mt-3 font-semibold">{t.home.activityEmptyTitle}</p>
          <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-[var(--text-secondary)]">
            {accountId === null ? t.home.activityConnectBody : t.walletUx.home.activityEmptyBody}
          </p>
          {accountId !== null && (
            <div className="mt-4">
              <ButtonLink href="/request/new" variant="secondary">
                <Icon name="request" size={16} />
                {t.home.request}
              </ButtonLink>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
