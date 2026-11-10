'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { fill } from '@/lib/i18n';
import { useT } from '@/lib/i18n/provider';
import { liveApi, LiveError, liveStore, randomToken, useLiveAvailable, useLiveSync } from '@/lib/live-session/client';
// The same short code both phones derive from the on-chain request ID.
import { groupCode, saleCode } from '@/lib/merchant/journey';
import type { LiveErrorCode, LiveSnapshot, MerchantRoom } from '@/lib/live-session/client';

/**
 * Live Handshake screens. The room says who is connected and what they are
 * doing; it never says "paid". Both phones read the request and its payment
 * status from NEAR Testnet themselves (PaymentScreen).
 */

/** How long the merchant QR waits for the live room before showing the plain pay link. */
export const LIVE_QR_WAIT_MS = 5_000;

function useNow(ms = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function serverNow(snapshot: LiveSnapshot, receivedAt: number, now: number) {
  return snapshot.serverTimeMs + Math.max(0, now - receivedAt);
}
function formatLeft(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function PresenceRow({ label, online, detail, lastSeenAgoS }: { readonly label: string; readonly online: boolean; readonly detail: ReactNode; readonly lastSeenAgoS: number | null }) {
  const t = useT();
  return (
    <div className="flex items-start justify-between gap-3 py-2" data-presence={online ? 'online' : 'offline'}>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${online ? 'bg-[var(--taply-lime)]' : 'bg-[var(--text-muted)]'}`} />
        <span className="font-semibold">{label}</span>
      </div>
      <span className="text-right text-sm text-[var(--text-secondary)]">
        {online ? detail : lastSeenAgoS === null ? detail : fill(t.live.offline, { seconds: String(lastSeenAgoS) })}
      </span>
    </div>
  );
}

const EVENT_COPY = (t: ReturnType<typeof useT>): Record<string, string> => ({
  created: t.live.evCreated,
  customer_joined: t.live.evCustomerJoined,
  customer_rejoined: t.live.evCustomerRejoined,
  merchant_rejoined: t.live.evMerchantRejoined,
  customer_reviewing: t.live.evCustomerReviewing,
  customer_paying: t.live.evCustomerPaying,
  closed: t.live.evClosed,
});

/** Shared live card: presence of both sides, sale code, expiry and recent events. */
function LiveCard({ snapshot, receivedAt, code, footer }: { readonly snapshot: LiveSnapshot; readonly receivedAt: number; readonly code: string; readonly footer?: ReactNode }) {
  const t = useT();
  const now = useNow();
  const at = serverNow(snapshot, receivedAt, now);
  const ago = (seen: number | null) => (seen === null ? null : Math.max(0, Math.floor((at - seen) / 1000)));
  const c = snapshot.customer;
  const customerDetail = !c.joined ? t.live.waiting : c.state === 'paying' ? t.live.paying : c.state === 'reviewing' ? t.live.reviewing : t.live.joined;
  const events = EVENT_COPY(t);
  return (
    <section className="surface-card flex flex-col gap-2 p-4" aria-labelledby="live-title" data-testid="live-card">
      <div className="flex items-center justify-between gap-2">
        <h2 id="live-title" className="flex items-center gap-2 font-semibold">
          <span aria-hidden="true" className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--taply-lime)] opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2.5 rounded-full bg-[var(--taply-lime)]" />
          </span>
          {t.live.title}
        </h2>
        {!snapshot.expired && !snapshot.closed && (
          <span className="text-xs text-[var(--text-muted)]">{fill(t.live.expiresIn, { time: formatLeft(snapshot.expiresAtMs - at) })}</span>
        )}
      </div>
      <div aria-live="polite" className="divide-y divide-[var(--border-subtle)]">
        <PresenceRow label={t.live.merchant} online={snapshot.merchant.online && !snapshot.closed} detail={t.live.online} lastSeenAgoS={ago(snapshot.merchant.lastSeenMs)} />
        <PresenceRow label={t.live.customer} online={c.joined && c.online} detail={customerDetail} lastSeenAgoS={c.joined ? ago(c.lastSeenMs) : null} />
      </div>
      <p className="text-sm">{fill(t.live.compare, { code: code === '' ? '' : groupCode(code) })}</p>
      {snapshot.closed && <p role="status" className="text-sm text-[var(--tone-caution-fg)]">{t.live.closed}</p>}
      {snapshot.expired && !snapshot.closed && <p role="status" className="text-sm text-[var(--tone-caution-fg)]">{t.live.expired}</p>}
      {snapshot.events.length > 0 && (
        <ol className="flex flex-col gap-0.5 text-xs text-[var(--text-muted)]" aria-label={t.live.title}>
          {snapshot.events.slice(-4).map((e) => (
            <li key={e.seq}>
              {new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }).format(new Date(e.atMs))} · {events[e.type] ?? e.type}
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-[var(--text-muted)]">{t.live.authority}</p>
      {footer}
    </section>
  );
}

/**
 * Merchant side, for one OPEN request. Starts (or resumes) a room and returns
 * the customer link for the QR, plus the live card.
 */
export function useMerchantLiveSession(requestId: string | null) {
  const available = useLiveAvailable();
  const [room, setRoom] = useState<MerchantRoom | null>(null);
  const [failed, setFailed] = useState<LiveErrorCode | null>(null);
  const [attempt, setAttempt] = useState(0);
  const enabled = available === true && requestId !== null;
  useEffect(() => {
    if (!enabled || requestId === null) return;
    let alive = true;
    const stored = liveStore.merchant(requestId);
    if (stored !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resume this device's room
      setRoom(stored);
      return;
    }
    void liveApi.create(requestId).then(
      (created) => {
        if (!alive) return;
        liveStore.saveMerchant(created, requestId);
        setRoom(created);
        setFailed(null);
      },
      (e: unknown) => {
        if (alive) setFailed(e instanceof LiveError ? e.code : 'UNAVAILABLE');
      },
    );
    return () => {
      alive = false;
    };
  }, [enabled, requestId, attempt]);
  // The QR is drawn once: wait (briefly) for the room, then show either the live
  // link or the plain pay link, and never swap it under a customer's camera.
  const [plainFor, setPlainFor] = useState<string | null>(null);
  const liveImpossible = available === false || (failed !== null && room === null);
  useEffect(() => {
    if (requestId === null || room !== null) return;
    if (liveImpossible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lock the QR to the plain link
      setPlainFor(requestId);
      return;
    }
    const id = setTimeout(() => setPlainFor(requestId), LIVE_QR_WAIT_MS);
    return () => clearTimeout(id);
  }, [requestId, room, liveImpossible]);
  const qr: 'pending' | 'live' | 'plain' =
    requestId === null || plainFor === requestId || liveImpossible ? 'plain' : room !== null ? 'live' : 'pending';
  const sync = useLiveSync(enabled && room !== null ? { roomId: room.roomId, role: 'merchant', token: room.merchantToken } : null);
  // A room that vanished (expired keys) or was replaced: start a fresh one once.
  useEffect(() => {
    const code = sync.error?.code;
    if (requestId === null || (code !== 'NOT_FOUND' && code !== 'FORBIDDEN')) return;
    liveStore.saveMerchant(null, requestId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recover from a lost room
    setRoom(null);
    setAttempt((a) => a + 1);
  }, [sync.error, requestId]);
  return {
    active: enabled,
    /** Which link the QR shows: 'pending' (preparing), 'live' (`/s/…`) or 'plain' (`/pay/…`). */
    qr,
    room,
    failed,
    snapshot: sync.snapshot,
    receivedAt: sync.receivedAt,
    linkFor: (origin: string) => (room === null ? null : `${origin}/s/${room.roomId}#j=${room.joinToken}`),
    path: room === null ? null : `/s/${room.roomId}#j=${room.joinToken}`,
    retry: () => {
      // An explicit restart may switch the QR to the new live link.
      setPlainFor(null);
      setAttempt((a) => a + 1);
    },
    async end() {
      if (room === null || requestId === null) return;
      await liveApi.close(room.roomId, room.merchantToken).catch(() => undefined);
    },
  };
}
export type MerchantLiveSession = ReturnType<typeof useMerchantLiveSession>;

export function LiveMerchantPanel({ session, code }: { readonly session: MerchantLiveSession; readonly code: string | null }) {
  const t = useT();
  if (!session.active) return null;
  if (session.failed !== null && session.room === null) {
    return (
      <section className="surface-card flex flex-col gap-2 p-4" data-testid="live-card">
        <p className="text-sm text-[var(--text-secondary)]">{t.live.unavailable}</p>
        <Button variant="secondary" onClick={session.retry}>
          <Icon name="refresh" size={16} />
          {t.live.restart}
        </Button>
      </section>
    );
  }
  if (session.snapshot === null) {
    return (
      <p role="status" className="flex items-center gap-2 px-1 text-sm text-[var(--text-secondary)]" data-testid="live-card">
        <Spinner /> {t.live.starting}
      </p>
    );
  }
  return (
    <div data-live-path={session.path ?? undefined}>
      <LiveCard
        snapshot={session.snapshot}
        receivedAt={session.receivedAt}
        code={code ?? ''}
        footer={
          !session.snapshot.closed && !session.snapshot.expired ? (
            <Button variant="ghost" onClick={() => void session.end()}>
              {t.live.end}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

/** Customer side of `/s/<room>#j=<token>`: join once, then announce and render the payment. */
export function LiveCustomerSession({ roomId, children }: { readonly roomId: string; readonly children: (requestId: string) => ReactNode }) {
  const t = useT();
  const [participant, setParticipant] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ code: LiveErrorCode; requestId?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const joinToken = hash.get('j');
    const stored = liveStore.participant(roomId);
    const token = stored ?? randomToken();
    liveStore.saveParticipant(roomId, token);
    const done = (id: string) => {
      if (!alive) return;
      // Keep the join secret out of history, bookmarks and screenshots of the URL.
      if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
      setParticipant(token);
      setRequestId(id);
    };
    const fail = (e: unknown) => {
      if (!alive) return;
      setFailure(e instanceof LiveError ? { code: e.code, ...(e.requestId ? { requestId: e.requestId } : {}) } : { code: 'UNAVAILABLE' });
    };
    if (joinToken !== null) void liveApi.join(roomId, joinToken, token).then((r) => done(r.requestId), fail);
    else if (stored !== null) void liveApi.sync(roomId, 'customer', stored).then((s) => done(s.requestId), fail);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- no token: nothing to join
    else setFailure({ code: 'NOT_FOUND' });
    return () => {
      alive = false;
    };
  }, [roomId]);
  const sync = useLiveSync(participant !== null && requestId !== null ? { roomId, role: 'customer', token: participant, state: 'reviewing' } : null);

  if (failure !== null) {
    const message = failure.code === 'ALREADY_JOINED' ? t.live.alreadyJoined : failure.code === 'EXPIRED' ? t.live.expired
      : failure.code === 'CLOSED' ? t.live.closed : failure.code === 'UNAVAILABLE' ? t.live.unavailable : t.live.notFound;
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="surface-card p-4 text-sm text-[var(--text-secondary)]" data-testid="live-failure" data-code={failure.code}>
          {message}
        </p>
        {failure.requestId !== undefined && children(failure.requestId)}
      </div>
    );
  }
  if (requestId === null) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <Spinner /> {t.live.joining}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {sync.snapshot !== null && <LiveCard snapshot={sync.snapshot} receivedAt={sync.receivedAt} code={saleCode(sync.snapshot.requestId) ?? ''} />}
      {children(requestId)}
    </div>
  );
}
