'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { MAINNET_SWAP_LIMITS, mainnetMinAmountOut } from '@taply/near-client';
import { Button } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { Sheet } from '@/components/shell/Sheet';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { MAINNET_SIGNING_RELEASE_APPROVED } from '@/lib/mainnet/release-gates';
import { swapEn, swapTr, type SwapCopy } from '@/lib/mainnet/swap/copy';
import { activeSwapJob, createSwapJob, deriveJobStatus, loadSwapJobs, nextPendingStep, swapOutput, updateSwapJob, SwapJournalError, type SwapJob } from '@/lib/mainnet/swap/journal';
import {
  SWAP_ASSETS, amountToInput, balanceOf, checkBalances, isPoolSwap, maxSwapInput, parseSwapAmount, planSwap, sameAsset,
  type SwapAsset, type SwapAssetId, type SwapPlan,
} from '@/lib/mainnet/swap/model';
import { resolveSwapStep, runNextSwapStep, SwapStepError, type SwapRunnerDeps } from '@/lib/mainnet/swap/runner';
import { QUOTE_TTL_MS, useSwapQuote, type QuoteFetcher, type SwapQuote } from '@/lib/mainnet/swap/use-swap-quote';
import { currentAuthority, deviceId, signingProfiles, USDC_CODE_HASH } from '@/lib/mainnet/wallet-ops';
import { useSigner, OperationError } from '../Operation';
import { useMainnetVault } from '../Wallet';
import { CrosschainSwap } from './CrosschainSwap';
import { crossEn, crossTr } from '@/lib/mainnet/crosschain/copy';
import { PENDING_KEY } from '@/lib/mainnet/crosschain/client';
import { DetailLine, SettingsSheet, StepIcon, TokenButton, TokenMark, TokenSheet, fmt, pct, txUrl } from './SwapParts';

export function useSwapCopy(): SwapCopy { return useMainnetLocale().locale === 'tr' ? swapTr : swapEn; }

/**
 * /m/swap — NEAR Mainnet swap (NEAR, wNEAR, USDC on the pinned Rhea pool).
 * Real on-chain quotes; every signature goes through the Codex planner swap policy
 * and the device ledger; results are proven from FINAL receipts.
 */
export function SwapPage(props: { readonly fetcher?: QuoteFetcher } = {}) {
  const { locale } = useMainnetLocale(); const c = locale === 'tr' ? crossTr : crossEn;
  const [cross, setCross] = useState(false);
  useEffect(() => { try { if (localStorage.getItem(PENDING_KEY) === '1') queueMicrotask(() => setCross(true)); } catch { /* the cross-chain page reports inaccessible storage */ } }, []);
  return <>
    <div className="mx-auto mb-4 grid w-full max-w-[480px] grid-cols-2 gap-1 rounded-full bg-[var(--surface-1)] p-1" role="group" aria-label={c.title}>
      <button type="button" aria-pressed={!cross} onClick={() => setCross(false)} className={`tap-target rounded-full px-3 text-sm font-semibold ${!cross ? 'bg-[var(--surface-2)] text-[var(--taply-lime)]' : 'text-[var(--text-secondary)]'}`}>{c.local}</button>
      <button type="button" aria-pressed={cross} onClick={() => setCross(true)} className={`tap-target rounded-full px-3 text-sm font-semibold ${cross ? 'bg-[var(--surface-2)] text-[var(--taply-lime)]' : 'text-[var(--text-secondary)]'}`}>{c.cross}</button>
    </div>
    {cross ? <CrosschainSwap /> : <NearSwapPage {...props} />}
  </>;
}

