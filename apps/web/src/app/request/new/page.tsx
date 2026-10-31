'use client';

import { ScreenHeader } from '@/components/primitives/Surface';
import { CreateRequest } from '@/components/payments/CreateRequest';
import { useT } from '@/lib/i18n/provider';

/** Create an Instant Pay request (UX_FLOWS screen 06). Protected Pay is not offered. */
export default function RequestNewPage() {
  const t = useT();
  return (
    <>
      <ScreenHeader title={t.screens.requestNew} description={t.routes.requestNew} />
      <CreateRequest />
    </>
  );
}
