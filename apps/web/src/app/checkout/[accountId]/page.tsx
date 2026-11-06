'use client';

import { useParams } from 'next/navigation';
import { ScreenHeader } from '@/components/primitives/Surface';
import { CheckoutView } from '@/components/merchant/CheckoutView';
import { useT } from '@/lib/i18n/provider';

/**
 * Merchant discovery page (UX_FLOWS screen 09, freeze section 5).
 * `slug === accountId`. Discovery only: it cannot charge, sign or create anything.
 */
export default function CheckoutPage() {
  const t = useT();
  const params = useParams<{ accountId: string }>();
  const accountId = typeof params.accountId === 'string' ? params.accountId : '';
  return (
    <>
      <ScreenHeader title={t.commerce.checkout.title} />
      <CheckoutView accountId={accountId} />
    </>
  );
}
