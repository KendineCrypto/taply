'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { prepareMainnetPayment } from '@taply/near-client';
import type { MainnetCall, MainnetProfile } from '@taply/near-client';
import { Button } from '@/components/primitives/Button';
import { Card, ScreenHeader } from '@/components/primitives/Surface';
import { nsToDate } from '@/lib/format/time';
import { assetById, formatMainnetAmount, MAINNET_ASSETS } from '@/lib/mainnet/assets';
import type { MainnetAsset } from '@/lib/mainnet/assets';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { baseAddressUrl, nearAccountUrl } from '@/lib/mainnet/explorer';
import { FIXTURE_CODE_HASH } from '@/lib/mainnet/fixtures';
import type { MainnetRequest } from '@/lib/mainnet/fixtures';
import { useMainnetRequest, useOneClickHint } from '@/lib/mainnet/hooks';
import type { HintState } from '@/lib/mainnet/hooks';
import { BASE_USDC } from '@/lib/mainnet/oneclick/allowlist';
import type { OriginChain, RefundFormat } from '@/lib/mainnet/oneclick/allowlist';
import { ORIGIN_COPY } from '@/lib/mainnet/origin-copy';
import { validateRefundAddress } from '@/lib/mainnet/oneclick/refund-address';
import { derivePaymentView } from '@/lib/mainnet/status';
import type { PaymentState } from '@/lib/mainnet/status';
import { useMainnetWallet } from '@/lib/mainnet/wallet';
import { CallPreview, Notice, Row, short } from './bits';
import { WalletPanel } from './WalletPanel';
import { fill, useMainnetCopy, useMainnetLocale as useLocale } from '@/lib/mainnet/copy';

const nsToMs = (ns: string) => nsToDate(ns).getTime();

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function formatTime(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}

export function PayRequest({ id, after }: { readonly id: string; readonly after?: (request: MainnetRequest, open: boolean) => ReactNode }) {
  const c = useMainnetCopy();
  const { locale } = useLocale();
  const { read, refresh } = useMainnetRequest(id, true);
  const [method, setMethod] = useState<'base' | 'wallet' | null>(null);
  const [quotePrepared, setQuotePrepared] = useState(false);
  const now = useNow(5000);
  const fixtures = MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures;
  const isUsdc = read.kind === 'ok' && read.request.terms.assetId === MAINNET_ASSETS.USDC.id;
  const hint = useOneClickHint(id, isUsdc && (fixtures || quotePrepared));

  if (!MAINNET_CONFIG.ok) return <Notice tone="danger">{c.home.configBroken}</Notice>;
  if (read.kind === 'disabled') return <Notice tone="caution">{c.home.contractNotConfigured}</Notice>;
  if (read.kind === 'loading') return <Notice live>{c.pay.loading}</Notice>;
  if (read.kind === 'error') return <Notice tone="danger" live>{c.pay.readError}</Notice>;
  if (read.kind === 'not_found') return <Notice tone="danger">{c.pay.notFound}</Notice>;

  const r = read.request;
  const asset = assetById(r.terms.assetId)!;
  const open = r.status === 'OPEN' && nsToMs(r.terms.fundingExpiresAtNs) > now;

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader title={c.pay.title} />
      <Card>
        <p className="text-[13px] text-[var(--text-secondary)]">{c.pay.amount}</p>
        <p data-testid="pay-amount" className="mt-0.5 text-[2rem] font-semibold leading-tight tabular-nums">{formatMainnetAmount(r.terms.amountBaseUnits, asset, locale)}</p>
        <dl className="mt-2">
          <Row label={c.pay.merchant} mono>{r.recipientAccountId}</Row>
          {r.terms.memo !== '' && <Row label={c.pay.memo}>{r.terms.memo}</Row>}
          <Row label={c.pay.expires}>{formatTime(nsToMs(r.terms.fundingExpiresAtNs), locale)}</Row>
          <Row label={c.pay.contract} mono>{r.terms.contractId}</Row>
          <Row label={c.pay.requestId} mono>{short(r.terms.id, 12, 12)}</Row>
        </dl>
        <p className="mt-2 text-[12px] text-[var(--text-muted)]">{c.pay.fixedNote}</p>
      </Card>

      <PaymentStatusPanel request={r} readAtMs={read.readAtMs} hint={hint} onRefresh={refresh} />
      {after?.(r, open)}

      {open ? (
        <Card>
          <h2 className="mb-2 text-[15px] font-semibold">{c.pay.methodTitle}</h2>
          {asset.symbol === 'NEAR' && <p className="mb-2 text-[13px] text-[var(--text-secondary)]">{c.pay.methodNativeOnly}</p>}
          <div className="flex flex-col gap-2" role="group" aria-label={c.pay.methodTitle}>
            {asset.symbol === 'USDC' && (
              <MethodButton active={method === 'base'} onClick={() => setMethod('base')} title={c.pay.methodBase} hint={c.pay.methodBaseHint} testId="method-base" />
            )}
            <MethodButton active={method === 'wallet'} onClick={() => setMethod('wallet')} title={c.pay.methodWallet} hint={c.pay.methodWalletHint} testId="method-wallet" />
          </div>
        </Card>
      ) : (
        <Notice tone="muted">{c.pay.notPayable}</Notice>
      )}

      {open && method === 'base' && asset.symbol === 'USDC' && (
        fixtures ? <IntentsCheckout request={r} onPrepared={() => setQuotePrepared(true)} /> : <Notice tone="caution" testId="router-disabled">{c.pay.routerDisabled}</Notice>
      )}
      {open && method === 'wallet' && <WalletPayReview request={r} asset={asset} />}
    </div>
  );
}