function NearSwapPage({ fetcher }: { readonly fetcher?: QuoteFetcher } = {}) {
  const c = useSwapCopy();
  const { locale } = useMainnetLocale();
  const signer = useSigner();
  const { unlocked } = useMainnetVault();
  const accountId = signer.kind === 'ok' ? signer.accountId : null;
  const [fromId, setFromId] = useState<SwapAssetId>('near');
  const [toId, setToId] = useState<SwapAssetId>('usdc');
  const [text, setText] = useState('');
  const [slippageBps, setSlippage] = useState<number>(MAINNET_SWAP_LIMITS.defaultSlippageBps);
  const [sheet, setSheet] = useState<'from' | 'to' | 'settings' | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [jobs, setJobs] = useState<SwapJob[] | 'corrupt' | null>(null);
  const [viewJob, setViewJob] = useState<string | null>(null);
  const from = SWAP_ASSETS[fromId], to = SWAP_ASSETS[toId];
  const parsed = parseSwapAmount(text, from);
  const amount = parsed.kind === 'ok' ? parsed.baseUnits : null;
  const available = MAINNET_CONFIG.ok && signingProfiles() !== null && USDC_CODE_HASH !== undefined;

  const reloadJobs = useCallback(() => {
    if (accountId === null) { setJobs(null); return; }
    try { setJobs(loadSwapJobs(window.localStorage, accountId)); } catch { setJobs('corrupt'); }
  }, [accountId]);
  useEffect(() => { queueMicrotask(reloadJobs); }, [reloadJobs]);
  // Another tab may change the journal: follow it, never fork it.
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key?.startsWith('taply.mainnet.swap.v1:')) reloadJobs(); };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, [reloadJobs]);
  const open = Array.isArray(jobs) ? activeSwapJob(jobs) : null;
  // A resumed open job stays on screen until the person closes it (its result or recovery included).
  useEffect(() => { if (open && viewJob === null) queueMicrotask(() => setViewJob(open.id)); }, [open, viewJob]);
  const shown = Array.isArray(jobs) ? (jobs.find(j => j.id === viewJob) ?? open) : null;

  const quote = useSwapQuote({ from, to, amount: sameAsset(from, to) ? null : amount, accountId, enabled: available && shown === null, ...(fetcher ? { fetcher } : {}) });
  const q = quote.current;
  const account = q?.read.account ?? null;

  const plan: SwapPlan | null = useMemo(() => {
    if (!q || !account || amount === null || q.expectedOut === null || sameAsset(from, to)) return null;
    try { return planSwap({ from, to, amountIn: amount, expectedOut: q.expectedOut, slippageBps, account }); } catch { return null; }
  }, [q, account, amount, from, to, slippageBps]);
  const balances = useMemo(() => {
    if (!account) return {};
    return { near: balanceOf(SWAP_ASSETS.near, account), wnear: balanceOf(SWAP_ASSETS.wnear, account), usdc: balanceOf(SWAP_ASSETS.usdc, account) } as Record<SwapAssetId, bigint>;
  }, [account]);

  const pick = (side: 'from' | 'to', id: SwapAssetId) => {
    setSheet(null); setReviewing(false);
    if (side === 'from') { if (id === toId) setToId(fromId); setFromId(id); setText(''); }
    else { if (id === fromId) setFromId(toId); setToId(id); }
  };
  const flip = () => { setReviewing(false); setFromId(toId); setToId(fromId); setText(''); };
  const setMax = () => { if (account) { const m = maxSwapInput(from, to, account); setText(m > 0n ? amountToInput(m, from, locale) : '0'); } };

  // ---- CTA state (one lime button) ----
  type Cta = { label: string; enabled: boolean; action?: 'review' | 'refresh'; href?: string; error?: string };
  const cta: Cta = (() => {
    if (!MAINNET_CONFIG.ok) return { label: c.cta.readOnly, enabled: false, error: c.errors.notMainnet };
    if (!USDC_CODE_HASH) return { label: c.cta.readOnly, enabled: false, error: c.errors.noUsdcPin };
    if (signer.kind === 'none') return { label: c.cta.connect, enabled: true, href: '/m/wallet' };
    if (signer.kind === 'external-no-key') return { label: c.cta.readOnly, enabled: false, error: c.errors.externalNoKey };
    if (jobs === 'corrupt') return { label: c.cta.blocked, enabled: false, error: c.errors.corrupt };
    if (sameAsset(from, to)) return { label: c.cta.select, enabled: false, error: c.errors.same };
    if (parsed.kind === 'empty') return { label: c.cta.enter, enabled: false };
    if (parsed.kind === 'error') return { label: c.cta.enter, enabled: false, error: parsed.reason === 'precision' ? c.errors.precision(from.decimals) : c.errors[parsed.reason] };
    if (amount !== null && amount > MAINNET_SWAP_LIMITS.maxInput[from.token]) return { label: c.cta.cap, enabled: false, error: c.errors.cap(fmt(MAINNET_SWAP_LIMITS.maxInput[from.token], from, locale)) };
    if (quote.state.kind === 'error' && !q) {
      const code = quote.state.code;
      const msg = code === 'SWAP_CODE_PIN_MISMATCH' ? c.errors.pin : code === 'SWAP_PRICE_IMPACT_TOO_HIGH' ? c.errors.impact : code === 'SWAP_NO_LIQUIDITY' || code === 'SWAP_POOL_MISMATCH' ? c.cta.noRoute : c.errors.quote;
      return { label: code === 'SWAP_NO_LIQUIDITY' ? c.cta.noRoute : c.cta.expired, enabled: code !== 'SWAP_CODE_PIN_MISMATCH', action: 'refresh', error: msg };
    }
    if (q?.accountMissing && signer.kind === 'ok') return { label: c.cta.insufficient('NEAR'), enabled: false, error: c.errors.notActivated };
    if (!q || !plan || !account) return { label: c.cta.fetching, enabled: false };
    if (quote.expired) return { label: c.cta.expired, enabled: true, action: 'refresh' };
    const check = checkBalances(from, amount!, plan, account);
    if (check === 'insufficient_token') return { label: c.cta.insufficient(from.symbol), enabled: false };
    if (check === 'insufficient_native_fee') return { label: c.cta.insufficientFee, enabled: false };
    if (check === 'cap') return { label: c.cta.cap, enabled: false };
    if (q.math && q.math.priceImpactBps > MAINNET_SWAP_LIMITS.maxImpactBps) return { label: c.cta.noRoute, enabled: false, error: c.errors.impact };
    if (open) return { label: c.cta.blocked, enabled: false };
    // Quotes, balances and checks work while locked; only signing needs the unlocked Taply Wallet.
    if (signer.signer.kind === 'internal' && !unlocked) return { label: c.cta.unlock, enabled: true, href: '/m/wallet' };
    return { label: c.cta.review, enabled: true, action: 'review' };
  })();

  const env = useRunnerEnv();
  const deps: SwapRunnerDeps | null = signer.kind === 'ok' && env.device !== null && signingProfiles() !== null
    ? { signer: signer.signer, profiles: signingProfiles()!, authority: env.authority, deviceId: env.device, storage: typeof window === 'undefined' ? (null as never) : window.localStorage }
    : null;

  if (shown) {
    return (
      <SwapProgress job={shown} deps={deps} c={c} locale={locale} onChange={reloadJobs}
        onClose={() => { setViewJob(null); setText(''); reloadJobs(); quote.refresh(); }}
        onStart={(next) => { setViewJob(null); setFromId(next.from); setToId(next.to); setText(amountToInput(next.amount, SWAP_ASSETS[next.from], locale)); reloadJobs(); }} />
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-[480px] flex-col gap-3" aria-labelledby="swap-title" data-testid="swap-page">
      <div className="flex items-center justify-between">
        <h1 id="swap-title" className="text-lg font-semibold">{c.title}</h1>
        <button type="button" onClick={() => setSheet('settings')} aria-label={`${c.settings} (${c.slippage} ${pct(slippageBps, locale)})`} data-testid="swap-settings"
          className="pressable tap-target flex items-center gap-1.5 rounded-full px-2 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          {slippageBps !== MAINNET_SWAP_LIMITS.defaultSlippageBps && <span className="tabular-nums">{pct(slippageBps, locale)}</span>}
          <Icon name="settings" size={20} />
        </button>
      </div>

      <div className="relative flex flex-col gap-1">
        <AmountPanel label={c.youPay} asset={from} c={c} locale={locale} balance={account ? balanceOf(from, account) : null} onMax={account ? setMax : null}
          onToken={() => setSheet('from')}>
          <AmountInput value={text} onChange={v => { setText(v); setReviewing(false); }} label={c.amountLabel(from.symbol)} invalid={parsed.kind === 'error'} />
        </AmountPanel>
        <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <button type="button" onClick={flip} aria-label={c.flip} data-testid="swap-flip"
            className="pressable grid size-11 place-items-center rounded-full border-4 border-[var(--surface-0)] bg-[var(--surface-2)] text-[var(--text-primary)] hover:text-[var(--taply-lime)]">
            <Icon name="swap" size={18} />
          </button>
        </div>
        <AmountPanel label={c.youReceive} asset={to} c={c} locale={locale} balance={account ? balanceOf(to, account) : null} onMax={null} onToken={() => setSheet('to')}>
          <output aria-live="polite" aria-label={c.receiveLabel(to.symbol)} data-testid="swap-out"
            className={`display-amount block min-w-0 truncate text-[2rem] leading-tight ${q?.expectedOut ? '' : 'text-[var(--text-muted)]'} ${quote.state.kind === 'loading' ? 'opacity-60' : ''}`}>
            {q?.expectedOut && amount !== null ? fmt(q.expectedOut, to, locale, to.decimals === 6 ? 6 : 6).split(' ')[0] : '0'}
          </output>
        </AmountPanel>
      </div>

      {q && q.expectedOut !== null && amount !== null && <QuoteSummary q={q} plan={plan} from={from} to={to} amount={amount} slippageBps={slippageBps} c={c} locale={locale} />}

      {cta.error && <p className="px-1 text-[13px] text-[var(--tone-danger-fg)]" role="alert" data-testid="swap-error">{cta.error}</p>}
      {cta.href ? (
        <Link href={cta.href as Route} className="pressable inline-flex min-h-[52px] items-center justify-center rounded-[var(--radius-control)] bg-[var(--taply-lime)] px-5 font-semibold text-[var(--taply-night)]" data-testid="swap-cta">{cta.label}</Link>
      ) : (
        <Button size="lg" block disabled={!cta.enabled} data-testid="swap-cta" data-action={cta.action ?? 'none'}
          onClick={() => { if (cta.action === 'refresh') quote.refresh(); else if (cta.action === 'review') setReviewing(true); }}>
          {cta.label}
        </Button>
      )}
      <p className="px-1 text-center text-[11px] text-[var(--text-muted)]">{c.attribution}</p>

      <TokenSheet open={sheet === 'from'} onClose={() => setSheet(null)} onPick={id => pick('from', id)} selected={fromId} other={toId} balances={balances} locale={locale} c={c} />
      <TokenSheet open={sheet === 'to'} onClose={() => setSheet(null)} onPick={id => pick('to', id)} selected={toId} other={fromId} balances={balances} locale={locale} c={c} />
      <SettingsSheet open={sheet === 'settings'} onClose={() => setSheet(null)} slippageBps={slippageBps} onSlippage={b => { setSlippage(b); setReviewing(false); }} locale={locale} c={c} />
      {reviewing && q && plan && amount !== null && accountId !== null && (
        <SwapReview key={quote.key} q={q} plan={plan} from={from} to={to} amount={amount} slippageBps={slippageBps} accountId={accountId} c={c} locale={locale}
          onClose={() => setReviewing(false)} onRefresh={quote.refresh} deps={deps}
          onStarted={(job) => { setReviewing(false); setViewJob(job.id); reloadJobs(); }} />
      )}
    </section>
  );
}

