'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Amount } from '@/components/primitives/Amount';
import { EmptyState } from '@/components/primitives/Surface';
import { Icon } from '@/components/shell/Icons';
import { useLocale, useT } from '@/lib/i18n/provider';
import { usePayments } from '@/lib/payments/context';
import type { JournalEntry } from '@/lib/payments/journal';
import { NEAR_NATIVE } from '@/lib/protocol';
import type { IntentTerms } from '@/lib/protocol';

export type SaleEntry = JournalEntry & { readonly terms: IntentTerms };

export const MAX_RECENT_SALES = 8;

/**
 * Sales this account started on this device, from the local submission
 * journal. The list shows NO payment status on purpose: whether a sale exists
 * and whether it was paid is read from the contract on its own /pay page.
 * Declined wallet prompts never created anything and are left out.
 */
export function selectRecentSales(entries: ReadonlyArray<JournalEntry>, accountId: string, contractId: string | null): SaleEntry[] {
  return entries
    .filter(
      (e): e is SaleEntry =>
        e.method === 'create_request' &&
        e.signerAccountId === accountId &&
        (contractId === null || e.contractId === contractId) &&
        e.terms !== null &&
        e.phase !== 'USER_REJECTED',
    )
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
    .slice(0, MAX_RECENT_SALES);
}

export function RecentSales({ accountId }: { readonly accountId: string }) {
  const t = useT();
  const m = t.commerce.merchant;
  const { locale } = useLocale();
  const { journal, journalVersion, setup } = usePayments();
  void journalVersion; // re-render when the journal changes

  const contractId = setup.status === 'ready' ? setup.contractId : null;
  const readable = journal !== null && journal.isReadable();
  const sales = readable ? selectRecentSales(journal.entries(), accountId, contractId) : [];
  const time = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <section aria-labelledby="recent-sales-title" className="flex flex-col gap-3">
      <div className="px-1">
        <h2 id="recent-sales-title" className="text-base font-semibold">
          {m.salesTitle}
        </h2>
        <p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">{m.salesNote}</p>
      </div>
      {!readable ? (
        <p className="px-1 text-sm text-[var(--text-secondary)]">{m.storageUnavailable}</p>
      ) : sales.length === 0 ? (
        <EmptyState title={m.salesEmpty.title} body={m.salesEmpty.body} />
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-1)]">
          {sales.map((sale, i) => (
            <li key={sale.requestId} className="stagger-item" style={{ '--i': i } as CSSProperties}>
              <Link
                href={`/pay/${sale.requestId}`}
                className="flex min-h-[64px] items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-2)]"
              >
                <span className="min-w-0 flex-1">
                  <Amount baseUnits={sale.terms.amountBaseUnits} asset={NEAR_NATIVE} className="block font-semibold" />
                  <span className="block truncate text-xs text-[var(--text-muted)]">
                    {/* Plain text only: references are untrusted. */}
                    {sale.terms.memo === '' ? m.noReference : sale.terms.memo} · {m.createdAt} {time.format(new Date(sale.startedAt))}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[var(--text-secondary)]">
                  {m.openStatus}
                  <Icon name="chevron" size={16} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
