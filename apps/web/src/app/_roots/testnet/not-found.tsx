'use client';

import Link from 'next/link';
import { Card, ScreenHeader } from '@/components/primitives/Surface';
import { useT } from '@/lib/i18n/provider';

export default function NotFound() {
  const t = useT();
  return (
    <>
      <ScreenHeader title={t.screens.notFound} />
      <Card>
        <p className="text-sm text-[var(--text-secondary)]">
          {t.system.notFoundBody}
        </p>
        <Link href="/" className="mt-3 inline-flex text-[var(--taply-lime)] underline">
          {t.system.goHome}
        </Link>
      </Card>
    </>
  );
}
