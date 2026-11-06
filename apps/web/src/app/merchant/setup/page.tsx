'use client';

import { MerchantSetup } from '@/components/merchant/MerchantScreens';

/** Permanent merchant discovery QR. Discovery only: it is never a payable invoice. */
export default function Page() {
  return <MerchantSetup />;
}
