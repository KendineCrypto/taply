'use client';

import { TaplyIcon } from '@/components/brand/TaplyIcon';
import { Icon } from '@/components/shell/Icons';
import { useCopy } from '@/lib/hooks/browser';
import { useT } from '@/lib/i18n/provider';
import { shortAccountId } from '@/lib/near/account';

/**
 * Connected-account row for chrome (home card, settings).
 *
 * The visible ID may be shortened here because this is not a decision point;
 * the full ID is what gets copied and what assistive tech reads. Payment review
 * screens must use <AccountId variant="full"> instead.
 */
export function AccountChip({
  accountId,
  caption,
  full = false,
}: {
  readonly accountId: string;
  readonly caption?: string;
  readonly full?: boolean;
}) {
  const t = useT();
  const { status, copy } = useCopy();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--surface-0)] ring-1 ring-[var(--border-subtle)]">
        <TaplyIcon size={22} variant="bare" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`chain-id ${full ? '' : 'truncate'} text-[0.9375rem] text-[var(--text-primary)]`} title={accountId}>
          {full ? (
            accountId
          ) : (
            <>
              <span aria-hidden="true">{shortAccountId(accountId)}</span>
              <span className="sr-only">{accountId}</span>
            </>
          )}
        </p>
        {caption !== undefined && <p className="text-xs text-[var(--text-muted)]">{caption}</p>}
      </div>
      <button
        type="button"
        onClick={() => copy(accountId)}
        className="tap-target grid shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:bg-[var(--tone-neutral-bg)] hover:text-[var(--text-primary)]"
        aria-label={t.wallet.copyAccount}
      >
        <Icon name={status === 'copied' ? 'check' : 'copy'} size={18} />
      </button>
      <span
        className={status === 'failed' ? 'basis-full text-xs text-[var(--tone-caution-fg)]' : 'sr-only'}
        role="status"
      >
        {status === 'copied' ? t.wallet.accountCopied : status === 'failed' ? t.wallet.copyFailed : ''}
      </span>
    </div>
  );
}
