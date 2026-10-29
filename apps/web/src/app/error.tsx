'use client';

import { Card, ScreenHeader } from '@/components/primitives/Surface';
import { useT } from '@/lib/i18n/provider';

/**
 * Route error boundary.
 *
 * The reset affordance re-renders the view; it never re-submits anything. A
 * render failure must not become a second payment attempt.
 */
export default function RouteError({ reset }: { readonly error: Error; readonly reset: () => void }) {
  const t = useT();

  return (
    <>
      <ScreenHeader title={t.screens.errorBoundary} />
      <Card>
        <p className="text-sm text-[var(--text-secondary)]">{t.notices.unexpected.body}</p>
        <button
          type="button"
          onClick={reset}
          className="tap-target mt-3 inline-flex items-center rounded-[var(--radius-control)] border border-[var(--border-strong)] px-4 text-sm"
        >
          {t.common.retry}
        </button>
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          This only reloads the screen. It does not resubmit a transaction.
        </p>
      </Card>
    </>
  );
}
