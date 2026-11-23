'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { QrCode } from '@/components/payments/QrCode';
import { ASSETS, CHAINS, normalized, parseAmount, formatAmount, PublicSession, txLink, type Chain, type PublicQuote, type PublicSession as Session } from '@/lib/mainnet/crosschain/model';
import { api, checkedQuote, ownerSecret, PENDING_KEY, saveResult } from '@/lib/mainnet/crosschain/client';
import { crossEn, crossTr } from '@/lib/mainnet/crosschain/copy';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { useCurrentMainnetAccount } from '../MainnetShell';
const control = 'min-h-12 w-full rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 text-[var(--text-primary)]';
export function CrosschainSwap() {
  const { locale } = useMainnetLocale(); const c = locale === 'tr' ? crossTr : crossEn;
  const { accountId } = useCurrentMainnetAccount();
  const [from, setFrom] = useState<Chain>('base'), [to, setTo] = useState<Chain>('near');
  const [amount, setAmount] = useState(''), [recipient, setRecipient] = useState(''), [refundTo, setRefund] = useState('');
  const [slippageBps, setSlippage] = useState(50);
  const [quote, setQuote] = useState<PublicQuote | null>(null), [session, setSession] = useState<Session | null>(null);
  const [secret, setSecret] = useState<string | null>(null), [pending, setPending] = useState(false), [busy, setBusy] = useState(false), [review, setReview] = useState(false);
  const [mode, setMode] = useState('off'), [error, setError] = useState(''), [memoOk, setMemoOk] = useState(false), [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now()); const sequence = useRef(0), mounted = useRef(true), polling = useRef(false), generation = useRef(0);
  const invalidate = () => { sequence.current++; setQuote(null); setReview(false); setBusy(false); setError(''); };
  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => { if (!mounted.current) return; try { setSecret(ownerSecret(localStorage)); setPending(localStorage.getItem(PENDING_KEY) === '1'); } catch { setError(c.storage); } });
    void fetch('/api/mainnet/crosschain', { cache: 'no-store' }).then(r => r.json()).then(v => { if (mounted.current) setMode(typeof v.mode === 'string' ? v.mode : 'off'); }).catch(() => {});
    const storage = () => { try { setPending(localStorage.getItem(PENDING_KEY) === '1'); } catch { setError(c.storage); } };
    window.addEventListener('storage', storage);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener('storage', storage); };
  }, [c.storage]);
  const message = useCallback((e: unknown) => { const code = e instanceof Error ? e.message : ''; return c.errors[code as keyof typeof c.errors] ?? c.errors.SERVICE_UNAVAILABLE; }, [c]);
  const refresh = useCallback(async () => {
    if (!secret || polling.current) return;
    polling.current = true; const epoch = generation.current;
    try {
      const value = await api('session', { secret });
      if (!mounted.current || epoch !== generation.current) return;
      if (value === null) { localStorage.removeItem(PENDING_KEY); setPending(false); setSession(null); }
      else { const s = PublicSession.parse(value); setSession(s); setPending(true); localStorage.setItem(PENDING_KEY, '1'); if (s.proof?.state === 'verified' || s.refundProof?.state === 'verified') saveResult(localStorage, s); }
      setError('');
    } catch (e) { if (mounted.current && epoch === generation.current) setError(message(e)); } finally { polling.current = false; }
  }, [secret, message]);
  useEffect(() => {
    if (!secret || mode === 'off') return;
    queueMicrotask(() => { if (mounted.current) void refresh(); });
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, pending ? 12000 : 60000);
    return () => clearInterval(timer);
  }, [secret, mode, pending, refresh]);
  async function getQuote() {
    if (!secret) return; const seq = ++sequence.current; setBusy(true); setError(''); setQuote(null);
    try {
      const units = parseAmount(amount); if (!units) throw new Error('INVALID_INPUT');
      const input = normalized({ from, to, amount: units, recipient: recipient || (to === 'near' ? accountId : ''), refundTo: refundTo || (from === 'near' ? accountId : ''), slippageBps });
      const raw = await api('quote', { secret, input, fund: false });
      if (mounted.current && seq === sequence.current) setQuote(checkedQuote(raw, input, false));
    } catch (e) { if (seq === sequence.current) setError(message(e)); }
    finally { if (seq === sequence.current) setBusy(false); }
  }
  async function fund() {
    if (!secret || !quote || busy || mode !== 'funded') return;
    if (Date.parse(quote.deadline) <= Date.now() + 30000 || Date.now() - quote.createdAt > 120000) { setError(c.errors.QUOTE_EXPIRED); return; }
    setBusy(true); setError('');
    try {
      // Persist BEFORE the network call. Lost responses resume; they do not
      // enable a second fundable quote on a refresh or in another tab.
      localStorage.setItem(PENDING_KEY, '1'); setPending(true);
      const raw = await api('quote', { secret, input: quote.input, fund: true, approvedMinimum: quote.minAmountOut });
      const q = checkedQuote(raw, quote.input, true);
      setSession({ quote: q, state: 'ready', upstream: 'PENDING_DEPOSIT', proof: null, refundProof: null }); setReview(false);
    } catch (e) { setError(message(e)); await refresh(); }
    finally { setBusy(false); }
  }
  const q = session?.quote; const verified = session?.proof?.state === 'verified'; const refunded = session?.refundProof?.state === 'verified';
  const title = verified ? c.verified : refunded ? c.refunded : session?.state === 'uncertain' ? c.failed : session?.upstream === 'SUCCESS' ? c.reported : session?.upstream === 'REFUNDED' ? c.refundReported : session?.upstream === 'PENDING_DEPOSIT' ? c.waiting : c.progress;
  if (pending || session) return <section className="mx-auto flex w-full max-w-[480px] flex-col gap-4" data-testid="crosschain-progress">
    <h1 className="text-xl font-semibold">{session ? title : c.pending}</h1>
    {q && <div className="surface-card flex flex-col gap-3 p-5">
      <p className="text-lg font-semibold">{formatAmount(q.amountIn)} USDC · {ASSETS[q.input.from].name} → {ASSETS[q.input.to].name}</p>
      <p className="break-all text-xs text-[var(--text-secondary)]">{c.recipient}: {q.input.recipient}</p>
      <p className="break-all text-xs text-[var(--text-secondary)]">{c.refund}: {q.input.refundTo}</p>
      {session?.upstream === 'PENDING_DEPOSIT' && now < Date.parse(q.deadline) && q.deposit && <>
        <p className="font-semibold">{c.only} {ASSETS[q.input.from].name}</p>
        <p className="text-sm">{formatAmount(q.amountIn)} USDC</p>
        {q.memo && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={memoOk} onChange={e => setMemoOk(e.target.checked)} />{c.memo}: <code className="break-all">{q.memo}</code> — {c.memoConfirm}</label>}
        {(!q.memo || memoOk) && <><div className="self-center"><QrCode value={q.deposit} label={c.address} /></div><p className="break-all rounded-xl bg-[var(--surface-0)] p-3 font-mono text-xs">{q.deposit}</p><Button variant="secondary" block onClick={() => { void navigator.clipboard.writeText(q.deposit ?? '').then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? c.copied : c.copy}</Button><p className="text-xs text-[var(--text-secondary)]">{c.qr}</p></>}
        <p className="text-xs">{c.deadline}: {new Date(q.deadline).toLocaleString(locale)}</p><p className="text-sm">{c.noResend}</p>
      </>}
      {now >= Date.parse(q.deadline) && !verified && !refunded && <p role="status" className="text-sm">{c.expired}</p>}
      {(verified || refunded) && <><p className="text-3xl font-semibold text-[var(--taply-lime)]">{formatAmount((verified ? session?.proof?.amount : session?.refundProof?.amount) ?? '0')} USDC</p><p className="text-xs text-[var(--text-secondary)]">{c.proof}</p></>}
      {session?.upstream && <p className="text-xs">{c.provider}: {session.upstream}</p>}
      {session?.upstream === 'SUCCESS' && !verified && <p className="text-sm">{c.pendingProof}</p>}
      {[session?.proof, session?.refundProof].flatMap(p => p?.txs.map(hash => ({ hash, chain: p.chain })) ?? []).map(t => { const url = txLink(t.chain, t.hash); return url ? <a key={t.hash} className="text-sm underline" target="_blank" rel="noreferrer" href={url}>{c.view} · {ASSETS[t.chain].name}</a> : null; })}
    </div>}
    {!verified && !refunded && (!session || session.state === 'uncertain') && <p className="text-sm text-[var(--text-secondary)]">{c.uncertain}</p>}
    {error && <p role="alert" className="text-sm text-[var(--tone-danger-fg)]">{error}</p>}
    <Button block variant="secondary" onClick={() => void refresh()}>{c.check}</Button>
    {(verified || refunded) && <Button block onClick={() => { if (!secret) return; generation.current++; setBusy(true); void api('archive', { secret }).then(() => { localStorage.removeItem(PENDING_KEY); setPending(false); setSession(null); setQuote(null); setAmount(''); }).catch(e => setError(message(e))).finally(() => setBusy(false)); }} disabled={busy}>{c.done}</Button>}
  </section>;
  return <section className="mx-auto flex w-full max-w-[480px] flex-col gap-3" data-testid="crosschain-swap">
    <h1 className="text-lg font-semibold">{c.title}</h1>
    <div className="surface-card p-4"><label className="text-sm text-[var(--text-secondary)]" htmlFor="cross-from">{c.pay}</label><select id="cross-from" aria-label={`${c.pay} ${c.network}`} className={`${control} mt-2`} value={from} onChange={e => { invalidate(); const chain = e.target.value as Chain; setFrom(chain); if (chain === to) setTo(from); setRefund(''); setRecipient(''); }}>{CHAINS.map(chain => <option key={chain} value={chain}>USDC · {ASSETS[chain].name}</option>)}</select><input aria-label={c.amount} className="mt-3 w-full min-w-0 bg-transparent text-3xl outline-none" inputMode="decimal" placeholder="0.00" value={amount} onChange={e => { invalidate(); setAmount(e.target.value); }} /></div>
    <button type="button" aria-label={c.flip} className="tap-target self-center rounded-full bg-[var(--surface-2)] px-4" onClick={() => { invalidate(); setFrom(to); setTo(from); setRecipient(''); setRefund(''); }}>↓↑</button>
    <div className="surface-card p-4"><label className="text-sm text-[var(--text-secondary)]" htmlFor="cross-to">{c.receive}</label><select id="cross-to" aria-label={`${c.receive} ${c.network}`} className={`${control} mt-2`} value={to} onChange={e => { invalidate(); const chain = e.target.value as Chain; setTo(chain); if (chain === from) setFrom(to); setRefund(''); setRecipient(''); }}>{CHAINS.map(chain => <option key={chain} value={chain}>USDC · {ASSETS[chain].name}</option>)}</select><output className="mt-3 block text-3xl" aria-live="polite">{quote ? formatAmount(quote.amountOut) : '0.00'}</output></div>
    <label className="text-sm" htmlFor="cross-recipient">{c.recipient}</label><input id="cross-recipient" className={control} autoComplete="off" spellCheck={false} placeholder={to === 'near' ? accountId ?? 'account.near' : ASSETS[to].name} value={recipient} onChange={e => { invalidate(); setRecipient(e.target.value); }} /><p className="px-1 text-xs text-[var(--text-secondary)]">{c.recipientHint}</p>
    <label className="text-sm" htmlFor="cross-refund">{c.refund}</label><input id="cross-refund" className={control} autoComplete="off" spellCheck={false} placeholder={from === 'near' ? accountId ?? 'account.near' : ASSETS[from].name} value={refundTo} onChange={e => { invalidate(); setRefund(e.target.value); }} /><p className="px-1 text-xs text-[var(--text-secondary)]">{c.refundHint}</p>
    <details className="px-1 text-sm"><summary>Slippage</summary><select className={control} aria-label="Slippage" value={slippageBps} onChange={e => { invalidate(); setSlippage(e.target.value === '300' ? 300 : e.target.value === '100' ? 100 : 50); }}><option value={50}>0.5%</option><option value={100}>1%</option><option value={300}>3%</option></select></details>
    {quote && <div className="surface-card space-y-2 p-4 text-sm"><p>{c.minimum}: {formatAmount(quote.minAmountOut)} USDC</p>{quote.estimate !== null && <p>{c.estimate}: ~{quote.estimate}s</p>}<p className="text-xs text-[var(--text-secondary)]">{c.fees}</p>{review && <><p className="break-all">{ASSETS[quote.input.from].name} → {ASSETS[quote.input.to].name}</p><p className="break-all">{c.recipient}: {quote.input.recipient}</p><p className="break-all">{c.refund}: {quote.input.refundTo}</p></>}</div>}
    {error && <p role="alert" className="text-sm text-[var(--tone-danger-fg)]">{error}</p>}
    {quote && review ? <><Button size="lg" block disabled={busy || mode !== 'funded'} onClick={() => void fund()}>{c.confirm}</Button><Button block variant="ghost" onClick={() => setReview(false)}>{c.back}</Button></> : quote ? <Button size="lg" block disabled={busy} onClick={() => setReview(true)}>{c.review}</Button> : <Button size="lg" block disabled={!secret || busy || !parseAmount(amount) || mode === 'off'} onClick={() => void getQuote()}>{busy ? c.loading : c.quote}</Button>}
    {mode !== 'funded' && <p className="text-xs text-[var(--text-secondary)]">{c.readOnly}</p>}
    <p className="px-1 text-center text-xs text-[var(--text-muted)]">{c.attribution}</p>
  </section>;
}