function MethodButton(props: { active: boolean; onClick: () => void; title: string; hint: string; testId: string }) {
  return (
    <button
      type="button"
      data-testid={props.testId}
      aria-pressed={props.active}
      onClick={props.onClick}
      className={`pressable w-full rounded-[var(--radius-control)] border px-3.5 py-3 text-left ${props.active ? 'border-[var(--taply-lime)] bg-[var(--tone-success-bg)]' : 'border-[var(--border-subtle)]'}`}
    >
      <span className="block text-[15px] font-semibold">{props.title}</span>
      <span className="mt-0.5 block text-[13px] text-[var(--text-secondary)]">{props.hint}</span>
    </button>
  );
}

function profileFor(request: MainnetRequest): MainnetProfile | null {
  if (!MAINNET_CONFIG.ok) return null;
  if (MAINNET_CONFIG.profile !== null) return MAINNET_CONFIG.profile;
  if (!MAINNET_CONFIG.fixtures) return null;
  return { network: 'near-mainnet', rpcUrl: MAINNET_CONFIG.rpcUrl, rpcProviderId: MAINNET_CONFIG.rpcProviderId, contract: { accountId: request.terms.contractId, expectedCodeHash: FIXTURE_CODE_HASH } };
}

/** Pay with a NEAR wallet: shows the exact unsigned call (shared recipient message for USDC). Signing is gated off. */
function WalletPayReview({ request, asset }: { request: MainnetRequest; asset: MainnetAsset }) {
  const c = useMainnetCopy();
  const wallet = useMainnetWallet();
  const now = useNow(5000);
  const profile = profileFor(request);
  let call: MainnetCall | null = null;
  if (profile !== null && wallet.accountId !== null) {
    try {
      call = prepareMainnetPayment({
        profile,
        terms: request.terms,
        status: request.status,
        termsHash: request.termsHash,
        signerAccountId: wallet.accountId,
        observedAtNs: (BigInt(now) * 1_000_000n).toString(),
      });
    } catch {
      call = null;
    }
  }
  return (
    <Card>
      <h2 className="mb-2 text-[15px] font-semibold">{c.pay.methodWallet}</h2>
      <WalletPanel />
      {call !== null && <div className="mt-3"><CallPreview call={call} title={c.create.callTitle} /></div>}
      <div className="mt-3 flex flex-col gap-2">
        <Button variant="primary" size="lg" block disabled aria-describedby="wallet-signing-off">
          {c.create.sign} · {asset.symbol}
        </Button>
        <p id="wallet-signing-off" className="text-[13px] text-[var(--tone-caution-fg)]">{c.wallet.signingDisabled}</p>
      </div>
    </Card>
  );
}

