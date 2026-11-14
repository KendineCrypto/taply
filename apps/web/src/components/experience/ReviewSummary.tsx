'use client';

import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/provider';
import { AmountHero, Monogram, NetworkPill } from './Basics';

/**
 * The top of the payer's confirmation: what will happen, in the order a person
 * checks it - amount, who receives it (in full), where, and what the wallet
 * will be asked to do. Signing controls stay with the caller.
 */
export function ReviewSummary({
  recipientAccountId,
  amountBaseUnits,
  contractId,
  memo,
  payerAccountId = null,
  permittedPayerAccountId = null,
  payableUntil = null,
  asset,
}: {
  readonly asset?: { readonly decimals: number; readonly symbol: string };
  readonly recipientAccountId: string;
  readonly amountBaseUnits: string;
  readonly contractId: string;
  readonly memo: string;
  /** The connected account that would sign, shown in full. */
  readonly payerAccountId?: string | null;
  readonly permittedPayerAccountId?: string | null;
  /** Funding deadline (chain time), when the request is still payable. */
  readonly payableUntil?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow text-[var(--text-muted)]">{t.experience.youArePaying}</p>
        <NetworkPill />
      </div>
      <AmountHero {...(asset ? { asset } : {})} baseUnits={amountBaseUnits} />
      {memo !== '' && <p className="-mt-1 whitespace-pre-wrap break-words text-[var(--text-secondary)]">“{memo}”</p>}
      <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[rgb(244_243_232/0.04)] p-3">
        <Monogram accountId={recipientAccountId} />
        <div className="min-w-0">
          <p className="text-xs text-[var(--text-muted)]">{t.experience.to}</p>
          <p className="chain-id text-[0.9375rem] font-semibold text-[var(--text-primary)]">{recipientAccountId}</p>
        </div>
      </div>
      <dl className="grid gap-2 text-sm">
        {payerAccountId !== null && (
          <div className="flex items-start justify-between gap-3">
            <dt className="shrink-0 whitespace-nowrap text-[var(--text-muted)]">{t.oneTap.payment.from}</dt>
            <dd className="chain-id text-right">{payerAccountId}</dd>
          </div>
        )}
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 whitespace-nowrap text-[var(--text-muted)]">{t.oneTap.request.whoCanPay}</dt>
          <dd className={permittedPayerAccountId === null ? 'text-right' : 'chain-id text-right'}>
            {permittedPayerAccountId ?? t.oneTap.request.anyoneMayPay}
          </dd>
        </div>
        {payableUntil !== null && (
          <div className="flex items-start justify-between gap-3">
            <dt className="shrink-0 whitespace-nowrap text-[var(--text-muted)]">{t.oneTap.request.payableUntil}</dt>
            <dd className="text-right">{payableUntil}</dd>
          </div>
        )}
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 whitespace-nowrap text-[var(--text-muted)]">{t.experience.review.walletAction}</dt>
          <dd className="text-right">{t.experience.review.walletActionValue}</dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 whitespace-nowrap text-[var(--text-muted)]">{t.experience.review.contract}</dt>
          <dd className="chain-id text-right">{contractId}</dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 whitespace-nowrap text-[var(--text-muted)]">{t.experience.review.networkFee}</dt>
          <dd className="text-right text-[var(--text-secondary)]">{t.experience.review.networkFeeValue}</dd>
        </div>
      </dl>
    </div>
  );
}
