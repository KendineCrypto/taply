'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { prepareClaimGift, prepareRefundGift, prepareRetryGiftPayout, signGiftClaim } from '@taply/near-client';
import type { GiftReader, GiftView, PreparedGiftCall } from '@taply/near-client';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Button, Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { ConnectWalletButton } from '@/components/wallet/WalletConnect';
import { formatBaseUnits } from '@/lib/format/amount';
import { fill } from '@/lib/i18n/fill';
import { useLocale, useT } from '@/lib/i18n/provider';
import { useWallet } from '@/lib/wallet/provider';
import { CHAIN_CONFIG } from '@/lib/near/config';
import { GIFT_SETUP, defaultGiftReader, useGift } from '@/lib/gift/hooks';
import type { GiftSetup } from '@/lib/gift/setup';
import { giftSecretFromHash } from '@/lib/gift/link';
import { canClaim, deriveGiftUi, remainingMs } from '@/lib/gift/status';
import type { GiftUi, LocalClaim } from '@/lib/gift/status';
import { formatRemaining } from '@/lib/gift/create';
import { claimAttempt, saveGift } from '@/lib/gift/store';
import { submitGiftCall } from '@/lib/gift/submit';
import { Envelope } from './Envelope';
import { GiftLetter } from './GiftLetter';

/**
 * /gift/[id] — an Open Gift.
 *
 * Unwrapping the envelope is visual only. Claiming is a separate, explicit
 * wallet transaction signed by the claimant; the link key (from the URL
 * fragment) signs a claim bound to that claimant's account, so the payout can
 * only go to whoever signs. Every state comes from a final, code-hash-pinned
 * `get_gift` read: a wallet hash never shows success.
 */
const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function GiftScreen({ id, setup = GIFT_SETUP, reader }: { readonly id: string; readonly setup?: GiftSetup; readonly reader?: GiftReader | null }) {
  const t = useT();
  if (setup.status !== 'ready') return <InlineNotice copy={t.gift.claim.flagOff} tone="neutral" />;
  return <GiftLive id={id} setup={setup} reader={reader === undefined ? defaultGiftReader(setup) : reader} />;
}

type Ready = Extract<GiftSetup, { status: 'ready' }>;

