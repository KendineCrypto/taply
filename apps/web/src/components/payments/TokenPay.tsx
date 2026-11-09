'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createSwapReader,
  DEFAULT_SLIPPAGE_BPS,
  prepareBuyToken,
  prepareSellTokenForNear,
  prepareTokenRegistration,
  quoteExactNearForToken,
  quoteTokenForExactNear,
  SwapError,
} from '@taply/near-client';
import type { PreparedSwapTransaction, SellQuote, SwapRoute, SwapSnapshot } from '@taply/near-client';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Button, Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { formatBaseUnits } from '@/lib/format/amount';
import { fill } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n/provider';
import { CHAIN_CONFIG } from '@/lib/near/config';
import { getNearClient } from '@/lib/near/client';
import type { SignOutcome, WalletCall } from '@/lib/wallet/adapter';

/**
 * "Pay with <asset>" for a NEAR request (owner request 2026-11-09): the merchant
 * asks for NEAR and never picks the payer's asset; the payer chooses NEAR or one
 * of the curated Testnet tokens (TESTNET_SWAP_ROUTES).
 *
 * Step 1 converts the token to native NEAR on Rhea (Ref) Testnet with a
 * separate, clearly labelled wallet approval; step 2 is the unchanged, reviewed
 * NEAR payment below. The recipient always receives exactly the requested NEAR.
 * Nothing here is called "paid": success means a FINAL swap without failed
 * receipts, and the screen then re-reads balances.
 */

export type SwapTxResult = 'success' | 'failed' | 'pending';

export interface TokenPayDeps {
  readonly read: (payerAccountId: string) => Promise<SwapSnapshot>;
  readonly observe: (transactionHash: string, signerAccountId: string) => Promise<SwapTxResult>;
  readonly sleep: (ms: number) => Promise<void>;
}

