'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';
import { useWallet } from '@/lib/wallet/provider';

/**
 * Three real actions under the balance. Only routes that work in this build:
 * receive (address + QR), request (form up to wallet review) and pay (scan or
 * paste a request). Send stays in the Tap sheet while sending is preview-only.
 */
export function HomeActions() {
  const t = useT();
  const { state } = useWallet();
  if (state.status !== 'connected') return null;
  const actions: ReadonlyArray<{ href: ComponentProps<typeof Link>['href']; icon: IconName; label: string }> = [
    { href: '/receive', icon: 'receive', label: t.home.receive },
    { href: '/request/new', icon: 'request', label: t.home.request },
    { href: '/scan', icon: 'scan', label: t.nav.pay },
  ];
  return (
    <nav aria-label={t.home.quickActionsLabel} className="grid grid-cols-3 gap-3" data-testid="home-actions">
      {actions.map((a) => (
        <Link
          key={a.label}
          href={a.href}
          className="flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[var(--surface-1)] text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--taply-lime)]"
        >
          <span className="grid size-10 place-items-center rounded-full bg-[rgb(199_252_117/0.12)] text-[var(--taply-lime)]">
            <Icon name={a.icon} size={20} />
          </span>
          {a.label}
        </Link>
      ))}
    </nav>
  );
}
