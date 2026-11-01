'use client';

import Link from 'next/link';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { FLAGS } from '@/lib/flags/features';
import { useT } from '@/lib/i18n/provider';

/**
 * Home actions. Request and Send are the two things people do most, so they
 * are the two large buttons; Receive and Scan sit underneath.
 *
 * Request opens the real create flow even while signing is switched off: that
 * screen explains the gate itself, and everything before the wallet step works.
 * Send has no screen yet and says "Soon" until the Instant Pay flag is on.
 */
export function QuickActions() {
  const t = useT();
  const sendSoon = !FLAGS.instantPay.enabled;

  return (
    <nav aria-label={t.home.quickActionsLabel} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/request/new"
          className="pressable group flex min-h-[64px] items-center justify-center gap-2.5 rounded-[var(--radius-card)] bg-[var(--taply-lime)] px-4 text-base font-semibold text-[var(--taply-night)] shadow-[0_14px_30px_-14px_rgb(199_252_117/0.6)] hover:bg-[#d4fd92]"
        >
          <Icon name="request" size={20} />
          {t.home.request}
        </Link>
        <Link
          href="/send"
          aria-label={sendSoon ? `${t.home.send}, ${t.home.soon}` : t.home.send}
          className="pressable flex min-h-[64px] items-center justify-center gap-2.5 rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[rgb(244_243_232/0.04)] px-4 text-base font-semibold text-[var(--text-primary)] hover:border-[var(--text-secondary)]"
        >
          <Icon name="send" size={20} />
          <span aria-hidden="true">{t.home.send}</span>
          {sendSoon && (
            <span aria-hidden="true" className="eyebrow rounded-full bg-[var(--tone-neutral-bg)] px-1.5 py-1 text-[10px] text-[var(--text-muted)]">
              {t.home.soon}
            </span>
          )}
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SmallAction href="/receive" icon="receive" label={t.home.receive} />
        <SmallAction href="/scan" icon="scan" label={t.experience.home.scan} />
      </div>
    </nav>
  );
}

function SmallAction({ href, icon, label }: { readonly href: string; readonly icon: IconName; readonly label: string }) {
  return (
    <Link
      href={href as '/receive'}
      className="surface-card pressable flex min-h-[52px] items-center justify-center gap-2 px-3 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
    >
      <Icon name={icon} size={18} />
      {label}
    </Link>
  );
}
