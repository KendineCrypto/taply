'use client';

import { useParams } from 'next/navigation';
import { ScreenHeader } from '@/components/primitives/Surface';
import { SessionEntry } from '@/components/handshake/SessionEntry';
import { useT } from '@/lib/i18n/provider';

/**
 * Handshake customer view (UX_FLOWS screens 10/11). Gated: the session service
 * and on-chain session binding are not ready, so this shows an honest
 * unavailable state. SSE/session data could never set a payment status anyway.
 */
export default function SessionPage() {
  const t = useT();
  const params = useParams<{ sessionId: string }>();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
  return (
    <>
      <ScreenHeader title={t.commerce.handshake.title} />
      <SessionEntry sessionId={sessionId} />
    </>
  );
}
