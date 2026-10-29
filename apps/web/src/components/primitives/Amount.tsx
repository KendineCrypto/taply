'use client';

import { useLocale, useT } from '@/lib/i18n/provider';
import { formatBaseUnits } from '@/lib/format/amount';
import type { DisplayAsset, U128 } from '@/lib/protocol';

/**
 * The only way to put a chain amount on screen.
 *
 * `display="exact"` is mandatory wherever someone decides something: the review
 * sheet before signing, and the final receipt. `compact` exists for dense
 * chrome (lists, headers) and always flags that digits were dropped.
 */
export function Amount({
  baseUnits,
  asset,
  display = 'exact',
  className,
}: {
  readonly baseUnits: U128;
  readonly asset: DisplayAsset;
  readonly display?: 'exact' | 'compact';
  readonly className?: string;
}) {
  const { locale } = useLocale();
  const t = useT();
  const formatted = formatBaseUnits(baseUnits, asset.decimals, { locale });
  const shown = display === 'exact' ? formatted.exact : formatted.display;
  const truncated = display === 'compact' && formatted.truncated;

  return (
    <span className={className}>
      <span className="tabular-nums">{shown}</span>
      {truncated && (
        <span aria-hidden="true" title={formatted.exact}>
          …
        </span>
      )}{' '}
      <span className="text-[var(--text-secondary)]">{asset.symbol}</span>
      {/* Assistive tech and copy/paste always get the unambiguous value. */}
      <span className="sr-only">
        {formatted.exact} {asset.symbol}. {t.common.exactBaseUnits}: {formatted.baseUnits}
      </span>
    </span>
  );
}

/**
 * Account IDs.
 *
 * `variant="full"` is required at every decision point: an ellipsised account ID
 * is exactly how payee-substitution attacks succeed. Truncation is allowed only
 * in non-decision chrome, and even then the full value stays available to
 * assistive technology.
 */
export function AccountId({
  accountId,
  variant = 'full',
  className,
}: {
  readonly accountId: string;
  readonly variant?: 'full' | 'chrome';
  readonly className?: string;
}) {
  if (variant === 'full') {
    return <span className={`chain-id ${className ?? ''}`}>{accountId}</span>;
  }

  const short = accountId.length > 18 ? `${accountId.slice(0, 8)}…${accountId.slice(-6)}` : accountId;

  return (
    <span className={`chain-id ${className ?? ''}`}>
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">{accountId}</span>
    </span>
  );
}
