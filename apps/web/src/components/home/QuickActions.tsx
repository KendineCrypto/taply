'use client';

import Link from 'next/link';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { FLAGS } from '@/lib/flags/features';
import type { FeatureFlag } from '@/lib/flags/features';
import { useT } from '@/lib/i18n/provider';

interface Action {
  readonly href: '/send' | '/receive' | '/request/new';
  readonly icon: IconName;
  readonly label: 'send' | 'receive' | 'request';
  /** null = available whenever a wallet is connected (read-only). */
  readonly flag: FeatureFlag | null;
}

/**
 * Send and Request move or request money, so they wait for the deployed
 * contract / verified Instant Pay (brief item 8) and say "Soon" until then.
 * Receive only shows the connected account ID, so it is live now.
 */
const ACTIONS: ReadonlyArray<Action> = [
  { href: '/send', icon: 'send', label: 'send', flag: 'instantPay' },
  { href: '/receive', icon: 'receive', label: 'receive', flag: null },
  { href: '/request/new', icon: 'request', label: 'request', flag: 'instantPay' },
];

export function QuickActions() {
  const t = useT();

  return (
    <nav aria-label={t.home.quickActionsLabel}>
      <ul className="grid grid-cols-3 gap-3">
        {ACTIONS.map((action) => {
          const soon = action.flag !== null && !FLAGS[action.flag].enabled;
          const label = t.home[action.label];
          return (
            <li key={action.href}>
              <Link
                href={action.href}
                aria-label={soon ? `${label}, ${t.home.soon}` : label}
                className="group flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2 py-3 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
              >
                <span
                  className={`grid size-11 place-items-center rounded-full ${
                    soon
                      ? 'bg-[var(--tone-neutral-bg)] text-[var(--text-secondary)]'
                      : 'bg-[var(--taply-lime)] text-[var(--taply-night)]'
                  }`}
                >
                  <Icon name={action.icon} size={20} />
                </span>
                <span className="flex flex-col items-center leading-tight" aria-hidden="true">
                  <span className="text-sm font-semibold">{label}</span>
                  {soon && (
                    <span className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                      {t.home.soon}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
