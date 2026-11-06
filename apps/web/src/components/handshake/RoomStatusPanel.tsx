'use client';

import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Icon } from '@/components/shell/Icons';
import { groupCode } from '@/lib/merchant/journey';
import type { RoomView } from '@/lib/handshake/room';
import { useT } from '@/lib/i18n/provider';

/**
 * Phase 7G: one phone's view of a Handshake room, rendered ONLY from
 * `presentRoom` (lib/handshake/room.ts). Production-shaped but not mounted in
 * any live route: Handshake is gated off and no reviewed adapter exists.
 *
 * Layout rule: the room (coordination) and the chain (payment) are separate
 * rows. The chain row is the only place payment status appears, and it comes
 * from this device's own chain read. Merchant identity always reads "not
 * verified".
 */
export function RoomStatusPanel({ view, label }: { readonly view: RoomView; readonly label: string }) {
  const t = useT();
  const r = t.commerce.phase7g.room;

  if (view.kind === 'unavailable') {
    return (
      <section aria-label={label} className="flex flex-col gap-2" data-testid="room-panel" data-room="unavailable" data-reason={view.reason}>
        <p className="eyebrow text-[var(--text-muted)]">{label}</p>
        <InlineNotice copy={r.unavailable[view.reason]} tone="neutral" />
      </section>
    );
  }

  const phase = r.phase[view.phase];
  const danger = view.phase === 'mismatch' || view.phase === 'outcome_unknown';
  const connectionTone =
    view.connection === 'interrupted' ? 'text-[var(--tone-caution-fg)]' : view.connection === 'not_joined' ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]';

  return (
    <section
      aria-label={label}
      className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4"
      data-testid="room-panel"
      data-room={view.phase}
      data-connection={view.connection}
    >
      <p className="eyebrow text-[var(--text-muted)]">{label}</p>

      <div role="status" aria-live={danger ? 'assertive' : 'polite'}>
        <h3 className={`text-base font-semibold ${danger ? 'text-[var(--tone-caution-fg)]' : ''}`}>{phase.title}</h3>
        <p className="mt-0.5 text-sm leading-relaxed text-[var(--text-secondary)]">{phase.body}</p>
      </div>

      <p className={`flex items-center gap-2 text-sm ${connectionTone}`} data-testid="room-connection">
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${
            view.connection === 'interrupted' ? 'bg-[var(--taply-gold)]' : view.connection === 'not_joined' ? 'bg-[var(--text-muted)]' : 'bg-[var(--text-primary)]'
          }`}
        />
        {r.connection[view.connection]}
      </p>

      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-[var(--text-muted)]">{r.code.label}</dt>
          <dd className="flex items-center gap-2 text-right">
            {view.code !== null && (
              <span className="font-mono font-semibold tracking-[0.12em]" aria-label={view.code.split('').join(' ')}>
                {groupCode(view.code)}
              </span>
            )}
            <span
              className={`text-xs font-semibold ${view.codeMatch === 'mismatch' ? 'text-[var(--tone-caution-fg)]' : 'text-[var(--text-secondary)]'}`}
              data-testid="room-code-match"
            >
              {r.code[view.codeMatch]}
            </span>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-[var(--text-muted)]">{r.reviews.merchant}</dt>
          <dd>{view.reviews.merchant ? r.reviews.done : r.reviews.notYet}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-[var(--text-muted)]">{r.reviews.payer}</dt>
          <dd>{view.reviews.payer ? r.reviews.done : r.reviews.notYet}</dd>
        </div>
        {view.walletAdvisory !== null && (
          <div className="flex flex-col gap-0.5" data-testid="room-wallet">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--text-muted)]">{r.wallet.label}</dt>
              <dd>{r.wallet[view.walletAdvisory]}</dd>
            </div>
            <p className="text-xs text-[var(--text-muted)]">{r.wallet.note}</p>
          </div>
        )}
      </dl>

      {/* The chain row: the only payment status on this panel, from this device's own read. */}
      <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3 text-sm" data-testid="room-chain" data-chain={view.chain}>
        <span className="flex items-center gap-2 text-[var(--text-muted)]">
          <Icon name="shield" size={16} />
          {r.chain.label}
        </span>
        <span className="font-semibold">{r.chain[view.chain]}</span>
      </div>

      <p className="text-xs leading-relaxed text-[var(--text-muted)]" data-testid="room-identity">
        {r.merchantIdentity}
      </p>
    </section>
  );
}
