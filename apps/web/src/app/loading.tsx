'use client';

import { useT } from '@/lib/i18n/provider';

/**
 * Route loading state (UX_FLOWS screen 00).
 *
 * Skeletons only - never a placeholder amount or status, which could be
 * misread as real data mid-load.
 */
export default function Loading() {
  const t = useT();
  return (
    <div className="flex flex-col gap-3 pt-4" role="status" aria-busy="true">
      <span className="sr-only">{t.common.loading}</span>
      <div className="h-6 w-32 rounded bg-[var(--tone-neutral-bg)]" />
      <div className="h-24 rounded-[var(--radius-card)] bg-[var(--tone-neutral-bg)]" />
      <div className="h-24 rounded-[var(--radius-card)] bg-[var(--tone-neutral-bg)]" />
    </div>
  );
}