function GiftLive({ id, setup, reader }: { readonly id: string; readonly setup: Ready; readonly reader: GiftReader | null }) {
  const t = useT();
  const g = t.gift;
  const { locale } = useLocale();
  const { state: wallet, connect, signAndSend } = useWallet();
  const me = wallet.status === 'connected' ? wallet.session.accountId : null;
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => '');
  const seed = giftSecretFromHash(hash);
  const { read, refresh } = useGift(id, reader);
  const [opened, setOpened] = useState(false);
  const [local, setLocal] = useState<LocalClaim>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = me === null ? null : claimAttempt(id, me);
  const [now, setNow] = useState(() => Date.now());
  // A remembered claim counts as "submitted" only briefly; after that the chain alone speaks.
  const recent = saved !== null && now - saved.savedAt < 120_000;
  const effectiveLocal: LocalClaim = local === 'idle' && recent ? { submitted: saved.txHash } : local;
  const ui = deriveGiftUi({ read, me, local: wallet.status === 'connecting' && local === 'connecting' ? 'connecting' : effectiveLocal });
  const gift = 'gift' in ui ? ui.gift : null;
  const chainNow = read.status === 'ok' ? read.observedAtNs : null;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // Chain time is the authority; the local clock only animates the countdown between reads.
  const [anchor, setAnchor] = useState<{ chainNs: string; at: number } | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-anchor the countdown on each final read
    if (chainNow !== null) setAnchor({ chainNs: chainNow, at: Date.now() });
  }, [chainNow]);
  const left = gift !== null && anchor !== null ? Math.max(0, remainingMs(gift.expiresAtNs, anchor.chainNs) - (now - anchor.at)) : null;

  const near = (yocto: string) => formatBaseUnits(yocto, 24, { locale, maxFractionDigits: 5 }).display;
  const send = async (call: PreparedGiftCall, claim: boolean) => {
    setLocal('awaiting_wallet');
    const result = await submitGiftCall(signAndSend, call);
    if (result.kind === 'declined' || result.kind === 'not_sent') {
      setLocal('idle');
      setNotice(result.kind === 'declined' ? g.result.declined : g.result.notSent);
      return;
    }
    if (claim && me !== null) saveGift({ kind: 'claim', id, account: me, savedAt: Date.now(), phase: result.kind, txHash: result.transactionHash });
    setLocal({ submitted: result.transactionHash });
    refresh();
  };

  const claim = async () => {
    if (me === null || seed === null || busy || reader === null) return;
    setBusy(true);
    setNotice(null);
    try {
      // Fresh final read right before the wallet opens.
      const fresh = await reader.readGift(id);
      const current = fresh.observation.data;
      if (fresh.error !== null || current === null || current.gift === null) {
        setNotice(g.claim.states.unavailable.body);
        refresh();
        return;
      }
      let signature: string;
      try {
        signature = await signGiftClaim(globalThis.crypto, seed, setup.contractId, id, me);
      } catch {
        setNotice(g.claim.signFailed);
        return;
      }
      let call: PreparedGiftCall;
      try {
        call = prepareClaimGift({ contractId: setup.contractId, gift: current.gift, signerAccountId: me, signatureHex: signature, observedAtNs: current.observedAtNs });
      } catch {
        refresh();
        return;
      }
      await send(call, true);
    } finally {
      setBusy(false);
    }
  };

  const settle = async (kind: 'refund' | 'retry') => {
    if (me === null || busy || reader === null) return;
    setBusy(true);
    setNotice(null);
    try {
      const fresh = await reader.readGift(id);
      const current = fresh.observation.data;
      if (fresh.error !== null || current === null || current.gift === null) {
        setNotice(g.claim.states.unavailable.body);
        return;
      }
      let call: PreparedGiftCall;
      try {
        call = kind === 'refund'
          ? prepareRefundGift({ contractId: setup.contractId, gift: current.gift, signerAccountId: me, observedAtNs: current.observedAtNs })
          : prepareRetryGiftPayout({ contractId: setup.contractId, gift: current.gift, signerAccountId: me });
      } catch {
        refresh();
        return;
      }
      await send(call, kind === 'retry');
    } finally {
      setBusy(false);
    }
  };

  const stateCopy = g.claim.states[ui.kind];
  const success = ui.kind === 'claimed';
  const tone = success ? 'text-[var(--taply-lime)]' : ui.kind === 'unavailable' || ui.kind === 'payout_failed' ? 'text-[var(--tone-caution-fg)]' : '';
  const explorer = CHAIN_CONFIG.ok ? CHAIN_CONFIG.explorerBaseUrl : null;
  const yourTx = saved?.txHash ?? (typeof effectiveLocal === 'object' ? effectiveLocal.submitted : null);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--text-muted)]">{g.claim.unreviewed}</p>

      <section className="surface-hero flex flex-col items-center gap-4 px-5 pb-5 pt-6">
        <Envelope design={gift?.design ?? 0} open={opened} label={opened ? g.envelope.openLabel : g.envelope.closedLabel}>
          {gift !== null && (
            <GiftLetter from={gift.creator} amountYocto={gift.amountYocto} message={gift.message} status={stateCopy.title} />
          )}
        </Envelope>
        {!opened ? (
          <div className="flex w-full flex-col items-center gap-2">
            <Button size="lg" block onClick={() => setOpened(true)} disabled={gift === null}>
              <Icon name="gift" size={18} /> {g.envelope.unwrap}
            </Button>
            <p className="text-xs text-[var(--text-muted)]">{g.envelope.unwrapHint}</p>
          </div>
        ) : (
          // The letter shows three lines; longer messages are repeated in full here.
          gift !== null && gift.message.length > 90 && (
            <p className="w-full whitespace-pre-line break-words rounded-[var(--radius-control)] bg-[rgb(244_243_232/0.05)] p-4 text-[0.9375rem] leading-relaxed">
              {gift.message}
            </p>
          )
        )}
      </section>

      <section className="surface-card flex flex-col gap-3 p-5" aria-live="polite" aria-atomic="true" data-testid="gift-state" data-state={ui.kind}>
        <p className={`flex items-center gap-2 text-lg font-semibold ${tone}`}>
          {ui.kind === 'loading' || ui.kind === 'submitted' || ui.kind === 'claim_pending' || ui.kind === 'awaiting_wallet' || ui.kind === 'connecting' ? (
            <Spinner />
          ) : success ? (
            <Icon name="check" size={20} />
          ) : ui.kind === 'unavailable' || ui.kind === 'payout_failed' ? (
            <Icon name="alert" size={20} />
          ) : (
            <Icon name="gift" size={20} />
          )}
          {stateCopy.title}
        </p>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{stateCopy.body}</p>

        {gift !== null && (
          <dl className="text-sm">
            <Row label={g.claim.amountLabel} value={<strong>{near(gift.amountYocto)} NEAR</strong>} />
            <Row label={g.receipt.creator} value={<span className="chain-id break-all">{gift.creator}</span>} />
            {gift.beneficiary !== null && gift.status === 'CLAIMED' && (
              <Row label={g.claim.winner} value={<span className="chain-id break-all font-semibold">{gift.beneficiary}</span>} />
            )}
            {gift.payout !== null && <Row label={g.claim.payout} value={g.claim.payoutValues[gift.payout]} />}
            {gift.settledHeight !== null && <Row label={g.claim.settledBlock} value={<span className="chain-id">#{gift.settledHeight}</span>} />}
            {(ui.kind === 'available' || ui.kind === 'submitted' || ui.kind === 'awaiting_wallet' || ui.kind === 'connecting') && left !== null && (
              <Row label={g.message.lifetimeLabel} value={left > 0 ? fill(g.claim.expiresIn, { time: formatRemaining(left) }) : g.claim.expiredAt} />
            )}
            {yourTx && explorer !== null && (
              <Row label={g.claim.yourTx} value={<a className="chain-id break-all underline" href={`${explorer}/txns/${yourTx}`} target="_blank" rel="noopener noreferrer">{yourTx.slice(0, 10)}…</a>} />
            )}
          </dl>
        )}

        {notice !== null && <p role="status" className="text-sm text-[var(--text-secondary)]">{notice}</p>}
        <Actions ui={ui} me={me} seed={seed !== null} busy={busy} onConnect={() => { setLocal('connecting'); void connect().finally(() => setLocal('idle')); }}
          onClaim={() => void claim()} onRefund={() => void settle('refund')} onRetry={() => void settle('retry')} gift={gift} />
        {(ui.kind === 'claim_pending' || ui.kind === 'refund_pending') && <p className="text-xs text-[var(--text-muted)]">{g.claim.notRepaid}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="ghost" onClick={refresh}><Icon name="refresh" size={16} /> {g.claim.refresh}</Button>
          {gift !== null && (
            <Link href={`/gift/${id}/receipt`} className="pressable inline-flex min-h-[var(--tap-target)] items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <Icon name="external" size={16} /> {g.claim.receipt}
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}

function Actions({ ui, me, seed, busy, gift, onConnect, onClaim, onRefund, onRetry }: {
  readonly ui: GiftUi; readonly me: string | null; readonly seed: boolean; readonly busy: boolean; readonly gift: GiftView | null;
  readonly onConnect: () => void; readonly onClaim: () => void; readonly onRefund: () => void; readonly onRetry: () => void;
}) {
  const t = useT();
  const c = t.gift.claim;
  if (ui.kind === 'available') {
    if (gift !== null && me === gift.creator) return <p className="text-sm text-[var(--text-secondary)]">{c.creatorCannot}</p>;
    if (!seed) return <InlineNotice copy={c.missingSecret} />;
    if (me === null) return <div className="flex flex-col gap-2"><ConnectWalletButton /><p className="text-xs text-[var(--text-muted)]">{c.claimHint}</p></div>;
    return (
      <div className="flex flex-col gap-2">
        <Button size="lg" block onClick={onClaim} disabled={busy || !canClaim(ui, me)}>
          {busy ? <Spinner /> : <Icon name="gift" size={18} />} {c.claimAction}
        </Button>
        <p className="text-xs text-[var(--text-muted)]">{c.claimHint} <span className="chain-id">{me}</span></p>
      </div>
    );
  }
  if (ui.kind === 'connecting') return <Button size="lg" block disabled onClick={onConnect}><Spinner /> {c.states.connecting.title}</Button>;
  if (ui.kind === 'expired' && gift !== null && me === gift.creator) {
    return (
      <div className="flex flex-col gap-2">
        <Button size="lg" block onClick={onRefund} disabled={busy}>{busy ? <Spinner /> : <Icon name="arrow-left" size={18} />} {c.refundAction}</Button>
        <p className="text-xs text-[var(--text-muted)]">{c.refundHint}</p>
      </div>
    );
  }
  if (ui.kind === 'payout_failed') {
    return <Button size="lg" block onClick={onRetry} disabled={busy}>{busy ? <Spinner /> : <Icon name="refresh" size={18} />} {c.retryPayout}</Button>;
  }
  if (ui.kind === 'refunded' || ui.kind === 'refund_pending') {
    if (gift !== null && gift.payout === 'FAILED' && me === gift.creator)
      return <Button size="lg" block onClick={onRetry} disabled={busy}>{c.retryPayout}</Button>;
  }
  return null;
}

function Row({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] py-2.5 last:border-0">
      <dt className="shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 text-right">{value}</dd>
    </div>
  );
}
