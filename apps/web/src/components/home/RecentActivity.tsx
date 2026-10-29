'use client';

import { ButtonLink } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';
import { CHAIN_CONFIG, explorerAccountUrl } from '@/lib/near/config';
import { useAccountId } from '@/lib/wallet/provider';

/**
 * Recent activity.
 *
 * There is no activity source yet: the Codex endpoint
 * `GET /api/v1/accounts/:accountId/activity` is planned, not running. Rather
 * than invent rows, this shows an honest empty state and a link to the public
 * explorer, which is real Testnet evidence the person can check themselves.
 */
export function RecentActivity() {
  const t = useT();
  const accountId = useAccountId();

  return (
    <section aria-labelledby="activity-title">
      <h2 id="activity-title" className="mb-3 text-base font-semibold tracking-tight">
        {t.home.recentActivity}
      </h2>
      <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border-subtle)] px-5 py-6 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-[var(--tone-neutral-bg)] text-[var(--text-secondary)]">
          <Icon name="activity" />
        </span>
        <p className="mt-3 font-medium">{t.home.activityEmptyTitle}</p>
        <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-[var(--text-secondary)]">
          {accountId === null ? t.home.activityConnectBody : t.home.activityEmptyBody}
        </p>
        {accountId !== null && CHAIN_CONFIG.ok && (
          <div className="mt-4">
            <ButtonLink href={explorerAccountUrl(CHAIN_CONFIG.explorerBaseUrl, accountId)} external>
              {t.home.viewOnExplorer}
              <Icon name="external" size={16} />
            </ButtonLink>
          </div>
        )}
      </div>
    </section>
  );
}
