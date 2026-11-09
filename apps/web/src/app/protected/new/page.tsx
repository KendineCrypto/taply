'use client';

import { ScreenHeader } from '@/components/primitives/Surface';
import { ProtectedCreate } from '@/components/protected/ProtectedCreate';
import { useT } from '@/lib/i18n/provider';

/** Protected Pay (G3 candidate) request creation. Off unless the build enables it. */
export default function ProtectedNewPage() {
  const t = useT();
  return (
    <>
      <ScreenHeader title={t.protectedFlow.newTitle} />
      <ProtectedCreate />
    </>
  );
}
