'use client';

import { useParams } from 'next/navigation';
import { ScreenHeader } from '@/components/primitives/Surface';
import { LiveCustomerSession } from '@/components/live/LiveSession';
import { PaymentScreen } from '@/components/payments/PaymentScreen';
import { useT } from '@/lib/i18n/provider';

/**
 * Live Handshake, customer side: `/s/<room>#j=<join token>` from the merchant's
 * QR. Joins the room once, then shows the normal payment screen for the room's
 * request (read from NEAR Testnet) with the merchant's live status above it.
 */
export default function SessionPage() {
  const t = useT();
  const params = useParams<{ sessionId: string }>();
  const roomId = typeof params.sessionId === 'string' ? params.sessionId : '';
  return (
    <>
      <ScreenHeader title={t.live.title} />
      <LiveCustomerSession roomId={roomId}>{(requestId) => <PaymentScreen id={requestId} />}</LiveCustomerSession>
    </>
  );
}
