'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Surface';
import { QrCode } from '@/components/payments/QrCode';
import { groupCode, saleCode } from '@/lib/merchant/journey';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { fill, useMainnetLocale } from '@/lib/mainnet/copy';
import { liveEn, liveTr } from '@/lib/mainnet/live-copy';
import type { LiveCopy } from '@/lib/mainnet/live-copy';
import { joinTokenFromHash, LiveError, liveApi, liveStore, randomToken, useLiveAvailable, useLiveSync } from '@/lib/mainnet/live';
import type { LiveErrorCode, LivePresenceState, LiveSnapshot, MerchantRoom } from '@/lib/mainnet/live';
import { Notice } from './bits';
import { useMainnetWallet } from '@/lib/mainnet/wallet';
import { TrackRequestButton } from './Activity';
import { PayRequest } from './PayRequest';

export function useLiveCopy(): LiveCopy {
  return useMainnetLocale().locale === 'tr' ? liveTr : liveEn;
}

function errorText(c: LiveCopy, code: LiveErrorCode): string {
  switch (code) {
    case 'REQUEST_NOT_OPEN': return c.notOpen;
    case 'NOT_FOUND': return c.notFound;
    case 'EXPIRED': return c.expired;
    case 'CLOSED': return c.closed;
    case 'ALREADY_JOINED': return c.alreadyJoined;
    case 'RATE_LIMITED': return c.rateLimited;
    default: return c.failed;
  }
}

function useClock(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function CodeBlock({ requestId, c }: { requestId: string; c: LiveCopy }) {
  const code = saleCode(requestId);
  if (code === null) return null;
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--border-subtle)] p-3 text-center">
      <p className="text-[12px] text-[var(--text-secondary)]">{c.code}</p>
      <p data-testid="live-code" className="mt-1 font-mono text-[1.75rem] font-semibold tracking-[0.2em]">{groupCode(code)}</p>
      <p className="text-[12px] text-[var(--text-muted)]">{c.codeHelp}</p>
    </div>
  );
}

function presenceText(c: LiveCopy, state: LivePresenceState | null): string {
  return state === 'paying' ? c.paying : state === 'reviewing' ? c.reviewing : c.viewing;
}

function shareOrigin(): string {
  return (MAINNET_CONFIG.ok ? MAINNET_CONFIG.shareOrigin : null) ?? window.location.origin;
}

/** Merchant side, shown on the pay screen of an OPEN request. */
export function LiveMerchantCard({ requestId }: { readonly requestId: string }) {
  const c = useLiveCopy();
  const available = useLiveAvailable();
  const [room, setRoom] = useState<MerchantRoom | null>(null);
  const [error, setError] = useState<LiveErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useClock(1000);
  useEffect(() => {
    queueMicrotask(() => setRoom(liveStore.merchant(requestId)));
  }, [requestId]);
  const sync = useLiveSync(room === null ? null : { roomId: room.roomId, role: 'merchant', token: room.merchantToken });
  const snap = sync.snapshot;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const created = await liveApi.create(requestId);
      liveStore.saveMerchant(requestId, created);
      setRoom(created);
    } catch (e) {
      setError(e instanceof LiveError ? e.code : 'UNAVAILABLE');
    } finally {
      setBusy(false);
    }
  }
  async function end() {
    if (room === null) return;
    await liveApi.close(room.roomId, room.merchantToken).catch(() => undefined);
    liveStore.saveMerchant(requestId, null);
    setRoom(null);
  }

  if (available === false) return <Card><h2 className="font-semibold">{c.title}</h2><p className="mt-1 text-[13px] text-[var(--text-secondary)]">{c.unavailable}</p></Card>;
  const link = room === null ? null : `${shareOrigin()}/m/s/${room.roomId}#j=${room.joinToken}`;
  const ended = snap !== null && (snap.closed || snap.expired);
  return (
    <Card>
      <div data-testid="live-merchant" className="flex flex-col gap-3">
        <h2 className="font-semibold">{c.title}</h2>
        <p className="text-[13px] text-[var(--text-secondary)]">{c.merchantLead}</p>
        {room === null || ended ? (
          <>
            {ended && <Notice tone="muted">{snap.closed ? c.closed : c.expired}</Notice>}
            <Button data-testid="live-start" onClick={() => void start()} disabled={busy || available === null}>{busy ? c.starting : c.start}</Button>
          </>
        ) : (
          <>
            <div className="flex justify-center"><QrCode value={link!} label={c.link} /></div>
            <p data-testid="live-link" className="break-all font-mono text-[11px] text-[var(--text-muted)]">{link}</p>
            <CodeBlock requestId={requestId} c={c} />
            <Notice tone={snap?.customer.joined ? 'success' : 'muted'} live testId="live-customer">
              <span className="font-semibold">{c.customer}: </span>
              {snap?.customer.joined
                ? `${c.joined} · ${snap.customer.online ? c.online : c.offline} · ${presenceText(c, snap.customer.state)}`
                : c.notJoined}
            </Notice>
            <p className="text-[12px] text-[var(--text-muted)]">{fill(c.expiresIn, { time: mmss(room.expiresAtMs - now) })} · {c.hint}</p>
            <Button variant="ghost" onClick={() => void end()}>{c.close}</Button>
          </>
        )}
        {(error !== null || sync.error !== null) && <Notice tone="danger" live testId="live-error">{errorText(c, error ?? sync.error!.code)}</Notice>}
      </div>
    </Card>
  );
}

