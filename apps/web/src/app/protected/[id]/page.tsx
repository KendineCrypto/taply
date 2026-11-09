'use client';

import { useParams } from 'next/navigation';
import { ScreenHeader } from '@/components/primitives/Surface';
import { ProtectedScreen } from '@/components/protected/ProtectedScreen';
import { useT } from '@/lib/i18n/provider';

/** Protected Pay (G3 candidate) request view. Off unless the build enables it. */
export default function ProtectedRequestPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  return (
    <>
      <ScreenHeader title={t.protectedFlow.title} />
      <ProtectedScreen id={id} />
    </>
  );
}
