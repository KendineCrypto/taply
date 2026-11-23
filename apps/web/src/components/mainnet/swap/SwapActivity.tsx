'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useState } from 'react';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { deriveJobStatus, loadSwapJobs, type SwapJob } from '@/lib/mainnet/swap/journal';
import { SWAP_ASSETS } from '@/lib/mainnet/swap/model';
import { useCurrentMainnetAccount } from '../MainnetShell';
import { fmt, txUrl } from './SwapParts';
import { useSwapCopy } from './SwapPage';

/** Swap entries in Activity: the swap record's own status and transaction ids, newest first. */
export function SwapActivity() {
  const c = useSwapCopy();
  const { locale } = useMainnetLocale();
  const { accountId } = useCurrentMainnetAccount();
  const [jobs, setJobs] = useState<SwapJob[] | 'corrupt'>([]);
  useEffect(() => {
    queueMicrotask(() => {
      if (accountId === null) { setJobs([]); return; }
      try { setJobs(loadSwapJobs(window.localStorage, accountId)); } catch { setJobs('corrupt'); }
    });
  }, [accountId]);
  if (accountId === null) return null;
  if (jobs === 'corrupt') return <p className="text-[13px] text-[var(--tone-danger-fg)]" role="alert">{c.errors.corrupt}</p>;
  if (jobs.length === 0) return null;
  return (
    <section aria-labelledby="swap-activity-title" data-testid="swap-activity">
      <h2 id="swap-activity-title" className="mb-2 px-1 text-sm font-semibold text-[var(--text-secondary)]">{c.activity.title}</h2>
      <ul className="flex flex-col divide-y divide-[var(--border-subtle)] rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-1)]">
        {[...jobs].reverse().slice(0, 20).map(job => {
          const status = deriveJobStatus(job);
          const from = SWAP_ASSETS[job.from], to = SWAP_ASSETS[job.to];
          const out = job.steps.find(s => s.step.kind === 'unwrap')?.amount ?? job.steps.find(s => s.step.kind === 'swap')?.amount ?? job.steps.find(s => s.step.kind === 'wrap')?.amount ?? null;
          const tone = status === 'completed' ? 'text-[var(--taply-lime)]' : status === 'unknown' || status === 'partial' ? 'text-[var(--tone-caution-fg)]' : status === 'failed' ? 'text-[var(--tone-danger-fg)]' : 'text-[var(--text-secondary)]';
          return (
            <li key={job.id} className="px-4 py-3" data-testid="swap-activity-row" data-status={status}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-[14px] font-medium">{from.symbol} → {to.symbol}</p>
                <p className={`shrink-0 text-[12px] font-semibold ${tone}`}>{c.activity.status[status]}</p>
              </div>
              <p className="mt-0.5 break-words text-[12px] tabular-nums text-[var(--text-secondary)]">
                {fmt(job.amountIn, from, locale)}{status === 'completed' && out !== null ? ` → ${fmt(out, to, locale)}` : ''}
              </p>
              <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-[var(--text-muted)]">
                <time dateTime={new Date(job.createdAt).toISOString()}>{new Date(job.createdAt).toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-GB')}</time>
                {job.steps.filter(s => s.txHash).map((s, i) => <a key={i} className="underline" href={txUrl(s.txHash!)} target="_blank" rel="noreferrer">{c.result.tx} {i + 1}</a>)}
                {(status === 'active' || status === 'unknown') && <Link className="font-semibold text-[var(--taply-lime)] underline" href={'/m/swap' as Route}>{c.activity.open}</Link>}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