/** Customer side: `/m/s/<room>#j=<join token>` from the merchant's QR. */
export function LiveCustomer({ roomId }: { readonly roomId: string }) {
  const c = useLiveCopy();
  const [joined, setJoined] = useState<{ requestId: string; token: string } | null>(null);
  const [error, setError] = useState<LiveErrorCode | null>(null);
  const [state, setState] = useState<LivePresenceState>('viewing');
  useEffect(() => {
    let live = true;
    const known = liveStore.participant(roomId);
    const token = known ?? randomToken();
    const fromLink = joinTokenFromHash(window.location.hash);
    // Drop the join secret from the address bar once read; keep it only in this browser for rejoin.
    if (fromLink !== null) {
      history.replaceState(null, '', window.location.pathname);
      liveStore.saveJoinToken(roomId, fromLink);
    }
    const joinToken = fromLink ?? liveStore.joinToken(roomId);
    if (joinToken === null) {
      queueMicrotask(() => live && setError('FORBIDDEN'));
      return () => { live = false; };
    }
    liveStore.saveParticipant(roomId, token);
    liveApi
      .join(roomId, joinToken, token)
      .then((r) => live && setJoined({ requestId: r.requestId, token }))
      .catch((e: unknown) => live && setError(e instanceof LiveError ? e.code : 'UNAVAILABLE'));
    return () => { live = false; };
  }, [roomId]);
  const sync = useLiveSync(joined === null ? null : { roomId, role: 'customer', token: joined.token, state });
  useEffect(() => {
    // Presence follows what the customer is doing on the pay screen (coordination only).
    const onFocus = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-testid=quote-review], #refund')) setState('reviewing');
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, []);

  if (error !== null) return <Notice tone="danger" live testId="live-error">{errorText(c, error)}</Notice>;
  if (joined === null) return <Notice live>{c.joining}</Notice>;
  return (
    <div className="flex flex-col gap-4">
      <LiveCustomerBanner snapshot={sync.snapshot} requestId={joined.requestId} c={c} />
      <PayRequest id={joined.requestId} />
    </div>
  );
}

function LiveCustomerBanner({ snapshot, requestId, c }: { snapshot: LiveSnapshot | null; requestId: string; c: LiveCopy }) {
  const ended = snapshot !== null && (snapshot.closed || snapshot.expired);
  return (
    <Card>
      <div data-testid="live-customer-banner" className="flex flex-col gap-2">
        <h2 className="font-semibold">{c.title}</h2>
        {ended ? (
          <Notice tone="muted">{snapshot.closed ? c.closed : c.expired}</Notice>
        ) : (
          <>
            <CodeBlock requestId={requestId} c={c} />
            <p data-testid="live-merchant-presence" className="text-[13px]">{snapshot?.merchant.online ? c.merchantOnline : c.merchantOffline}</p>
          </>
        )}
        <p className="text-[12px] text-[var(--text-muted)]">{c.hint}</p>
      </div>
    </Card>
  );
}

/**
 * The pay screen with the merchant's Live Handshake panel. The panel appears
 * for an OPEN request when the connected wallet is the request's recipient, or
 * in a labelled fixture Preview. Customers never see it.
 */
export function PayWithLive({ id }: { readonly id: string }) {
  const wallet = useMainnetWallet();
  const fixtures = MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures;
  return (
    <PayRequest
      id={id}
      after={(request, open) => (
        <>
          <TrackRequestButton requestId={request.terms.id} />
          {open && (fixtures || wallet.accountId === request.recipientAccountId) && <LiveMerchantCard requestId={request.terms.id} />}
        </>
      )}
    />
  );
}
