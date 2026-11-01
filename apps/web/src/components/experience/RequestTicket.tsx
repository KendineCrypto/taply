'use client';

import type { ReactNode } from 'react';
import { TaplyWordmark } from '@/components/brand/TaplyIcon';
import { QrCode } from '@/components/payments/QrCode';
import { useT } from '@/lib/i18n/provider';
import { AmountHero, DemoStamp, Monogram, NetworkPill, PaperRow, TicketTear, useShortDateTime } from './Basics';
import { SaleCodeChip } from './SharedSession';

/**
 * The shareable payment request: a cream "ticket" that reads well on a phone
 * held up to another phone, and in a screenshot.
 *
 * The QR encodes exactly `link`, and `link` is printed in full underneath, so
 * the code is never the only way to get it. The recipient is shown in full.
 */
export function RequestTicket({
  link,
  recipientAccountId,
  amountBaseUnits,
  memo,
  expiresAtNs,
  permittedPayerAccountId,
  demo = false,
  actions,
  code = null,
}: {
  readonly link: string;
  readonly recipientAccountId: string;
  readonly amountBaseUnits: string;
  readonly memo: string;
  readonly expiresAtNs: string | null;
  readonly permittedPayerAccountId: string | null;
  readonly demo?: boolean;
  readonly actions?: ReactNode;
  /** Phase 7F sale code (from the request ID), so it can be read off the QR screen. */
  readonly code?: string | null;
}) {
  const t = useT();
  const shortDate = useShortDateTime();
  return (
    <section aria-labelledby="request-ticket-title" className="animate-rise flex flex-col gap-4">
      <div className={`paper relative overflow-hidden px-5 pb-5 pt-5 ${code !== null ? 'journey-amount-glow' : ''}`}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <TaplyWordmark width={72} tone="paper" />
          <NetworkPill tone="paper" />
        </div>
        {demo && <DemoStamp />}

        <div className="flex items-start justify-between gap-3">
          <h2 id="request-ticket-title" className="eyebrow pt-0.5 text-[var(--ink-muted)]">
            {t.experience.paymentRequest}
          </h2>
          {code !== null && <SaleCodeChip code={code} tone="paper" />}
        </div>
        <AmountHero baseUnits={amountBaseUnits} tone="paper" className="mt-3" />
        {memo !== '' && <p className="mt-3 whitespace-pre-wrap break-words text-base text-[var(--ink-secondary)]">“{memo}”</p>}

        <div className="mt-5 flex items-center gap-3">
          <Monogram accountId={recipientAccountId} tone="paper" />
          <div className="min-w-0">
            <p className="text-xs text-[var(--ink-muted)]">{t.experience.to}</p>
            <p className="chain-id text-[0.9375rem] font-semibold">{recipientAccountId}</p>
          </div>
        </div>

        <TicketTear />

        <div className="flex flex-col items-center gap-3">
          <div className="rounded-2xl bg-[var(--paper-shade)] p-2">
            <QrCode value={link} label={t.payment.share.qrLabel} size={208} />
          </div>
          <p className="text-center text-sm text-[var(--ink-secondary)]">{t.experience.scanToPay}</p>
        </div>

        <dl className="mt-4">
          <PaperRow label={t.common.mode}>{t.experience.instantPay}</PaperRow>
          {permittedPayerAccountId !== null && (
            <PaperRow label={t.payment.review.permittedPayer}>
              <span className="chain-id">{permittedPayerAccountId}</span>
            </PaperRow>
          )}
          {expiresAtNs !== null && (
            <PaperRow label={t.experience.validUntil}>{shortDate(expiresAtNs)}</PaperRow>
          )}
        </dl>
        <p className="chain-id mt-3 break-all rounded-xl bg-[var(--paper-shade)] px-3 py-2 text-xs text-[var(--ink-secondary)]" data-testid="pay-link">
          {link}
        </p>
      </div>
      {actions}
    </section>
  );
}
