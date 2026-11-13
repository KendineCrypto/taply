'use client';

import { Card, ScreenHeader } from '@/components/primitives/Surface';

/** Mainnet route error boundary. Reset only re-renders; it never re-submits anything. */
export default function RouteError({ reset }: { readonly error: Error; readonly reset: () => void }) {
  return (
    <>
      <ScreenHeader title="Something went wrong / Bir şeyler ters gitti" />
      <Card>
        <p className="text-sm text-[var(--text-secondary)]">
          Nothing was signed or sent. Reloading only redraws the screen. / Hiçbir şey imzalanmadı veya gönderilmedi. Yeniden yüklemek yalnızca ekranı yeniler.
        </p>
        <button type="button" onClick={reset} className="tap-target mt-3 inline-flex items-center rounded-[var(--radius-control)] border border-[var(--border-strong)] px-4 text-sm">
          Reload view / Ekranı yenile
        </button>
      </Card>
    </>
  );
}