function useRunnerEnv() {
  const [env, setEnv] = useState<{ authority: ReturnType<typeof currentAuthority>; device: string | null }>({ authority: { kind: 'unavailable' }, device: null });
  useEffect(() => {
    queueMicrotask(() => {
      let device: string | null = null;
      try { device = deviceId(window.localStorage); } catch { device = null; }
      setEnv({ authority: currentAuthority(), device });
    });
  }, []);
  return env;
}

function AmountPanel({ label, asset, balance, onMax, onToken, children, c, locale }: {
  readonly label: string; readonly asset: SwapAsset; readonly balance: bigint | null; readonly onMax: (() => void) | null; readonly onToken: () => void;
  readonly children: React.ReactNode; readonly c: SwapCopy; readonly locale: 'en' | 'tr';
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 pb-3 pt-3.5 focus-within:border-[var(--taply-lime)]/60">
      <p className="text-[13px] font-medium text-[var(--text-secondary)]">{label}</p>
      <div className="mt-1.5 flex items-center gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <TokenButton asset={asset} onClick={onToken} label={c.selectToken} c={c} />
      </div>
      <div className="mt-1.5 flex min-h-6 items-center justify-end gap-2 text-[12px] text-[var(--text-muted)]">
        {balance !== null && <span className="tabular-nums" data-testid={`balance-${asset.id}`}>{c.balance}: {fmt(balance, asset, locale, asset.decimals === 6 ? 6 : 5)}</span>}
        {onMax && <button type="button" onClick={onMax} className="tap-target -my-2 rounded-full px-2 font-semibold text-[var(--taply-lime)]" data-testid="swap-max">{c.max}</button>}
      </div>
    </div>
  );
}

