'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { verifyDirectTransfer } from '@taply/near-client';
import type { DirectTransferCheck } from '@taply/near-client';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { NetworkPill } from '@/components/experience/Basics';
import { Button, Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { formatBaseUnits } from '@/lib/format/amount';
import { useLocale, useT } from '@/lib/i18n/provider';
import { CHAIN_CONFIG } from '@/lib/near/config';
import { personalGiftFromHash } from '@/lib/gift/link';
import type { PersonalGift } from '@/lib/gift/link';
import { Envelope } from './Envelope';
import { GiftLetter } from './GiftLetter';

/**
 * /gift/p#g=… — a Personal Gift. The money already moved with a normal NEAR
 * transfer; this page only re-checks THAT transfer (exact amount, sender,
 * recipient, success) at a final block. The message comes from the link and
 * is labelled as such. Never described as escrow or claimable.
 */
const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export type Verifier = (gift: PersonalGift) => Promise<DirectTransferCheck>;
const defaultVerifier: Verifier = (gift) =>
  CHAIN_CONFIG.ok
    ? verifyDirectTransfer(CHAIN_CONFIG.client, { txHash: gift.tx, from: gift.from, to: gift.to, amountYocto: gift.amt })
    : Promise.resolve({ kind: 'UNAVAILABLE' });

export function PersonalGiftScreen({ verify = defaultVerifier }: { readonly verify?: Verifier }) {
  const t = useT();
  const p = t.gift.personal;
  const { locale } = useLocale();
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => null);
  const gift = hash === null ? undefined : personalGiftFromHash(hash);
  const [check, setCheck] = useState<DirectTransferCheck | 'checking'>('checking');
  const [attempt, setAttempt] = useState(0);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (gift === undefined || gift === null) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new check starts
    setCheck('checking');
    void verify(gift).then(
      (result) => active && setCheck(result),
      () => active && setCheck({ kind: 'UNAVAILABLE' }),
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run per link payload / manual retry
  }, [hash, attempt, verify]);

  if (gift === undefined) return <p role="status" className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><Spinner /> {p.checking}</p>;
  if (gift === null) return <InlineNotice copy={p.invalid} />;
  const verified = check !== 'checking' && check.kind === 'VERIFIED';
  const explorer = CHAIN_CONFIG.ok ? CHAIN_CONFIG.explorerBaseUrl : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end"><NetworkPill /></div>
      <section className="surface-hero flex flex-col items-center gap-4 px-5 pb-5 pt-6">
        <Envelope design={gift.d} open={opened} label={opened ? t.gift.envelope.openLabel : t.gift.envelope.closedLabel}>
          <GiftLetter from={gift.from} amountYocto={gift.amt} message={gift.msg} status={verified ? p.verified : null} />
        </Envelope>
        {!opened ? (
          <Button size="lg" block onClick={() => setOpened(true)}><Icon name="gift" size={18} /> {t.gift.envelope.unwrap}</Button>
        ) : (
          gift.msg !== '' && (
            <div className="w-full">
              <p className="whitespace-pre-line break-words rounded-[var(--radius-control)] bg-[rgb(244_243_232/0.05)] p-4 text-[0.9375rem] leading-relaxed">{gift.msg}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{p.messageNote}</p>
            </div>
          )
        )}
      </section>
      <section className="surface-card flex flex-col gap-3 p-5" aria-live="polite" data-testid="personal-state" data-state={check === 'checking' ? 'checking' : check.kind}>
        {check === 'checking' && <p className="flex items-center gap-2 font-semibold"><Spinner /> {p.checking}</p>}
        {verified && (
          <>
            <p className="flex items-center gap-2 text-lg font-semibold text-[var(--taply-lime)]"><Icon name="check" size={20} /> {p.verified}</p>
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{p.verifiedBody}</p>
          </>
        )}
        {check !== 'checking' && check.kind === 'MISMATCH' && <InlineNotice copy={p.mismatch} />}
        {check !== 'checking' && check.kind === 'NOT_FOUND' && <InlineNotice copy={p.notFound} />}
        {check !== 'checking' && check.kind === 'UNAVAILABLE' && <InlineNotice copy={p.unavailable} />}
        <dl className="text-sm">
          <Row label={t.gift.claim.amountLabel} value={<strong>{formatBaseUnits(gift.amt, 24, { locale, maxFractionDigits: 5 }).display} NEAR</strong>} />
          <Row label={p.from} value={<span className="chain-id break-all">{gift.from}</span>} />
          <Row label={p.to} value={<span className="chain-id break-all">{gift.to}</span>} />
          <Row label={p.tx} value={explorer !== null
            ? <a className="chain-id break-all underline" href={`${explorer}/txns/${gift.tx}`} target="_blank" rel="noopener noreferrer">{gift.tx.slice(0, 12)}…</a>
            : <span className="chain-id">{gift.tx.slice(0, 12)}…</span>} />
        </dl>
        {check !== 'checking' && check.kind !== 'VERIFIED' && (
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}><Icon name="refresh" size={16} /> {t.gift.claim.refresh}</Button>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] py-2.5 last:border-0">
      <dt className="shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 text-right">{value}</dd>
    </div>
  );
}
