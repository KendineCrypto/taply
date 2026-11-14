'use client';

import { useMemo } from 'react';
import { Amount } from '@/components/primitives/Amount';
import { RecentActivityView } from './RecentActivityView';
import type { ActivityTone } from './RecentActivityView';
import type { IconName } from '@/components/shell/Icons';
import { useLocale, useT } from '@/lib/i18n/provider';
import { CHAIN_CONFIG, explorerAccountUrl } from '@/lib/near/config';
import { usePayments } from '@/lib/payments/context';
import type { JournalEntry } from '@/lib/payments/journal';
import { NEAR_NATIVE } from '@/lib/protocol';
import { useAccountId } from '@/lib/wallet/provider';
import { PROTECTED_SETUP } from '@/lib/protected/hooks';

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
  fund_protected_native: 'shield',
  cancel_protected: 'x',
  release_protected: 'send',
  ft_transfer_call: 'shield',
};

const PROTECTED_METHODS: ReadonlySet<JournalEntry['method']> = new Set(['fund_protected_native', 'cancel_protected', 'release_protected', 'ft_transfer_call']);

/** Protected entries (any method, including retries and creation) open the Protected view. */
function hrefFor(entry: JournalEntry): string {
  const protectedContract = PROTECTED_SETUP.status === 'ready' ? PROTECTED_SETUP.contractId : null;
  const isProtected = PROTECTED_METHODS.has(entry.method) || (protectedContract !== null && entry.contractId === protectedContract);
  return `${isProtected ? '/protected' : '/pay'}/${entry.requestId}`;
}

const PHASE_TONE: Readonly<Record<JournalEntry['phase'], ActivityTone>> = {
  AWAITING_SIGNATURE: 'caution',
  OUTCOME_UNKNOWN: 'caution',
  SUBMITTED: 'caution',
  USER_REJECTED: 'muted',
  RESOLVED: 'neutral',
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
    <RecentActivityView
      preview={preview}
      rows={entries.map((entry) => ({
        key: `${entry.requestId}:${entry.method}`,
        href: hrefFor(entry),
        icon: METHOD_ICON[entry.method],
        title: t.walletUx.activity.method[entry.method],
        time: time(entry.updatedAt),
        amount: entry.terms !== null ? <Amount baseUnits={entry.terms.amountBaseUnits} asset={NEAR_NATIVE} display="compact" className="text-sm font-semibold" /> : null,
        phase: t.walletUx.activity.phase[entry.phase],
        tone: PHASE_TONE[entry.phase],
      }))}
      allHref="/activity"
      emptyBody={accountId === null ? t.home.activityConnectBody : t.walletUx.home.activityEmptyBody}
      explorerHref={explorer}
    />
  );
}