function AmountInput({ value, onChange, label, invalid }: { readonly value: string; readonly onChange: (v: string) => void; readonly label: string; readonly invalid: boolean }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="sr-only">{label}</label>
      <input id={id} value={value} placeholder="0" inputMode="decimal" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="done" maxLength={40}
        aria-invalid={invalid} data-testid="swap-in"
        onChange={e => onChange(e.target.value.replace(/[^0-9.,\s-]/g, ''))}
        className="display-amount w-full min-w-0 rounded-md bg-transparent text-[2rem] leading-tight placeholder:text-[var(--text-muted)] focus:outline-none focus-visible:outline-none" />
    </>
  );
}

function rate(q: SwapQuote, from: SwapAsset, to: SwapAsset, amount: bigint, locale: 'en' | 'tr'): string {
  if (!q.expectedOut) return '';
  const one = 10n ** BigInt(from.decimals);
  return `1 ${from.symbol} ≈ ${fmt((q.expectedOut * one) / amount, to, locale, 4)}`;
}

/** `plan` is null without an account: only account-independent lines (rate, minimum, impact, pool fee) are shown. */
function QuoteSummary({ q, plan, from, to, amount, slippageBps, c, locale }: { readonly q: SwapQuote; readonly plan: SwapPlan | null; readonly from: SwapAsset; readonly to: SwapAsset; readonly amount: bigint; readonly slippageBps: number; readonly c: SwapCopy; readonly locale: 'en' | 'tr' }) {
  const near = SWAP_ASSETS.near;
  let minOut = plan?.minOut ?? q.expectedOut ?? 0n;
  // A dust amount can round its minimum to 0; the policy refuses that, so show 0 instead of throwing.
  if (!plan && isPoolSwap(from, to) && q.expectedOut !== null) { try { minOut = mainnetMinAmountOut(q.expectedOut, slippageBps); } catch { minOut = 0n; } }
  return (
    <details className="group rounded-[var(--radius-control)] border border-[var(--border-subtle)] px-3.5" data-testid="swap-summary">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-[13px]">
        <span className="min-w-0 truncate tabular-nums text-[var(--text-primary)]" data-testid="swap-rate">{isPoolSwap(from, to) ? rate(q, from, to, amount, locale) : `1 ${from.symbol} = 1 ${to.symbol}`}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-[var(--text-secondary)]">{plan ? c.timeShort(plan.steps.length) : c.details}<Icon name="chevron" size={14} className="rotate-90 transition-transform group-open:-rotate-90" /></span>
      </summary>
      <dl className="pb-2">
        <DetailLine label={c.minReceived} testId="swap-min">{fmt(minOut, to, locale)}</DetailLine>
        {q.math && <DetailLine label={c.priceImpact} testId="swap-impact">{pct(q.math.priceImpactBps, locale)}</DetailLine>}
        <DetailLine label={c.slippage}>{isPoolSwap(from, to) ? pct(slippageBps, locale) : '—'}</DetailLine>
        {q.math && <DetailLine label={c.poolFee}>{fmt(q.math.poolFeeIn, from, locale)}</DetailLine>}
        {plan && <DetailLine label={c.networkFee} note={c.networkFeeNote} testId="swap-gas">{fmt(plan.maxNetworkFeeYocto, near, locale, 5)}</DetailLine>}
        {plan && plan.storageDepositYocto > 0n && <DetailLine label={c.storage} note={c.storageNote} testId="swap-storage">{fmt(plan.storageDepositYocto, near, locale)}</DetailLine>}
        <DetailLine label={c.taplyFee}>{c.none}</DetailLine>
        {plan && <DetailLine label={c.time}>{c.timeValue(plan.steps.length)}</DetailLine>}
        <DetailLine label={c.route}>{isPoolSwap(from, to) ? c.routeValue : 'wrap.near'}</DetailLine>
        <p className="pt-1 text-[11px] text-[var(--text-muted)]">{c.quoteBlock(q.read.blockHeight)}</p>
      </dl>
    </details>
  );
}

