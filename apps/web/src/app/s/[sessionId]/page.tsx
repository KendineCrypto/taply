'use client';

import { useParams } from 'next/navigation';
import { Card, DetailRow } from '@/components/primitives/Surface';
import { ComingSoon } from '@/components/shell/ComingSoon';
import { useT } from '@/lib/i18n/provider';

/**
 * Handshake customer view (UX_FLOWS screens 10/11).
 *
 * Freeze sections 6 and 8: the session server is live coordination only. It
 * cannot settle or prove merchant identity, and SSE events are hints to refetch
 * canonical chain state - never a source of status.
 */
export default function SessionPage() {
  const t = useT();
  const params = useParams<{ sessionId: string }>();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';

  return (
    <ComingSoon title={t.screens.session} summary={t.routes.session} flag="handshake" icon="scan">
      <Card>
        <dl>
          <DetailRow label={t.routes.sessionIdLabel}>
            <span className="chain-id">{sessionId || t.common.notAvailable}</span>
          </DetailRow>
          <DetailRow label={t.routes.stateLabel}>{t.sessionState.DRAFT.label}</DetailRow>
        </dl>
        <p className="mt-3 text-xs text-[var(--text-muted)]">{t.handshake.notIdentityProof}</p>
      </Card>
    </ComingSoon>
  );
}
