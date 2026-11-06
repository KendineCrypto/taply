'use client';

import { useParams } from 'next/navigation';
import { ScreenHeader } from '@/components/primitives/Surface';
import { PaymentScreen } from '@/components/payments/PaymentScreen';
import { useT } from '@/lib/i18n/provider';

/**
 * The canonical, role-aware intent view (UX_FLOWS screens 07, 08, 12-17).
 * One route renders every role and every ChainState, so there is a single
 * status code path, fed only by finalized contract reads.
 */
export default function PayIntentPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  return (
    <>
      <ScreenHeader title={t.screens.pay} />
      <PaymentScreen id={id} />
    </>
  );
}
