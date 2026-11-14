'use client';

import type { ReactNode } from 'react';
import { TaplyWordmark } from '@/components/brand/TaplyIcon';
import { Icon } from '@/components/shell/Icons';
import { nsToDate } from '@/lib/format/time';
import { formatMainnetAmount } from '@/lib/mainnet/assets';
import type { MainnetAsset } from '@/lib/mainnet/assets';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { useMainnetLocale } from '@/lib/mainnet/copy';

/**
 * Mainnet versions of the Testnet request ticket and receipt (same paper design),
 * fed only with Mainnet contract data. Presentation only: the caller decides the
 * state from the FINAL contract read; nothing here claims an independent receipt check.
 */

const EN = {
  request: 'Payment request', to: 'Pay to', expires: 'Expires', note: 'Note',
  paid: 'Payment recorded', paidSub: 'Recorded by the Taply contract at a final block.',
  refunded: 'Refunded', refundedSub: 'The amount went back to the payer. This is not a payment.',
  cancelled: 'Cancelled', cancelledSub: 'Closed before any payment.',
  paidTo: 'Paid to', paidBy: 'Paid by', when: 'When', mode: 'Mode', instant: 'Instant Pay',
  proof: 'Technical proof', requestId: 'Request ID', tx: 'Transaction', contract: 'Contract',
  doNotRepay: 'Do not pay this request again.',
};
const TR: typeof EN = {
  request: 'Ödeme talebi', to: 'Alıcı', expires: 'Son geçerlilik', note: 'Not',
  paid: 'Ödeme kaydedildi', paidSub: 'Taply sözleşmesi kesin blokta kaydetti.',
  refunded: 'İade edildi', refundedSub: 'Tutar ödeyene geri döndü. Bu bir ödeme değildir.',
  cancelled: 'İptal edildi', cancelledSub: 'Hiç ödeme yapılmadan kapandı.',
  paidTo: 'Ödenen', paidBy: 'Ödeyen', when: 'Zaman', mode: 'Tür', instant: 'Anında Ödeme',
  proof: 'Teknik kanıt', requestId: 'Talep kimliği', tx: 'İşlem', contract: 'Sözleşme',
  doNotRepay: 'Bu talebi tekrar ödemeyin.',
};
function useCopy() { return useMainnetLocale().locale === 'tr' ? TR : EN; }

function PaperPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ink)] px-2.5 py-1 text-[11px] font-semibold text-[var(--paper)]">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--taply-gold)]" />
      NEAR Mainnet
    </span>
  );
}

function PaperRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--ink-line)] py-3 last:border-b-0">
      <dt className="shrink-0 whitespace-nowrap text-sm text-[var(--ink-muted)]">{label}</dt>
      <dd className="min-w-0 break-all text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

function Tear() {
  return (
    <div aria-hidden="true" className="relative my-1 h-6">
      <span className="absolute -left-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-[var(--surface-0)]" />
      <span className="absolute -right-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-[var(--surface-0)]" />
      <span className="absolute inset-x-5 top-1/2 border-t-2 border-dashed border-[var(--ink-line)]" />
    </div>
  );
}

function Amount({ baseUnits, asset, testId }: { readonly baseUnits: string; readonly asset: MainnetAsset; readonly testId?: string }) {
  const { locale } = useMainnetLocale();
  const text = formatMainnetAmount(baseUnits, asset, locale);
  const [figure, unit] = [text.slice(0, text.lastIndexOf(' ')), asset.symbol];
  return (
    <p className="display-amount mt-5 flex flex-wrap items-baseline justify-center gap-x-2">
      <span aria-hidden="true" className="text-[3rem] leading-none min-[400px]:text-[3.4rem] [overflow-wrap:anywhere]">{figure}</span>
      <span aria-hidden="true" className="text-xl text-[var(--ink-muted)]">{unit}</span>
      <span className="sr-only" data-testid={testId}>{text}</span>
    </p>
  );
}

function useDateTime(): (ns: string) => string {
  const { locale } = useMainnetLocale();
  return (ns) => new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(nsToDate(ns));
}

/** Open request: the ticket the payer sees before paying. */
export function MainnetRequestTicket({ asset, amountBaseUnits, recipientAccountId, memo, expiresAtNs, children }: {
  readonly asset: MainnetAsset; readonly amountBaseUnits: string; readonly recipientAccountId: string; readonly memo: string;
  readonly expiresAtNs: string; readonly children?: ReactNode;
}) {
  const c = useCopy();
  const when = useDateTime();
  return (
    <section className="animate-rise paper relative overflow-hidden px-5 pb-5 pt-5" data-testid="request-ticket">
      <div className="mb-6 flex items-center justify-between gap-3">
        <TaplyWordmark width={72} tone="paper" />
        <PaperPill />
      </div>
      <div className="flex flex-col items-center text-center">
        <p className="eyebrow text-[var(--ink-muted)]">{c.request}</p>
        <Amount baseUnits={amountBaseUnits} asset={asset} testId="pay-amount" />
        {memo !== '' && <p className="mt-2 whitespace-pre-wrap break-words text-[var(--ink-secondary)]">“{memo}”</p>}
      </div>
      <Tear />
      <dl>
        <PaperRow label={c.to}><span className="chain-id">{recipientAccountId}</span></PaperRow>
        <PaperRow label={c.expires}>{when(expiresAtNs)}</PaperRow>
      </dl>
      {children}
    </section>
  );
}

