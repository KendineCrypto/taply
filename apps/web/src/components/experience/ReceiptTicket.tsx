'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { TaplyWordmark } from '@/components/brand/TaplyIcon';
import { Icon } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';
import { explorerTransactionUrl } from '@/lib/near/config';
import { AmountHero, DemoStamp, Monogram, NetworkPill, PaperRow, TicketTear, useShortDateTime } from './Basics';

/**
 * The receipt a person keeps.
 *
 * `status` is decided by the caller from evidence:
 *  - `verified`      ONLY from the independent receipt verifier (or the DEMO tour,
 *                    where `demo` forces a visible DEMO stamp);
 *  - `contract_paid` the contract reports FINAL_PAID, receipts not checked here;
 *  - `cancelled`     cancelled before funding.
 * The seal is the only place the Verified Paid treatment appears.
 */

export interface ReceiptReference {
  readonly label: string;
  readonly value: string;
  /** A transaction hash gets an explorer link (never in demo mode). */
  readonly transaction?: boolean;
}

export function ReceiptTicket({
  status,
  amountBaseUnits,
  recipientAccountId,
  payerAccountId,
  memo,
  settledAtNs,
  references,
  explorerBaseUrl,
  checkedVia,
  demo = false,
  actions,
  proofActions,
  celebrateKey,
}: {
  readonly status: 'verified' | 'contract_paid' | 'cancelled';
  readonly amountBaseUnits: string;
  readonly recipientAccountId: string;
  readonly payerAccountId: string | null;
  readonly memo: string;
  readonly settledAtNs: string | null;
  readonly references: ReadonlyArray<ReceiptReference>;
  readonly explorerBaseUrl: string | null;
  readonly checkedVia?: string;
  readonly demo?: boolean;
  readonly actions?: ReactNode;
  /** Extra controls inside the collapsed technical proof (e.g. copy evidence JSON). */
  readonly proofActions?: ReactNode;
  /**
   * When set on a `verified` receipt, the seal animates the first time this
   * key is seen in this browser session, and is static afterwards.
   */
  readonly celebrateKey?: string;
}) {
  const t = useT();
  const shortDate = useShortDateTime();
  const hasProof = references.length > 0 || checkedVia !== undefined || proofActions !== undefined;
  const r = t.experience.receipt;
  const seal = {
    verified: { title: r.verified, sub: r.verifiedSub },
    contract_paid: { title: r.contractPaid, sub: r.contractPaidSub },
    cancelled: { title: r.cancelled, sub: r.cancelledSub },
  }[status];

  return (
    <section aria-labelledby="receipt-title" className="animate-rise flex flex-col gap-4" data-receipt-status={status}>
      <div className="paper relative overflow-hidden px-5 pb-5 pt-5">
        <div className="mb-6 flex items-center justify-between gap-3">
          <TaplyWordmark width={72} tone="paper" />
          <NetworkPill tone="paper" />
        </div>
        {demo && <DemoStamp />}

        <div className="flex flex-col items-center text-center">
          <Seal key={status} status={status} celebrateKey={celebrateKey} />
          <h2 id="receipt-title" className="mt-3 text-xl font-semibold tracking-tight">
            {seal.title}
          </h2>
          <p className="mt-0.5 text-sm text-[var(--ink-muted)]">{seal.sub}</p>
          <AmountHero baseUnits={amountBaseUnits} tone="paper" className="mt-5 justify-center" />
          {memo !== '' && <p className="mt-2 whitespace-pre-wrap break-words text-[var(--ink-secondary)]">“{memo}”</p>}
        </div>

        <TicketTear />

        <dl>
          <PaperRow label={r.paidTo}>
            <span className="flex items-center justify-end gap-2">
              <span className="chain-id">{recipientAccountId}</span>
              <Monogram accountId={recipientAccountId} tone="paper" size={26} />
            </span>
          </PaperRow>
          {payerAccountId !== null && (
            <PaperRow label={r.paidBy}>
              <span className="chain-id">{payerAccountId}</span>
            </PaperRow>
          )}
          {settledAtNs !== null && <PaperRow label={r.settledAt}>{shortDate(settledAtNs)}</PaperRow>}
          <PaperRow label={t.common.mode}>{t.experience.instantPay}</PaperRow>
        </dl>

        {hasProof && (
          <details className="disclosure mt-3 rounded-2xl bg-[var(--paper-shade)] px-3">
            <summary className="flex min-h-[var(--tap-target)] items-center justify-between gap-3 text-sm font-medium text-[var(--ink-secondary)]">
              {t.oneTap.receipt.technicalProof}
              <Icon name="chevron" size={16} className="disclosure-chevron shrink-0" />
            </summary>
            {checkedVia !== undefined && (
              <dl className="mb-2">
                <PaperRow label={r.checkedBy}>
                  <span className="chain-id">{checkedVia}</span>
                </PaperRow>
              </dl>
            )}
            {references.length > 0 && <p className="eyebrow mb-2 text-[var(--ink-muted)]">{r.references}</p>}
            <ul className="flex flex-col gap-2 pb-3">
              {references.map((ref) => (
                <li key={`${ref.label}:${ref.value}`} className="flex flex-col gap-0.5">
                  <span className="text-xs text-[var(--ink-muted)]">{ref.label}</span>
                  {ref.transaction === true && explorerBaseUrl !== null && !demo ? (
                    <a
                      href={explorerTransactionUrl(explorerBaseUrl, ref.value)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="chain-id inline-flex items-center gap-1 break-all font-medium underline decoration-[var(--ink-line)] underline-offset-2"
                    >
                      {ref.value}
                      <Icon name="external" size={13} className="shrink-0" />
                      <span className="sr-only">({t.common.viewOnExplorer})</span>
                    </a>
                  ) : (
                    <span className="chain-id break-all">{ref.value}</span>
                  )}
                </li>
              ))}
            </ul>
            {demo && <p className="pb-3 text-xs text-[var(--ink-muted)]">{t.experience.demo.explorerNote}</p>}
            {proofActions !== undefined && <div className="pb-3">{proofActions}</div>}
          </details>
        )}
        {demo && <p className="mt-3 text-xs leading-relaxed text-[var(--ink-muted)]">{t.experience.demo.evidenceNote}</p>}
      </div>
      {actions}
    </section>
  );
}

/** True only the first time `key` is seen in this browser session. */
function useFirstTime(key: string | undefined): boolean {
  const storageKey = key === undefined ? null : `taply.sealed.${key}`;
  const [first] = useState(() => {
    if (storageKey === null || typeof window === 'undefined') return false;
    try {
      return window.sessionStorage.getItem(storageKey) === null;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (storageKey === null) return;
    try {
      window.sessionStorage.setItem(storageKey, '1');
    } catch {
      // Storage unavailable: the seal simply stays static next time too.
    }
  }, [storageKey]);
  return first;
}

function Seal({ status, celebrateKey }: { readonly status: 'verified' | 'contract_paid' | 'cancelled'; readonly celebrateKey: string | undefined }) {
  // Keyed by status in the parent, so this runs when the receipt becomes verified.
  const celebrate = useFirstTime(status === 'verified' ? celebrateKey : undefined);
  if (status === 'verified') {
    return (
      <span
        className={`grid size-16 place-items-center rounded-full bg-[var(--ink)] text-[var(--taply-lime)] shadow-[0_10px_30px_-10px_rgb(11_18_14/0.6)] ${celebrate ? 'animate-seal' : ''}`}
        data-celebrate={celebrate || undefined}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z" />
          <path d="m9 12 2.2 2.2L15.5 10" className={celebrate ? 'animate-seal-check' : ''} />
        </svg>
      </span>
    );
  }
  return (
    <span className="grid size-16 place-items-center rounded-full border-2 border-[var(--ink-line)] text-[var(--ink-secondary)]">
      <Icon name={status === 'cancelled' ? 'x' : 'check'} size={28} />
    </span>
  );
}
