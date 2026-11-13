'use client';

import { formatBaseUnits } from '@/lib/format/amount';
import { fill } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n/provider';

/**
 * The letter inside the envelope. `status` is a short chain-derived line
 * (e.g. "Available", "Already claimed"); null on the creator's own preview.
 */
export function GiftLetter({ from, amountYocto, message, status }: {
  readonly from: string;
  readonly amountYocto: string;
  readonly message: string;
  readonly status: string | null;
}) {
  const t = useT();
  const { locale } = useLocale();
  const amount = formatBaseUnits(amountYocto, 24, { locale, maxFractionDigits: 4 }).display;
  return (
    <div className="flex h-full flex-col gap-1.5 text-left">
      <p className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">
        {from === '' ? t.gift.title : fill(t.gift.envelope.from, { name: from })}
      </p>
      <p className="gift-letter-amount text-[1.75rem] font-semibold leading-none">
        {amount} <span className="text-base font-semibold text-[var(--ink-secondary)]">NEAR</span>
      </p>
      {status !== null && <p className="text-xs font-semibold text-[var(--ink-secondary)]">{status}</p>}
      <p className="line-clamp-3 whitespace-pre-line break-words text-sm leading-snug text-[var(--ink-secondary)]">
        {message === '' ? t.gift.envelope.noMessage : message}
      </p>
    </div>
  );
}
