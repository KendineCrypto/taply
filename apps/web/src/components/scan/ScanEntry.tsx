'use client';

import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { useState } from 'react';
import { ScreenHeader } from '@/components/primitives/Surface';
import { PayChoices, PayLinkForm } from '@/components/scan/PayEntry';
import { QrScanner } from '@/components/scan/QrScanner';
import { useT } from '@/lib/i18n/provider';
import type { ScanInput } from '@/lib/payments/pay-link';

/**
 * The Pay entry as a page (the Tap sheet offers the same two choices), shared by the
 * Testnet `/scan` and NEAR Mainnet `/m/scan` routes. Visiting it does not open the
 * camera; only choosing "Scan QR" does. Each build passes its routes and parser.
 */
export function ScanEntry({ payPath, checkoutPath, parse }: {
  readonly payPath: (id: string) => string;
  readonly checkoutPath: (accountId: string) => string;
  readonly parse?: (text: string) => ScanInput;
}) {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<'choose' | 'link'>('choose');
  const [scanning, setScanning] = useState(false);
  const open = (id: string) => router.push(payPath(id) as Route);
  // A merchant discovery link only opens the read-only checkout page.
  const openMerchant = (accountId: string) => router.push(checkoutPath(accountId) as Route);
  const parser = parse ? { parse } : {};

  return (
    <>
      <ScreenHeader title={t.oneTap.payEntry.title} description={t.oneTap.payEntry.body} />
      {mode === 'choose' ? (
        <PayChoices onLink={() => setMode('link')} onScan={() => setScanning(true)} />
      ) : (
        <PayLinkForm {...parser} onBack={() => setMode('choose')} onOpen={open} onMerchant={openMerchant} />
      )}
      {scanning && (
        <QrScanner
          {...parser}
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
