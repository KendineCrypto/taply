'use client';

import { ScreenHeader } from '@/components/primitives/Surface';
import { CreateRequest } from '@/components/payments/CreateRequest';
import { useT } from '@/lib/i18n/provider';

/** Amount-first Instant Pay request (docs/UX_ONE_TAP_REDESIGN.md). Protected Pay is not offered. */
export default function RequestNewPage() {
  const t = useT();
  return (
    <>
      <ScreenHeader title={t.oneTap.request.title} />
      <CreateRequest />
    </>
  );
}
