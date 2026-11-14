'use client';

import { ScanEntry } from '@/components/scan/ScanEntry';
import { merchantCheckoutPath } from '@/lib/merchant/discovery';

/** `/scan`: the Pay entry as a page (components/scan/ScanEntry, shared with NEAR Mainnet). */
export default function Page() {
  return <ScanEntry payPath={(id) => `/pay/${id}`} checkoutPath={merchantCheckoutPath} />;
}