interface PreparedQuote {
  readonly mode: 'fixture' | 'dry' | 'funded';
  readonly amountInFormatted: string;
  readonly amountOut: string;
  readonly deadline: string;
  readonly timeEstimateSec: number | null;
  readonly refundTo: string;
  readonly recipient: string;
  readonly deposit: null;
  readonly signatureVerified: true;
  readonly reused: boolean;
}

interface PublicOrigin {
  readonly assetId: string;
  readonly chain: OriginChain;
  readonly symbol: 'USDC' | 'USDT';
  readonly contractAddress: string;
  readonly refundAddressFormat: RefundFormat;
  readonly source: 'recorded-live-quote' | 'live-token-list' | 'fixture';
}

/** Server-resolved origins (Base, plus Solana/Tron only when 1Click lists them identically). */
function useOrigins(): ReadonlyArray<PublicOrigin> | null {
  const [origins, setOrigins] = useState<ReadonlyArray<PublicOrigin> | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/mainnet/oneclick/origins', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ origins: PublicOrigin[] }>) : { origins: [] }))
      .then((b) => live && setOrigins(Array.isArray(b.origins) ? b.origins : []))
      .catch(() => live && setOrigins([]));
    return () => {
      live = false;
    };
  }, []);
  return origins;
}

/** Customer selects Base USDC, enters a refund address, gets a verified quote and reviews instructions. */
export function IntentsCheckout({ request, onPrepared }: { request: MainnetRequest; onPrepared: () => void }) {
  const c = useMainnetCopy();
  const { locale } = useLocale();
  const [refund, setRefund] = useState('');
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<PreparedQuote | null>(null);
  const now = useNow(1000);
  const oc = ORIGIN_COPY[locale];
  const origins = useOrigins();
  const [picked, setPicked] = useState<string>(BASE_USDC.assetId);
  const origin: PublicOrigin = origins?.find((o) => o.assetId === picked) ?? { assetId: BASE_USDC.assetId, chain: 'base', symbol: 'USDC', refundAddressFormat: 'evm', contractAddress: BASE_USDC.contractAddress, source: 'recorded-live-quote' };
  const check = validateRefundAddress(origin, refund);

  async function prepare() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/mainnet/oneclick/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: request.terms.id, originAsset: origin.assetId, refundTo: refund.trim() }),
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => ({}))) as Partial<PreparedQuote> & { error?: string };
      if (!res.ok || body.error !== undefined) {
        setError(body.error ?? 'UNKNOWN');
        return;
      }
      // Defence in depth: the browser also refuses anything that is not the exact principal to the pinned contract.
      if (body.amountOut !== request.terms.amountBaseUnits || body.recipient !== request.terms.contractId || body.deposit !== null) {
        setError('QUOTE_REJECTED');
        return;
      }
      setQuote(body as PreparedQuote);
      onPrepared();
    } catch {
      setError('UPSTREAM_UNAVAILABLE');
    } finally {
      setPending(false);
    }
  }

  const remaining = quote === null ? 0 : Date.parse(quote.deadline) - now;

  return (
    <Card>
      <h2 className="text-[15px] font-semibold">{c.intents.title}</h2>
      <p className="mt-1 text-[13px] text-[var(--text-secondary)]">{c.intents.lead}</p>

      {quote === null ? (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (check.ok && !pending) void prepare();
          }}
        >
          <fieldset>
            <legend className="mb-1.5 text-[13px] text-[var(--text-secondary)]">{c.intents.sourceLabel}</legend>
            {origins === null ? (
              <p className="text-[13px] text-[var(--text-secondary)]">{oc.loading}</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" data-testid="origin-picker">
                {(origins.length > 0 ? origins : [origin]).map((o) => (
                  <label key={o.assetId} className={`pressable flex min-h-[var(--tap-target)] cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border px-3 text-[15px] font-semibold ${o.assetId === origin.assetId ? 'border-[var(--taply-lime)] bg-[var(--tone-success-bg)]' : 'border-[var(--border-subtle)]'}`}>
                    <input type="radio" name="source" value={o.assetId} data-chain={o.chain} checked={o.assetId === origin.assetId} onChange={() => { setPicked(o.assetId); setRefund(''); setTouched(false); setError(null); }} className="accent-[var(--taply-lime)]" />
                    {o.symbol} · {oc.chain[o.chain]}
                  </label>
                ))}
              </div>
            )}
            {origins?.some((o) => o.source === 'fixture') && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{oc.fixture}</p>}
          </fieldset>
          <div>
            <label htmlFor="refund" className="text-[13px] text-[var(--text-secondary)]">{oc.refundLabel[origin.refundAddressFormat]}</label>
            <input
              id="refund"
              value={refund}
              onChange={(e) => setRefund(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={oc.refundPlaceholder[origin.refundAddressFormat]}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={touched && !check.ok}
              aria-describedby="refund-help"
              className="mt-1 min-h-[var(--tap-target)] w-full rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] px-3 font-mono text-[13px]"
            />
            <p id="refund-help" className="mt-1 text-[12px] text-[var(--text-muted)]">{c.intents.refundHint.replace('Base', oc.chain[origin.chain])} {origin.refundAddressFormat === 'solana' ? oc.solanaNote : origin.refundAddressFormat === 'tron' ? oc.tronNote : ''}</p>
            {touched && refund !== '' && !check.ok && <p role="alert" className="mt-1 text-[13px] text-[var(--tone-danger-fg)]">{check.reason === 'format' ? oc.refundFormat[origin.refundAddressFormat] : c.intents.refundErrors[check.reason]}</p>}
          </div>
          <Button type="submit" variant="primary" size="lg" block disabled={pending || !check.ok} data-testid="get-quote">
            {pending ? c.intents.preparing : c.intents.prepare}
          </Button>
          {error !== null && (
            <Notice tone="danger" live testId="quote-error">
              {c.intents.errors[error] ?? c.intents.errorFallback}
            </Notice>
          )}
        </form>
      ) : (
        <div className="mt-3 flex flex-col gap-3" data-testid="quote-review">
          <h3 className="text-[14px] font-semibold">{c.intents.reviewTitle}</h3>
          {quote.mode === 'fixture' && <Notice tone="muted">{c.intents.fixtureQuote}</Notice>}
          {quote.mode === 'dry' && <Notice tone="muted">{c.intents.dryQuote}</Notice>}
          {quote.reused && <Notice tone="muted">{c.intents.reused}</Notice>}
          <dl>
            <Row label={fill(oc.send, { chain: oc.chain[origin.chain] })}>{quote.amountInFormatted} {origin.symbol} · {oc.chain[origin.chain]}</Row>
            <Row label={c.intents.merchantGets}>{formatMainnetAmount(quote.amountOut, MAINNET_ASSETS.USDC, locale)}</Row>
            <Row label={c.intents.toContract} mono>{quote.recipient}</Row>
            <Row label={c.intents.deadline}>
              {remaining > 0 ? `${formatTime(Date.parse(quote.deadline), locale)} · ${fill(c.intents.remaining, { time: `${Math.floor(remaining / 60_000)}:${String(Math.floor((remaining % 60_000) / 1000)).padStart(2, '0')}` })}` : c.intents.expired}
            </Row>
            {quote.timeEstimateSec !== null && <Row label={c.intents.estimate}>~{quote.timeEstimateSec} s</Row>}
            <Row label={c.intents.refundTo} mono>
              {baseAddressUrl(quote.refundTo) !== null ? <a className="underline" href={baseAddressUrl(quote.refundTo)!} target="_blank" rel="noreferrer noopener">{quote.refundTo}</a> : quote.refundTo}
            </Row>
          </dl>
          <Notice tone="success">{c.intents.verifiedLine}</Notice>
          <div data-testid="deposit-withheld" className="rounded-[var(--radius-control)] border border-dashed border-[var(--tone-caution-border)] p-4 text-center">
            <p className="text-[14px] font-semibold text-[var(--tone-caution-fg)]">{c.intents.depositHidden}</p>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">{c.intents.depositHiddenDetail}</p>
          </div>
          <p className="text-[12px] text-[var(--text-muted)]">{c.intents.feeNote} {c.intents.originNotVerified}</p>
        </div>
      )}
    </Card>
  );
}