function stepLabel(step: SwapJob['steps'][number]['step'], c: SwapCopy, locale: 'en' | 'tr'): string {
  if (step.kind === 'register') return c.review.stepRegister(step.token === SWAP_ASSETS.usdc.token ? 'USDC' : 'wNEAR');
  if (step.kind === 'wrap') return c.review.stepWrap(fmt(step.amount, SWAP_ASSETS.near, locale));
  if (step.kind === 'swap') {
    const fromA = step.tokenIn === SWAP_ASSETS.usdc.token ? SWAP_ASSETS.usdc : SWAP_ASSETS.wnear;
    const toA = step.tokenOut === SWAP_ASSETS.usdc.token ? SWAP_ASSETS.usdc : SWAP_ASSETS.wnear;
    return c.review.stepSwap(fmt(step.amountIn, fromA, locale), toA.symbol);
  }
  return step.amount === 'FROM_SWAP' ? c.review.stepUnwrap : c.review.stepUnwrapFixed(fmt(step.amount, SWAP_ASSETS.wnear, locale));
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!active) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [active]);
  return now;
}

/** Final review: exact amounts, minimum, every step, fees. Confirm creates the swap job and signs step 1. */
function SwapReview({ q, plan, from, to, amount, slippageBps, accountId, c, locale, onClose, onRefresh, onStarted, deps }: {
  readonly q: SwapQuote; readonly plan: SwapPlan; readonly from: SwapAsset; readonly to: SwapAsset; readonly amount: bigint; readonly slippageBps: number;
  readonly accountId: string; readonly c: SwapCopy; readonly locale: 'en' | 'tr'; readonly onClose: () => void; readonly onRefresh: () => void;
  readonly onStarted: (job: SwapJob) => void; readonly deps: SwapRunnerDeps | null;
}) {
  const now = useNow(true);
  const left = Math.ceil((q.fetchedAt + QUOTE_TTL_MS - now) / 1000);
  const expired = left <= 0;
  const highImpact = (q.math?.priceImpactBps ?? 0) > MAINNET_SWAP_LIMITS.highImpactBps;
  const [ack, setAck] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signing = MAINNET_CONFIG.ok && MAINNET_CONFIG.signingEnabled && MAINNET_SIGNING_RELEASE_APPROVED && (deps?.authority.kind === 'device' || deps?.authority.kind === 'simulated');
  const wraps = plan.steps.some(s => s.kind === 'wrap'), unwraps = plan.steps.some(s => s.kind === 'unwrap' && s.amount === 'FROM_SWAP');
  async function confirm() {
    if (busy || expired || !deps || !signing || (highImpact && !ack)) return;
    setBusy(true); setError('');
    let job: SwapJob;
    try {
      const id = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
      job = createSwapJob(deps.storage, { id, accountId, from: from.id, to: to.id, amountIn: amount.toString(), expectedOut: (q.expectedOut ?? 0n).toString(), minOut: plan.minOut.toString(),
        slippageBps: isPoolSwap(from, to) ? slippageBps : 1, priceImpactBps: q.math?.priceImpactBps ?? 0, quoteBlock: q.read.blockHeight, steps: [...plan.steps] });
    } catch (e) {
      setBusy(false);
      setError(e instanceof SwapJournalError && e.code === 'ACTIVE_JOB_EXISTS' ? c.cta.blocked : c.errors.storage);
      return;
    }
    onStarted(job);
  }
  return (
    <Sheet open onClose={onClose} title={c.review.title} closeLabel={c.close}>
      <div className="flex flex-col gap-4" data-testid="swap-review">
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
          <p className="text-[12px] text-[var(--text-secondary)]">{c.review.pay}</p>
          <p className="mt-1 flex items-center gap-2"><TokenMark asset={from} size={24} /><span className="display-amount break-all text-[1.5rem] leading-tight" data-testid="review-pay">{fmt(amount, from, locale)}</span></p>
          <div className="my-3 h-px bg-[var(--border-subtle)]" />
          <p className="text-[12px] text-[var(--text-secondary)]">{c.review.receive}</p>
          <p className="mt-1 flex items-center gap-2"><TokenMark asset={to} size={24} /><span className="display-amount break-all text-[1.5rem] leading-tight" data-testid="review-receive">{q.expectedOut !== null ? fmt(q.expectedOut, to, locale) : '—'}</span></p>
          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">{c.review.min}: <strong className="font-semibold text-[var(--text-primary)]" data-testid="review-min">{fmt(plan.minOut, to, locale)}</strong></p>
        </div>
        <dl className="text-[13px]">
          {q.math && <DetailLine label={c.priceImpact}>{pct(q.math.priceImpactBps, locale)}</DetailLine>}
          {isPoolSwap(from, to) && <DetailLine label={c.slippage}>{pct(slippageBps, locale)}</DetailLine>}
          <DetailLine label={c.networkFee} note={c.networkFeeNote}>{fmt(plan.maxNetworkFeeYocto, SWAP_ASSETS.near, locale, 5)}</DetailLine>
          {plan.storageDepositYocto > 0n && <DetailLine label={c.storage} note={c.storageNote}>{fmt(plan.storageDepositYocto, SWAP_ASSETS.near, locale)}</DetailLine>}
          <DetailLine label={c.taplyFee}>{c.none}</DetailLine>
          <DetailLine label={c.review.recipient}><span className="chain-id break-all">{accountId}</span> <span className="text-[var(--text-muted)]">({c.review.yourAccount})</span></DetailLine>
        </dl>
        <div>
          <p className="mb-2 text-[13px] font-semibold" data-testid="review-steps">{c.review.steps(plan.steps.length)}</p>
          <ol className="flex flex-col gap-2">
            {plan.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[13px]"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-[11px] font-semibold">{i + 1}</span><span>{stepLabel(s, c, locale)}</span></li>
            ))}
          </ol>
          {wraps && isPoolSwap(from, to) && <p className="mt-2 text-[12px] text-[var(--text-muted)]">{c.review.wrapNote}</p>}
          {unwraps && <p className="mt-2 text-[12px] text-[var(--text-muted)]">{c.review.unwrapNote}</p>}
        </div>
        {highImpact && (
          <label className="flex min-h-11 items-start gap-2.5 rounded-[var(--radius-control)] border border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] p-3 text-[13px] text-[var(--tone-caution-fg)]">
            <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="mt-0.5 size-5 accent-[var(--taply-lime)]" data-testid="impact-ack" />
            <span>{c.impactHigh(pct(q.math!.priceImpactBps, locale))} <strong>{c.impactConfirm}</strong></span>
          </label>
        )}
        {!signing && <p className="text-[13px] text-[var(--tone-caution-fg)]" role="status">{c.errors.signingOff}</p>}
        {error && <p className="text-[13px] text-[var(--tone-danger-fg)]" role="alert">{error}</p>}
        {expired ? (
          <>
            <p className="text-[13px] text-[var(--tone-caution-fg)]" role="status" data-testid="review-expired">{c.review.expired}</p>
            <Button size="lg" block onClick={onRefresh} data-testid="review-refresh">{c.cta.expired}</Button>
          </>
        ) : (
          <Button size="lg" block disabled={busy || !signing || (highImpact && !ack)} onClick={() => void confirm()} data-testid="review-confirm">{c.review.confirm}</Button>
        )}
        <p className="text-center text-[12px] text-[var(--text-muted)]" data-testid="review-expiry">{expired ? '' : c.review.expiresIn(left)}</p>
      </div>
    </Sheet>
  );
}

