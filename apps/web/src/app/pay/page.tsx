'use client';

import Link from 'next/link';
import { ScreenHeader } from '@/components/primitives/Surface';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';

interface PayOption {
  readonly href: '/scan' | '/request/new' | '/send';
  readonly icon: IconName;
  readonly label: string;
  readonly body: string;
}

/**
 * Pay hub, reached from the bottom nav. `/pay/[id]` is the canonical intent
 * view; this index only routes a person toward one.
 */
export default function PayHubPage() {
  const t = useT();

  const options: ReadonlyArray<PayOption> = [
    { href: '/scan', icon: 'scan', label: t.screens.scan, body: t.routes.payHub.scanBody },
    { href: '/request/new', icon: 'request', label: t.screens.requestNew, body: t.routes.payHub.requestBody },
    { href: '/send', icon: 'send', label: t.screens.send, body: t.routes.payHub.sendBody },
  ];

  return (
    <>
      <ScreenHeader title={t.nav.pay} description={t.routes.payHub.description} />

      <ul className="flex flex-col gap-3">
        {options.map((option) => (
          <li key={option.href}>
            <Link
              href={option.href}
              className="flex min-h-[72px] items-center gap-4 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-[var(--text-primary)]">
                <Icon name={option.icon} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-semibold">{option.label}</span>
                <span className="text-sm text-[var(--text-secondary)]">{option.body}</span>
              </span>
              <Icon name="chevron" size={18} className="shrink-0 text-[var(--text-muted)]" />
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-5 px-1 text-sm leading-relaxed text-[var(--text-muted)]">{t.routes.payHub.swipeNote}</p>
    </>
  );
}