const STATE_TONE: Readonly<Record<PaymentState, 'neutral' | 'caution' | 'danger' | 'success' | 'muted'>> = {
  AWAITING_PAYMENT: 'neutral',
  DEPOSIT_OBSERVED: 'neutral',
  PROCESSING: 'neutral',
  // Recorded is contract-state only: deliberately NOT the green "verified" tone.
  PAYMENT_RECORDED: 'neutral',
  VERIFIED: 'success',
  FAILED: 'danger',
  REFUNDED: 'caution',
  UNKNOWN: 'caution',
};

export function PaymentStatusPanel({ request, readAtMs, hint, onRefresh }: { request: MainnetRequest; readAtMs: number; hint: HintState | null; onRefresh: () => void }) {
  const c = useMainnetCopy();
  const { locale } = useLocale();
  const now = useNow(5000);
  const op = request.latestOperation;
  const view = derivePaymentView({
    contract: { status: request.status, readAtMs, inFlightSinceMs: op !== null && request.status === 'PAYOUT_IN_FLIGHT' ? nsToMs(op.startedAtNs) : null },
    oneClick: hint !== null && hint.status !== null ? { status: hint.status, sinceMs: hint.sinceMs } : null,
    nowMs: now,
  });
  const contractUrl = nearAccountUrl(request.terms.contractId);
  return (
    <Card>
      <h2 className="text-[13px] text-[var(--text-secondary)]">{c.status.title}</h2>
      <div className="mt-2">
        <Notice tone={STATE_TONE[view.state]} live testId="payment-state">
          <p className="text-[17px] font-semibold" data-state={view.state}>{c.status.states[view.state]}</p>
          {c.status.details[view.detail] !== '' && <p className="mt-1 text-[13px] text-[var(--text-secondary)]">{c.status.details[view.detail]}</p>}
        </Notice>
      </div>
      {view.doNotRepay && <p role="alert" data-testid="do-not-repay" className="mt-2 text-[14px] font-semibold text-[var(--tone-caution-fg)]">{c.status.doNotRepay}</p>}
      {view.state === 'PAYMENT_RECORDED' && <p className="mt-2 text-[12px] text-[var(--text-muted)]">{c.status.recordedLimit}</p>}
      <p data-testid="verified-unavailable" className="mt-1 text-[12px] text-[var(--text-muted)]">{c.status.verifiedUnavailable}</p>
      <dl className="mt-2">
        <Row label={c.status.contractLabel} mono>{request.status}</Row>
        <Row label={c.status.hintLabel} mono>{hint?.status ?? c.status.hintNone}</Row>
        {hint?.refundTo && <Row label={c.status.refundAddress} mono>{hint.refundTo}</Row>}
        {hint?.refundedAmountFormatted && <Row label={c.status.refundedAmount}>{hint.refundedAmountFormatted} USDC</Row>}
        {(hint?.originTxs ?? []).map((tx) => (
          <Row key={tx.hash} label={c.status.originTx} mono>{tx.url ? <a className="underline" href={tx.url} target="_blank" rel="noreferrer noopener">{short(tx.hash)}</a> : short(tx.hash)}</Row>
        ))}
        {(hint?.nearTxs ?? []).map((tx) => (
          <Row key={tx.hash} label={c.status.nearTx} mono>{tx.url ? <a className="underline" href={tx.url} target="_blank" rel="noreferrer noopener">{short(tx.hash)}</a> : short(tx.hash)}</Row>
        ))}
      </dl>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-[var(--text-muted)]">{fill(c.status.lastChecked, { time: formatTime(readAtMs, locale) })}</p>
        <div className="flex gap-2">
          {contractUrl !== null && <a className="tap-target inline-flex items-center text-[13px] underline" href={contractUrl} target="_blank" rel="noreferrer noopener">{c.status.viewContract}</a>}
          <Button variant="ghost" onClick={onRefresh}>{c.status.refresh}</Button>
        </div>
      </div>
    </Card>
  );
}