/** Job view: runs steps one by one, shows each step's proven status, recovery and the result. */
function SwapProgress({ job, deps, c, locale, onChange, onClose, onStart }: {
  readonly job: SwapJob; readonly deps: SwapRunnerDeps | null; readonly c: SwapCopy; readonly locale: 'en' | 'tr';
  readonly onChange: () => void; readonly onClose: () => void; readonly onStart: (next: { from: SwapAssetId; to: SwapAssetId; amount: bigint }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const status = deriveJobStatus(job);
  const from = SWAP_ASSETS[job.from], to = SWAP_ASSETS[job.to];

  const run = useCallback(async (mode: 'next' | 'resolve') => {
    if (!deps || running.current) return;
    running.current = true; setBusy(true); setError('');
    const work = async () => {
      let current = job;
      try {
        if (mode === 'resolve') current = await resolveSwapStep(deps, current);
        // Continue automatically while each step is proven done (each step still needs its own signature).
        while (nextPendingStep(current) >= 0 && (mode === 'next' || current.steps.every(s => s.status === 'done' || s.status === 'pending'))) {
          const before = current;
          current = await runNextSwapStep(deps, current);
          onChange();
          if (current.steps.some(s => s.status !== 'done' && s.status !== 'pending') || before === current) break;
        }
      } catch (e) {
        setError(e instanceof SwapStepError ? e.code : 'UNKNOWN');
      }
    };
    try {
      // One runner per browser profile (multi-tab), on top of the device ledger's own reservation.
      const locks = (navigator as Navigator & { locks?: { request: (n: string, o: { ifAvailable: boolean }, cb: (l: unknown) => Promise<void>) => Promise<void> } }).locks;
      if (locks) await locks.request(`taply-swap:${job.accountId}`, { ifAvailable: true }, async (lock) => { if (lock) await work(); else setError('STALE_ATTEMPT'); });
      else await work();
    } finally { running.current = false; setBusy(false); onChange(); }
  }, [deps, job, onChange]);

  // Start the first step right after review; never auto-run after an unknown/failed outcome.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !deps) return;
    started.current = true;
    const signingOrUnknown = job.steps.some(s => s.status === 'signing');
    if (signingOrUnknown) queueMicrotask(() => void run('resolve'));
    else if (job.status === 'active' && job.steps.every(s => s.status === 'pending')) queueMicrotask(() => void run('next'));
  }, [deps, job, run]);

  const requote = useCallback(() => {
    // A pending swap step whose price moved: close this job; the person starts again from what they now hold.
    if (!deps) return;
    updateSwapJob(deps.storage, job.accountId, job.id, j => ({ ...j, status: 'cancelled' }));
    const wrapped = job.steps.find(s => s.step.kind === 'wrap' && s.status === 'done');
    onStart({ from: wrapped ? 'wnear' : job.from, to: job.to === 'near' && wrapped ? 'usdc' : job.to, amount: BigInt(job.amountIn) });
  }, [deps, job, onStart]);

  if (status === 'completed') return <SwapResult job={job} c={c} locale={locale} onClose={onClose} />;
  const idx = nextPendingStep(job);
  const wrapDone = job.steps.find(s => s.step.kind === 'wrap' && s.status === 'done');
  const swapStep = job.steps.find(s => s.step.kind === 'swap');
  const out = swapOutput(job);
  return (
    <section className="mx-auto flex w-full max-w-[480px] flex-col gap-4" data-testid="swap-progress" data-status={status} aria-labelledby="swap-progress-title">
      <div>
        <h1 id="swap-progress-title" className="text-lg font-semibold">{status === 'active' ? c.progress.title : c.progress.titles[status as keyof typeof c.progress.titles] ?? c.progress.title}</h1>
        <p className="text-[13px] text-[var(--text-secondary)]">{fmt(job.amountIn, from, locale)} → {to.symbol}</p>
      </div>
      <ol className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4" aria-live="polite">
        {job.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3" data-testid={`step-${i}`} data-status={s.status}>
            <StepIcon status={s.status} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px]">{stepLabel(s.step, c, locale)}</p>
              <p className="text-[12px] text-[var(--text-muted)]">
                {c.progress.step(i + 1, job.steps.length)} · {s.status === 'done' ? c.progress.done : s.status === 'signing' ? (busy ? c.progress.signing : c.progress.unknown) : s.status === 'unknown' ? c.progress.unknown : s.status === 'failed' ? c.progress.failed : s.status === 'refunded' ? c.progress.refunded : s.status === 'not_delivered' ? c.progress.notDelivered : c.progress.pending}
                {s.txHash && <> · <a className="underline" href={txUrl(s.txHash)} target="_blank" rel="noreferrer">{c.result.tx}</a></>}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {busy && <p className="text-[13px] text-[var(--text-secondary)]" role="status">{c.progress.waiting} · {c.progress.keepOpen}</p>}
      {error && <OperationError code={error === 'SWAP_QUOTE_MOVED' ? 'REVIEW_CHANGED' : error} />}
      {status === 'unknown' && <p className="rounded-[var(--radius-control)] border border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] p-3 text-[13px] text-[var(--tone-caution-fg)]" role="alert" data-testid="swap-unknown">{c.progress.unknownBody}</p>}
      {swapStep?.status === 'refunded' && <p className="rounded-[var(--radius-control)] border border-[var(--border-subtle)] p-3 text-[13px]" role="status" data-testid="swap-refunded">{c.progress.refundedBody}{wrapDone ? ` ${c.progress.partialWrap}` : ''}</p>}
      {swapStep?.status === 'not_delivered' && <p className="rounded-[var(--radius-control)] border border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] p-3 text-[13px] text-[var(--tone-caution-fg)]" role="alert">{c.progress.notDeliveredBody}</p>}
      {status === 'failed' || (status === 'partial' && swapStep?.status === 'failed') ? <p className="text-[13px] text-[var(--text-secondary)]">{c.progress.failedBody}</p> : null}

      {status === 'unknown' || job.steps.some(s => s.status === 'signing') ? (
        <Button size="lg" block disabled={busy || !deps} onClick={() => void run('resolve')} data-testid="swap-check">{c.progress.check}</Button>
      ) : idx >= 0 && status === 'active' ? (
        <>
          <Button size="lg" block disabled={busy || !deps} onClick={() => void run('next')} data-testid="swap-next">{c.progress.sign}</Button>
          {error === 'SWAP_QUOTE_MOVED' && <Button variant="secondary" block onClick={requote}>{c.progress.retryNew}</Button>}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          {wrapDone && swapStep?.status === 'refunded' && <Button size="lg" block onClick={() => onStart({ from: 'wnear', to: 'near', amount: BigInt(wrapDone.step.kind === 'wrap' ? wrapDone.step.amount : '0') })} data-testid="swap-unwrap-after">{c.progress.unwrapAfter}</Button>}
          {job.to === 'near' && out !== null && job.steps.some(s => s.step.kind === 'unwrap' && s.status === 'failed') && <Button size="lg" block onClick={() => onStart({ from: 'wnear', to: 'near', amount: BigInt(out) })}>{c.progress.unwrapAfter}</Button>}
          {swapStep?.status === 'refunded' && <Button variant="secondary" block onClick={() => onStart({ from: wrapDone ? 'wnear' : job.from, to: job.to, amount: BigInt(job.amountIn) })}>{c.progress.retryNew}</Button>}
          <Button variant="ghost" block onClick={() => { if (deps && (status === 'active')) updateSwapJob(deps.storage, job.accountId, job.id, j => ({ ...j, status: 'cancelled' })); onClose(); }} data-testid="swap-dismiss">{c.progress.dismiss}</Button>
        </div>
      )}
    </section>
  );
}

