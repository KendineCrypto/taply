'use client';

import { useParams } from 'next/navigation';
import { ScreenHeader } from '@/components/primitives/Surface';
import { ReceiptScreen } from '@/components/payments/ReceiptScreen';
import { useT } from '@/lib/i18n/provider';

/** Contract terminal facts for a paid or cancelled request (UX_FLOWS screen 17). */
export default function ReceiptPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  return (
    <>
      <ScreenHeader title={t.screens.receipt} />
      <ReceiptScreen id={id} />
    </>
  );
}
