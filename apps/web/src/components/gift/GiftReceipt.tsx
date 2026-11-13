'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { GiftReader } from '@taply/near-client';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { NetworkPill, useShortDateTime } from '@/components/experience/Basics';
import { Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { formatBaseUnits } from '@/lib/format/amount';
import { useLocale, useT } from '@/lib/i18n/provider';
import { CHAIN_CONFIG } from '@/lib/near/config';
import { GIFT_SETUP, defaultGiftReader, useGift } from '@/lib/gift/hooks';
import type { GiftSetup } from '@/lib/gift/setup';
import { claimAttempt } from '@/lib/gift/store';
import { useWallet } from '@/lib/wallet/provider';

/** /gift/[id]/receipt — facts read from NEAR Testnet at a final block, code hash checked. */
export function GiftReceipt({ id, setup = GIFT_SETUP, reader }: { readonly id: string; readonly setup?: GiftSetup; readonly reader?: GiftReader | null }) {
  const t = useT();
  const g = t.gift;
  const r = g.receipt;
  const { locale } = useLocale();
  const date = useShortDateTime();
  const { state: wallet } = useWallet();
  const { read } = useGift(id, setup.status === 'ready' ? (reader === undefined ? defaultGiftReader(setup) : reader) : null);
  if (setup.status !== 'ready') return <InlineNotice copy={g.claim.flagOff} tone="neutral" />;
  if (read.status === 'loading') return <p role="status" className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><Spinner /> {g.claim.states.loading.title}</p>;
  if (read.status === 'error') return <InlineNotice copy={g.claim.states.unavailable} />;
  const gift = read.gift;
  if (gift === null) return <InlineNotice copy={g.claim.states.not_found} />;
  const explorer = CHAIN_CONFIG.ok ? CHAIN_CONFIG.explorerBaseUrl : null;
  const me = wallet.status === 'connected' ? wallet.session.accountId : null;
  const tx = me === null ? null : claimAttempt(id, me)?.txHash ?? null;
  const stateKey = gift.status === 'AVAILABLE' ? 'available' : gift.status === 'EXPIRED' ? 'expired'
    : gift.status === 'REFUNDED' ? (gift.payout === 'CONFIRMED' ? 'refunded' : 'refund_pending')
    : gift.payout === 'CONFIRMED' ? 'already_claimed' : gift.payout === 'FAILED' ? 'payout_failed' : 'claim_pending';
  const statusLabel = g.claim.states[stateKey].title;
  return (
    <div className="flex flex-col gap-4">
      <section className="surface-paper flex flex-col gap-1 rounded-[var(--radius-hero)] bg-[var(--paper)] p-5 text-[var(--ink)]">
        <div className="flex items-center justify-between">
          <p className="eyebrow text-[var(--ink-muted)]">{r.title}</p>
          <NetworkPill tone="paper" />
        </div>
        <p className="mt-2 text-[2.25rem] font-semibold leading-none tracking-tight">
          {formatBaseUnits(gift.amountYocto, 24, { locale, maxFractionDigits: 5 }).display} <span className="text-lg">NEAR</span>
        </p>
        <p className="mt-1 text-sm font-semibold">{gift.status === 'CLAIMED' ? `${g.claim.winner}: ${gift.beneficiary ?? ''}` : statusLabel}</p>
        <dl className="mt-3 text-sm">
          <Row label={r.status} value={statusLabel} />
          <Row label={r.giftId} value={<span className="chain-id break-all">{gift.id}</span>} />
          <Row label={r.creator} value={<span className="chain-id break-all">{gift.creator}</span>} />
          <Row label={r.created} value={date(gift.createdAtNs)} />
          <Row label={r.expires} value={date(gift.expiresAtNs)} />
          {gift.beneficiary !== null && <Row label={r.beneficiary} value={<span className="chain-id break-all">{gift.beneficiary}</span>} />}
          {gift.payout !== null && <Row label={r.payout} value={g.claim.payoutValues[gift.payout]} />}
          {gift.settledAtNs !== null && <Row label={r.settledAt} value={`${date(gift.settledAtNs)} · #${gift.settledHeight ?? ''}`} />}
          {setup.status === 'ready' && <Row label={r.contract} value={<span className="chain-id break-all">{setup.contractId}</span>} />}
          {setup.status === 'ready' && <Row label={r.codeHash} value={<span className="chain-id break-all">{setup.expectedCodeHash}</span>} />}
          <Row label={r.block} value={<span className="chain-id">#{read.blockHeight}</span>} />
          {tx !== null && explorer !== null && <Row label={g.claim.yourTx} value={<a className="chain-id underline" href={`${explorer}/txns/${tx}`} target="_blank" rel="noopener noreferrer">{tx.slice(0, 12)}…</a>} />}
        </dl>
        <p className="mt-3 text-xs text-[var(--ink-muted)]">{r.honest}</p>
      </section>
      <div className="flex flex-wrap gap-2">
        <Link href={`/gift/${id}`} className="pressable inline-flex min-h-[var(--tap-target)] items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border-subtle)] px-4 text-sm font-semibold">
          <Icon name="arrow-left" size={16} /> {r.back}
        </Link>
        {explorer !== null && setup.status === 'ready' && (
          <a href={`${explorer}/address/${setup.contractId}`} target="_blank" rel="noopener noreferrer" className="pressable inline-flex min-h-[var(--tap-target)] items-center gap-1.5 rounded-[var(--radius-control)] px-4 text-sm font-medium text-[var(--text-secondary)]">
            <Icon name="external" size={16} /> {r.explorer}
          </a>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--ink-line)] py-2 last:border-0">
      <dt className="shrink-0 text-[var(--ink-muted)]">{label}</dt>
      <dd className="min-w-0 text-right">{value}</dd>
    </div>
  );
}