function SwapResult({ job, c, locale, onClose }: { readonly job: SwapJob; readonly c: SwapCopy; readonly locale: 'en' | 'tr'; readonly onClose: () => void }) {
  const from = SWAP_ASSETS[job.from], to = SWAP_ASSETS[job.to];
  const unwrap = job.steps.find(s => s.step.kind === 'unwrap');
  const swap = job.steps.find(s => s.step.kind === 'swap');
  const wrap = job.steps.find(s => s.step.kind === 'wrap');
  // Received = the verified amount of the LAST asset-moving step (never the estimate).
  const received = unwrap?.amount ?? swap?.amount ?? wrap?.amount ?? null;
  const txs = job.steps.filter(s => s.txHash !== null && s.step.kind !== 'register');
  return (
    <section className="mx-auto flex w-full max-w-[480px] flex-col gap-4" data-testid="swap-result" aria-labelledby="swap-result-title">
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-[var(--taply-lime)] text-[var(--taply-night)]"><Icon name="check" size={28} /></span>
        <h1 id="swap-result-title" className="text-lg font-semibold">{c.result.success}</h1>
      </div>
      <dl className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-2">
        <DetailLine label={c.result.paid} testId="result-paid">{fmt(job.amountIn, from, locale)}</DetailLine>
        <DetailLine label={to.id === 'wnear' ? c.result.receivedWnear : c.result.received} testId="result-received">{received !== null ? fmt(received, to, locale) : '—'}</DetailLine>
        <DetailLine label={c.result.network}>NEAR Mainnet</DetailLine>
        {txs.map((s, i) => <DetailLine key={i} label={`${c.result.tx} ${i + 1}`}><a className="underline" href={txUrl(s.txHash!)} target="_blank" rel="noreferrer">{c.result.view}</a></DetailLine>)}
      </dl>
      <p className="text-center text-[12px] text-[var(--text-muted)]">{c.result.proof}</p>
      <Button size="lg" block onClick={onClose} data-testid="result-done">{c.result.done}</Button>
      <Link href={'/m/activity' as Route} className="tap-target inline-flex items-center justify-center text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">{c.result.activity}</Link>
    </section>
  );
}
