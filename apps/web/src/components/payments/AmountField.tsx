'use client';

import { useT } from '@/lib/i18n/provider';

/** Amount-first request input, shared by the Testnet and NEAR Mainnet builds (presentational). */
const MAX_AMOUNT_CHARS = 36;

/**
 * The amount being typed must stay fully visible: a field that scrolls sideways
 * hides digits a merchant is about to charge. Long values step the font down
 * instead (the review step still shows the exact amount before signing).
 */
const AMOUNT_SIZES = {
  hero: 'max-w-[78%] text-[3.5rem] min-[400px]:text-[4rem]',
  large: 'max-w-[78%] text-[2.5rem] min-[400px]:text-[2.75rem]',
  medium: 'max-w-[82%] text-[1.625rem] min-[400px]:text-[1.875rem]',
  small: 'max-w-[90%] text-[0.875rem]',
} as const;

/** The NEAR suffix shrinks with the figure so long values keep their room. */
const SUFFIX_SIZES = { hero: 'text-2xl', large: 'text-2xl', medium: 'text-lg', small: 'text-xs' } as const;

export function amountSizeStep(length: number): keyof typeof AMOUNT_SIZES {
  if (length <= 7) return 'hero';
  if (length <= 11) return 'large';
  if (length <= 18) return 'medium';
  return 'small';
}

/** Amount-first input: one large field, the only mandatory one. */
export function AmountField({
  id,
  value,
  onChange,
  error,
  suffix = 'NEAR',
  hint,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | null;
  readonly suffix?: string;
  readonly hint?: string;
}) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-2 pt-2 text-center">
      <label htmlFor={id} className="text-sm font-medium text-[var(--text-secondary)]">
        {t.payment.create.amountLabel}
      </label>
      <div className="flex w-full items-baseline justify-center gap-2">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder={t.experience.create.amountPlaceholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          size={Math.max(1, Math.min(value.length || 1, MAX_AMOUNT_CHARS))}
          data-length={amountSizeStep(value.length)}
          className={`display-amount min-h-[76px] bg-transparent text-center text-[var(--text-primary)] caret-[var(--taply-lime)] placeholder:text-[var(--text-muted)] focus-visible:outline-none ${AMOUNT_SIZES[amountSizeStep(value.length)]}`}
          aria-describedby={`${id}-hint ${id}-error`}
          aria-invalid={error !== null || undefined}
        />
        <span aria-hidden="true" className={`${SUFFIX_SIZES[amountSizeStep(value.length)]} shrink-0 font-semibold text-[var(--text-muted)]`}>
          {suffix}
        </span>
      </div>
      <p id={`${id}-hint`} className="text-xs text-[var(--text-muted)]">
        {hint ?? t.payment.create.amountHint}
      </p>
      <p id={`${id}-error`} className="min-h-5 text-sm text-[var(--tone-danger-fg)]" role={error === null ? undefined : 'alert'}>
        {error}
      </p>
    </div>
  );
}
