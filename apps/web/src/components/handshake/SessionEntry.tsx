'use client';

import { InlineNotice } from '@/components/feedback/InlineNotice';
import { ButtonLink } from '@/components/primitives/Button';
import { DetailRow } from '@/components/primitives/Surface';
import { Icon } from '@/components/shell/Icons';
import { FLAGS } from '@/lib/flags/features';
import { resolveHandshakeAdapter } from '@/lib/handshake/adapter';
import type { HandshakeAdapter } from '@/lib/handshake/adapter';
import { useT } from '@/lib/i18n/provider';
import { SessionIdSchema } from '@/lib/protocol';

/**
 * Customer entry for a Handshake session link (`/s/<sessionId>`).
 *
 * This build has no session service and the contract cannot bind a session,
 * so the honest outcome is always "not available yet": no pairing, no code,
 * no terms and no payment. The customer is pointed to the normal, verified
 * way to pay a sale (scan or paste its request link).
 */
export function SessionEntry({ sessionId, adapter }: { readonly sessionId: string; readonly adapter?: HandshakeAdapter }) {
  const t = useT();
  const h = t.commerce.handshake;
  const valid = SessionIdSchema.safeParse(sessionId).success;
  const handshake = adapter ?? resolveHandshakeAdapter(FLAGS);

  if (!valid) {
    return (
      <div className="flex flex-col gap-4">
        <InlineNotice copy={h.invalidSession} tone="danger" live="assertive" />
        <ButtonLink href="/scan" variant="secondary" block>
          {t.commerce.checkout.scanSale}
        </ButtonLink>
      </div>
    );
  }

  // A live implementation would render the paired view here. Until a reviewed
  // backend adapter exists, every build lands in the unavailable state.
  const reason = handshake.availability.kind === 'unavailable' ? handshake.availability.reason : 'backend_not_connected';

  return (
    <div className="flex flex-col gap-5" data-testid="handshake-unavailable" data-reason={reason}>
      <section className="rounded-[var(--radius-hero)] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-5 py-6 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[var(--surface-2)] text-[var(--text-secondary)] ring-1 ring-[var(--border-subtle)]">
          <Icon name="link" size={26} />
        </span>
        <h2 className="mt-4 text-lg font-semibold">{h.unavailable.title}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[var(--text-secondary)]">{h.unavailable.body}</p>
        <dl className="mx-auto mt-4 max-w-sm text-left">
          <DetailRow label={h.sessionLabel}>
            <span className="chain-id break-all text-xs">{sessionId}</span>
          </DetailRow>
        </dl>
      </section>

      <div className="flex flex-col gap-1">
        <ButtonLink href="/scan" variant="primary" size="lg" block>
          <Icon name="scan" size={20} />
          {t.commerce.checkout.scanSale}
        </ButtonLink>
        <ButtonLink href="/demo/handshake" variant="ghost" block>
          {t.commerce.demo.openDemo}
        </ButtonLink>
      </div>

      <p className="px-1 text-xs leading-relaxed text-[var(--text-muted)]">{h.identityNote}</p>
      <p className="px-1 text-xs leading-relaxed text-[var(--text-muted)]">
        <span className="font-semibold text-[var(--text-secondary)]">{h.pendingTitle}:</span> {h.pendingApis}
      </p>
    </div>
  );
}
