'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ScreenHeader } from '@/components/primitives/Surface';
import { PayChoices, PayLinkForm } from '@/components/scan/PayEntry';
import { QrScanner } from '@/components/scan/QrScanner';
import { useT } from '@/lib/i18n/provider';
import { merchantCheckoutPath } from '@/lib/merchant/discovery';

/**
 * `/scan`: the Pay entry as a page (the Tap sheet offers the same two choices).
 * Visiting it does not open the camera; only choosing "Scan QR" does.
 */
export default function Page() {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<'choose' | 'link'>('choose');
  const [scanning, setScanning] = useState(false);
  const open = (id: string) => router.push(`/pay/${id}`);
  // A merchant discovery link only opens the read-only checkout page.
  const openMerchant = (accountId: string) => router.push(merchantCheckoutPath(accountId));

  return (
    <>
      <ScreenHeader title={t.oneTap.payEntry.title} description={t.oneTap.payEntry.body} />
      {mode === 'choose' ? (
        <PayChoices onLink={() => setMode('link')} onScan={() => setScanning(true)} />
      ) : (
        <PayLinkForm onBack={() => setMode('choose')} onOpen={open} onMerchant={openMerchant} />
      )}
      {scanning && (
        <QrScanner
          onClose={() => setScanning(false)}
          onRequest={(id) => {
            setScanning(false);
            open(id);
          }}
          onMerchant={(accountId) => {
            setScanning(false);
            openMerchant(accountId);
          }}
          onPasteLink={() => {
            setScanning(false);
            setMode('link');
          }}
        />
      )}
    </>
  );
}
