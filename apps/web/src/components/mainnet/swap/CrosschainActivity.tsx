'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { HISTORY_KEY, PENDING_KEY } from '@/lib/mainnet/crosschain/client';
import { ASSETS, PublicSession, formatAmount, txLink, type PublicSession as Session } from '@/lib/mainnet/crosschain/model';
import { crossEn, crossTr } from '@/lib/mainnet/crosschain/copy';
import { useMainnetLocale } from '@/lib/mainnet/copy';

export function CrosschainActivity() {
  const { locale } = useMainnetLocale(); const c = locale === 'tr' ? crossTr : crossEn;
  const [entries, setEntries] = useState<Session[]>([]), [pending, setPending] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        const raw: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
        setEntries(Array.isArray(raw) ? raw.flatMap(v => { const s = PublicSession.safeParse(v); return s.success ? [s.data] : []; }).slice(-20).reverse() : []);
        setPending(localStorage.getItem(PENDING_KEY) === '1');
      } catch { setEntries([]); }
    };
    queueMicrotask(read); window.addEventListener('storage', read);
    return () => window.removeEventListener('storage', read);
  }, []);
  if (!entries.length && !pending) return null;
  return <section className="flex flex-col gap-3" data-testid="crosschain-activity">
    <h2 className="text-sm font-semibold text-[var(--text-secondary)]">{c.cross}</h2>
    {pending && <Link href="/m/swap" className="surface-card p-4 text-sm underline">{c.check}</Link>}
    {entries.map(s => {
      const q = s.quote; if (!q) return null;
      const proof = s.proof?.state === 'verified' ? s.proof : s.refundProof?.state === 'verified' ? s.refundProof : null;
      if (!proof) return null;
      return <div key={q.correlationId} className="surface-card space-y-1 p-4 text-sm">
        <p>{ASSETS[q.input.from].name} → {ASSETS[q.input.to].name}</p>
        <p className="font-semibold text-[var(--taply-lime)]">{formatAmount(proof.amount ?? '0')} USDC · {proof === s.proof ? c.verified : c.refunded}</p>
        <time className="text-xs text-[var(--text-secondary)]" dateTime={new Date(q.createdAt).toISOString()}>{new Date(q.createdAt).toLocaleString(locale)}</time>
        {proof.txs.map(hash => { const url = txLink(proof.chain, hash); return url ? <a key={hash} href={url} target="_blank" rel="noreferrer" className="block text-xs underline">{c.view}</a> : null; })}
      </div>;
    })}
  </section>;
}
