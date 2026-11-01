'use client';

import Link from 'next/link';
import { Icon } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';

/** Invitation to the /demo product tour. Clearly a demo; no data on it is real. */
export function TourCard() {
  const t = useT();
  return (
    <Link
      href="/demo"
      className="paper pressable group relative flex items-center gap-4 overflow-hidden p-4 pr-5 text-[var(--ink)]"
    >
      <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--ink)] text-[var(--taply-lime)]">
        <Icon name="shield" size={24} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="eyebrow block text-[var(--ink-muted)]">{t.experience.home.tourEyebrow}</span>
        <span className="mt-1 block text-[1.0625rem] font-semibold leading-snug tracking-tight">{t.experience.home.tourTitle}</span>
        <span className="mt-0.5 block text-sm leading-snug text-[var(--ink-secondary)]">{t.experience.home.tourBody}</span>
      </span>
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--ink)] text-[var(--paper)] transition-transform group-hover:translate-x-0.5">
        <Icon name="arrow-right" size={18} />
      </span>
      <span className="sr-only">{t.experience.home.tourCta}</span>
    </Link>
  );
}
