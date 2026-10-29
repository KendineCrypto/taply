'use client';

import { useParams } from 'next/navigation';
import { Card, DetailRow, ScreenHeader } from '@/components/primitives/Surface';
import { RouteScaffold } from '@/components/shell/RouteScaffold';
import { useT } from '@/lib/i18n/provider';

/**
 * Handshake customer view (UX_FLOWS screens 10/11).
 *
 * Freeze sections 6 and 8: the session server is live coordination only. It
 * cannot settle, cannot prove merchant identity, and SSE events are hints to
 * refetch canonical chain state - never a source of status.
 */
export default function SessionPage() {
  const t = useT();
  const params = useParams<{ sessionId: string }>();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';

  return (
    <>
      <ScreenHeader title={t.screens.session} />

      <Card>
        <dl>
          <DetailRow label="Session ID">
            <span className="chain-id">{sessionId || t.common.notAvailable}</span>
          </DetailRow>
          <DetailRow label="State">{t.sessionState.DRAFT.label}</DetailRow>
        </dl>

        <p className="mt-3 text-xs text-[var(--text-muted)]">{t.handshake.notIdentityProof}</p>
      </Card>

      <div className="mt-4">
        <RouteScaffold
          title={t.screens.session}
          flag="handshake"
          plannedBehaviour={[
            'Consume the join token from the URL fragment, then strip it via history.replaceState.',
            'Both devices independently fetch canonical terms from the contract and derive the 6-character code.',
            'A code mismatch blocks the pay control outright.',
            'Presence drives joined / disconnected / rejoin; expiry never changes payment eligibility.',
            'If the session service is unavailable, degrade to the verified request at /pay/[id] - not to a failure.',
          ]}
          dependsOn={[
            'Codex session endpoints, SSE payload types and presence events.',
            'packages/shared comparison-code derivation plus fixture vectors A and B.',
            'Open question: the frozen sessionCommitment is terms-only, so identical terms yield an identical code across sessions.',
          ]}
        />
      </div>
    </>
  );
}