export type MainnetReceiptStatus = 'paid' | 'refunded' | 'cancelled';

/** The receipt a person keeps (FINAL contract state; never labelled "verified"). */
export function MainnetReceiptTicket({ status, asset, amountBaseUnits, recipientAccountId, payerAccountId, memo, atNs, requestId, contractId, transactionHash, state }: {
  readonly status: MainnetReceiptStatus; readonly asset: MainnetAsset; readonly amountBaseUnits: string;
  readonly recipientAccountId: string; readonly payerAccountId: string | null; readonly memo: string; readonly atNs: string | null;
  readonly requestId: string; readonly contractId: string; readonly transactionHash?: string | null;
  /** The derived payment state (lib/mainnet/status), exposed for tests; same value the status card shows. */
  readonly state?: string;
}) {
  const c = useCopy();
  const when = useDateTime();
  const explorer = MAINNET_CONFIG.ok ? MAINNET_CONFIG.explorerBaseUrl : 'https://nearblocks.io';
  const seal = status === 'paid' ? { title: c.paid, sub: c.paidSub, icon: 'check' as const }
    : status === 'refunded' ? { title: c.refunded, sub: c.refundedSub, icon: 'refresh' as const }
    : { title: c.cancelled, sub: c.cancelledSub, icon: 'x' as const };
  return (
    <section aria-labelledby="mainnet-receipt-title" className="animate-rise paper relative overflow-hidden px-5 pb-5 pt-5" data-testid="mainnet-receipt" data-receipt-status={status}>
      <div className="mb-6 flex items-center justify-between gap-3">
        <TaplyWordmark width={72} tone="paper" />
        <PaperPill />
      </div>
      <div className="flex flex-col items-center text-center">
        <span className={`grid size-16 place-items-center rounded-full ${status === 'paid' ? 'animate-seal bg-[var(--ink)] text-[var(--taply-lime)] shadow-[0_10px_30px_-10px_rgb(11_18_14/0.6)]' : 'border-2 border-[var(--ink-line)] text-[var(--ink-secondary)]'}`}>
          <Icon name={seal.icon} size={30} />
        </span>
        <h2 id="mainnet-receipt-title" className="mt-3 text-xl font-semibold tracking-tight" data-state={state}>{seal.title}</h2>
        <p className="mt-0.5 text-sm text-[var(--ink-muted)]">{seal.sub}</p>
        <Amount baseUnits={amountBaseUnits} asset={asset} />
        {memo !== '' && <p className="mt-2 whitespace-pre-wrap break-words text-[var(--ink-secondary)]">“{memo}”</p>}
        {status === 'paid' && <p className="mt-3 text-xs font-medium text-[var(--ink-secondary)]" data-testid="do-not-repay">{c.doNotRepay}</p>}
      </div>
      <Tear />
      <dl>
        <PaperRow label={status === 'refunded' ? c.to : c.paidTo}><span className="chain-id">{recipientAccountId}</span></PaperRow>
        {payerAccountId !== null && <PaperRow label={c.paidBy}><span className="chain-id">{payerAccountId}</span></PaperRow>}
        {atNs !== null && <PaperRow label={c.when}>{when(atNs)}</PaperRow>}
        <PaperRow label={c.mode}>{c.instant}</PaperRow>
      </dl>
      <details className="disclosure mt-3 rounded-2xl bg-[var(--paper-shade)] px-3">
        <summary className="flex min-h-[var(--tap-target)] items-center justify-between gap-3 text-sm font-medium text-[var(--ink-secondary)]">
          {c.proof}
          <Icon name="chevron" size={16} className="disclosure-chevron shrink-0" />
        </summary>
        <ul className="flex flex-col gap-2 pb-3 text-sm">
          <li className="flex flex-col gap-0.5"><span className="text-xs text-[var(--ink-muted)]">{c.requestId}</span><span className="chain-id break-all">{requestId}</span></li>
          <li className="flex flex-col gap-0.5"><span className="text-xs text-[var(--ink-muted)]">{c.contract}</span>
            <a className="chain-id break-all underline" href={`${explorer}/address/${contractId}`} target="_blank" rel="noopener noreferrer">{contractId}</a></li>
          {transactionHash && (
            <li className="flex flex-col gap-0.5"><span className="text-xs text-[var(--ink-muted)]">{c.tx}</span>
              <a className="chain-id break-all underline" href={`${explorer}/txns/${transactionHash}`} target="_blank" rel="noopener noreferrer">{transactionHash}</a></li>
          )}
        </ul>
      </details>
    </section>
  );
}
