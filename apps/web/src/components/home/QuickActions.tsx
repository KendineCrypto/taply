'use client';

import Link from 'next/link';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';

/**
 * The three wallet actions. Each opens a real screen:
 *  - Send:    full prepare-and-review flow; confirming is unavailable until a
 *             direct-transfer signer exists and signing is approved (the screen
 *             says so before anything else).
 *  - Receive: the connected account as text and QR.
 *  - Request: the Instant Pay create flow (signing gated on that screen).
 */
interface Action {
  readonly href: '/send' | '/receive' | '/request/new';
  readonly icon: IconName;
  readonly label: 'send' | 'receive' | 'request';
  readonly primary: boolean;
}

const ACTIONS: ReadonlyArray<Action> = [
  { href: '/send', icon: 'send', label: 'send', primary: false },
  { href: '/receive', icon: 'receive', label: 'receive', primary: false },
  { href: '/request/new', icon: 'request', label: 'request', primary: true },
];

export function QuickActions() {
  const t = useT();
  return (
    <nav aria-label={t.home.quickActionsLabel}>
      <ul className="grid grid-cols-3 gap-3">
        {ACTIONS.map((action) => (
          <li key={action.href}>
            <Link
              href={action.href}
              className="pressable group flex flex-col items-center gap-2 rounded-[var(--radius-card)] py-1 text-sm font-semibold text-[var(--text-primary)]"
            >
              <span
                className={`grid size-[60px] place-items-center rounded-full transition-colors ${
                  action.primary
                    ? 'bg-[var(--taply-lime)] text-[var(--taply-night)] shadow-[0_12px_28px_-12px_rgb(199_252_117/0.65)] group-hover:bg-[#d4fd92]'
                    : 'bg-[var(--surface-2)] text-[var(--text-primary)] ring-1 ring-[var(--border-strong)] group-hover:bg-[#2a4131]'
                }`}
              >
                <Icon name={action.icon} size={24} />
              </span>
              {t.home[action.label]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