function defaultDeps(route: SwapRoute): TokenPayDeps | null {
  if (!CHAIN_CONFIG.ok) return null;
  const reader = createSwapReader(CHAIN_CONFIG.client, undefined, route);
  const client = getNearClient();
  if (client === null) return null;
  return {
    read: (payer) => reader.read(payer),
    async observe(transactionHash, signerAccountId) {
      const { observation } = await client.observeTransaction({ transactionHash, signerAccountId });
      const tx = observation.data;
      if (tx === null || tx.executionFinality !== 'FINAL' || !tx.outcomeGraphComplete) return 'pending';
      // ft_transfer_call itself succeeds even when Ref's swap panics (the token
      // refunds), so ANY failed receipt means the conversion did not happen.
      const failed = [tx.transactionOutcome, ...tx.receiptOutcomes].some((o) => o.status.kind === 'FAILURE');
      return failed ? 'failed' : 'success';
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/** NEAR to spend for "Get test USDC": enough for the payment plus a 5% margin (min 0.1 NEAR). */
export function testUsdcPurchaseNear(amountYocto: bigint): bigint {
  const withMargin = (amountYocto * 105n) / 100n;
  const step = 10n ** 22n; // round up to 0.01 NEAR
  const rounded = ((withMargin + step - 1n) / step) * step;
  return rounded < 10n ** 23n ? 10n ** 23n : rounded;
}

function toWalletCall(tx: PreparedSwapTransaction): WalletCall {
  const [first, ...rest] = tx.actions;
  if (first === undefined) throw new SwapError('INVALID_AMOUNT');
  return { receiverId: tx.receiverId, ...first, ...(rest.length > 0 ? { actions: tx.actions } : {}) };
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'wallet' }
  | { readonly kind: 'confirming' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'converted' };

export function TokenPay({
  route,
  amountYocto,
  signerAccountId,
  signAndSend,
  onConverted,
  deps: injected,
}: {
  readonly route: SwapRoute;
  readonly amountYocto: string;
  readonly signerAccountId: string;
  readonly signAndSend: (call: WalletCall) => Promise<SignOutcome>;
  /** Called after a confirmed conversion so the NEAR balance is re-read. */
  readonly onConverted?: () => void;
  readonly deps?: TokenPayDeps | null;
}) {
  const t = useT();
  const u = t.tokenPay;
  const sym = { symbol: route.symbol };
  const { locale } = useLocale();
  const deps = useMemo(() => (injected === undefined ? defaultDeps(route) : injected), [injected, route]);
  const [snapshot, setSnapshot] = useState<SwapSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (deps === null) return;
    const mine = ++generation.current;
    setLoadError(null);
    try {
      const next = await deps.read(signerAccountId);
      if (mine === generation.current) setSnapshot(next);
    } catch (error) {
      if (mine !== generation.current) return;
      setSnapshot(null);
      setLoadError(error instanceof SwapError && error.code === 'PRICE_IMPACT_TOO_HIGH' ? u.priceImpact : fill(u.loadFailed, { symbol: route.symbol }));
    }
  }, [deps, signerAccountId, u.loadFailed, u.priceImpact, route.symbol]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial chain read
    void load();
  }, [load]);
  useEffect(() => {
    const gen = generation;
    // Results that arrive after unmount are dropped.
    return () => {
      gen.current++;
    };
  }, []);

  const tokenAmount = (base: string) => formatBaseUnits(base, route.decimals, { locale, maxFractionDigits: 4 }).display;
  const near = (base: string | bigint) => formatBaseUnits(base.toString(), 24, { locale, maxFractionDigits: 4 }).display;

  let quote: SellQuote | null = null;
  let quoteProblem: string | null = null;
  if (snapshot !== null) {
    try {
      quote = quoteTokenForExactNear(snapshot, amountYocto, DEFAULT_SLIPPAGE_BPS);
    } catch (error) {
      quoteProblem = error instanceof SwapError && error.code === 'PRICE_IMPACT_TOO_HIGH' ? u.priceImpact : fill(u.loadFailed, sym);
    }
  }
  const purchaseNear = testUsdcPurchaseNear(BigInt(amountYocto));

  const run = async (tx: PreparedSwapTransaction, convert: boolean) => {
    if (deps === null) return;
    setPhase({ kind: 'wallet' });
    let outcome: SignOutcome;
    try {
      outcome = await signAndSend(toWalletCall(tx));
    } catch {
      setPhase({ kind: 'unknown' });
      return;
    }
    if (outcome.kind !== 'submitted') {
      setPhase({ kind: 'unknown' });
      return;
    }
    setPhase({ kind: 'confirming' });
    for (let i = 0; i < 40; i++) {
      let result: SwapTxResult = 'pending';
      try {
        result = await deps.observe(outcome.transactionHash, signerAccountId);
      } catch {
        result = 'pending';
      }
      if (result === 'success') {
        await load();
        if (convert) {
          setPhase({ kind: 'converted' });
          onConverted?.();
        } else setPhase({ kind: 'idle' });
        return;
      }
      if (result === 'failed') {
        await load();
        setPhase({ kind: 'failed' });
        return;
      }
      await deps.sleep(1_500);
    }
    setPhase({ kind: 'unknown' });
  };

  const busy = phase.kind === 'wallet' || phase.kind === 'confirming';
  const tokenBalance = snapshot === null ? 0n : BigInt(snapshot.payer.tokenBalance);
  const enough = quote !== null && tokenBalance >= BigInt(quote.tokenIn);

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-control)] p-4 ring-1 ring-[var(--border-strong)]" aria-labelledby="token-pay-title">
      <div>
        <h3 id="token-pay-title" className="font-semibold">
          {fill(u.title, sym)}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{fill(u.body, sym)}</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{fill(u.tokenLabel, { symbol: route.symbol, token: route.token })}</p>
      </div>

      {deps === null || loadError !== null ? (
        <InlineNotice
          copy={{ title: fill(u.title, sym), body: loadError ?? fill(u.loadFailed, sym) }}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              <Icon name="refresh" size={16} />
              {t.common.retry}
            </Button>
          }
        />
      ) : snapshot === null ? (
        <p role="status" className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Spinner /> {u.confirming}
        </p>
      ) : (
        <>
          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">{u.merchantGets}</dt>
              <dd className="font-semibold">{near(amountYocto)} NEAR</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">{fill(u.yourBalance, sym)}</dt>
              <dd>
                {tokenAmount(snapshot.payer.tokenBalance)} {route.symbol}
              </dd>
            </div>
          </dl>
          {quoteProblem !== null ? (
            <p role="alert" className="text-sm text-[var(--tone-caution-fg)]">
              {quoteProblem}
            </p>
          ) : quote !== null ? (
            <div className="flex flex-col gap-1" aria-live="polite">
              <p className="text-base font-semibold">{fill(u.quote, { amount: tokenAmount(quote.tokenIn), symbol: route.symbol, near: near(quote.minNearOut) })}</p>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                {fill(u.quoteNote, { slippage: (DEFAULT_SLIPPAGE_BPS / 100).toString(), symbol: route.symbol })}
              </p>
            </div>
          ) : null}

          {phase.kind === 'converted' ? (
            <p role="status" className="flex items-start gap-2 text-sm font-medium text-[var(--taply-lime)]">
              <Icon name="check" size={16} className="mt-0.5 shrink-0" />
              {u.converted}
            </p>
          ) : busy ? (
            <p role="status" className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <Spinner /> {phase.kind === 'wallet' ? u.waitingWallet : u.confirming}
            </p>
          ) : phase.kind === 'unknown' ? (
            <div className="flex flex-col gap-2">
              <p role="alert" className="text-sm text-[var(--tone-caution-fg)]">
                {u.unknown}
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  setPhase({ kind: 'idle' });
                  void load();
                }}
              >
                {u.checkAgain}
              </Button>
            </div>
          ) : !snapshot.payer.tokenRegistered ? (
            <div className="flex flex-col gap-2">
              <Button size="lg" block variant="secondary" onClick={() => void run(prepareTokenRegistration(snapshot), false)}>
                {fill(u.enable, sym)}
              </Button>
              <p className="text-xs text-[var(--text-muted)]">{fill(u.enableNote, { near: near(snapshot.tokenStorageMinYocto) })}</p>
            </div>
          ) : quote !== null && !enough ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-[var(--tone-caution-fg)]">{fill(u.notEnough, sym)}</p>
              <Button
                size="lg"
                block
                variant="secondary"
                onClick={() => {
                  try {
                    void run(prepareBuyToken(snapshot, quoteExactNearForToken(snapshot, purchaseNear.toString())), false);
                  } catch {
                    setLoadError(u.priceImpact);
                  }
                }}
              >
                {fill(u.getTest, { symbol: route.symbol, near: near(purchaseNear) })}
              </Button>
              <p className="text-xs text-[var(--text-muted)]">{fill(u.getTestNote, sym)}</p>
            </div>
          ) : quote !== null ? (
            <Button size="lg" block onClick={() => void run(prepareSellTokenForNear(snapshot, quote), true)}>
              {fill(u.convert, { amount: tokenAmount(quote.tokenIn), symbol: route.symbol })}
            </Button>
          ) : null}

          {phase.kind === 'failed' && (
            <p role="alert" className="text-sm text-[var(--tone-danger-fg)]">
              {fill(u.failed, sym)}
            </p>
          )}
          {phase.kind !== 'converted' && !busy && (
            <Button variant="ghost" onClick={() => void load()}>
              <Icon name="refresh" size={16} />
              {u.refresh}
            </Button>
          )}
          <p className="text-xs text-[var(--text-muted)]">{u.gasNote}</p>
        </>
      )}
    </section>
  );
}
