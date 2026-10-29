'use client';

import type { ReactNode } from 'react';
import { ScreenHeader } from '@/components/primitives/Surface';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { FLAGS } from '@/lib/flags/features';
import type { FeatureFlag } from '@/lib/flags/features';
import { useT } from '@/lib/i18n/provider';

/**
 * Honest placeholder for a screen whose capability is not live yet.
 *
 * Replaces the earlier developer scaffold ("Planned behaviour" / "Blocked on"
 * lists): those technical details now live in /demo diagnostics. This shows a
 * person, in their language, what the screen will do and that it is not
 * available yet. It renders no amounts, accounts or statuses, so nothing here
 * can be mistaken for a working payment.
 */
export function ComingSoon({
  title,
  summary,
  flag,
  icon = 'pay',
  children,
}: {
  readonly title: string;
  readonly summary: string;
  readonly flag?: FeatureFlag;
  readonly icon?: IconName;
  /** Extra factual context shown above the panel (e.g. an ID from the URL). */
  readonly children?: ReactNode;
}) {
  const t = useT();
  const state = flag === undefined ? null : FLAGS[flag];
  const reason =
    state === null || state.reason === 'not_implemented' || state.reason === 'disabled_by_config'
      ? t.routes.comingSoon
      : t.routes.afterVerification;

  return (
    <>
      <ScreenHeader title={title} />
      {children}
      <section
        aria-label={reason}
        className="mt-4 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-5 py-8 text-center"
      >
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[var(--surface-2)] text-[var(--text-secondary)]">
          <Icon name={icon} size={26} />
        </span>
        <p className="mx-auto mt-4 max-w-xs text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">
          {summary}
        </p>
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] px-3 py-1 text-xs font-medium text-[var(--tone-caution-fg)]">
          {reason}
        </p>
        <p className="mt-4 text-xs text-[var(--text-muted)]">{t.app.demoFundsNote}</p>
      </section>
    </>
  );
}
