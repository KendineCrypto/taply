'use client';

import { SaleRegister } from '@/components/merchant/MerchantScreens';

/** POS: one uniquely signed Instant request per sale, through the existing creation flow. */
export default function Page() {
  return <SaleRegister />;
}
