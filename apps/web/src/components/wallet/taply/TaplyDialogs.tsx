'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { TESTNET_SWAP_ROUTES } from '@taply/near-client';
import type { WalletTransactionReview } from '@taply/near-client';
import { Button, Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { formatBaseUnits } from '@/lib/format/amount';
import { fill } from '@/lib/i18n/fill';
import { useLocale, useT } from '@/lib/i18n/provider';
import { PassphraseField, TaplyErrorNotice } from './TaplyWalletUi';
import type { TaplyErrorCode } from './TaplyWalletProvider';

/**
 * Taply Wallet's own "wallet window": every signature is preceded by this
 * dialog showing exactly what the reviewed backend will sign (receiver, action,
 * attached NEAR, fee reserve). Nothing is signed unless "Confirm" is pressed.
 */

function Shell({ labelledBy, children }: { readonly labelledBy: string; readonly children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgb(11_18_14/0.72)] p-3 min-[480px]:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="surface-hero max-h-[92vh] w-full max-w-md overflow-y-auto p-5"
      >
        {children}
      </div>
    </div>
  );
}

type Action = { methodName: string; args: Record<string, unknown>; depositYocto: string };

/** Human lines for a review, derived ONLY from the reviewed transaction itself. */
export function describeReview(review: WalletTransactionReview, t: ReturnType<typeof useT>, locale: 'en' | 'tr'): string[] {
  const c = t.walletNative.confirm;
  const near = (v: string) => formatBaseUnits(v, 24, { locale, maxFractionDigits: 5 }).display;
  if (review.kind === 'native_transfer') return [c.transfer];
  if (review.kind === 'contract_call') {
    const named: Record<string, string> = { pay_instant_native: c.payRequest, create_request: c.createRequest, cancel_unfunded: c.cancelRequest, retry_native_transfer: c.retryPayout,
      fund_protected_native: c.lockProtected, cancel_protected: c.cancelProtected, release_protected: c.releaseProtected, ...t.gift.confirmLabels };
    return [named[review.methodName ?? ''] ?? fill(c.contract, { method: review.methodName ?? '' })];
  }
  let actions: Action[] = [];
  try {
    actions = JSON.parse(review.actionsJson ?? '[]') as Action[];
  } catch {
    return [fill(c.contract, { method: review.methodName ?? '' })];
  }
  const lines: string[] = [];
  for (const a of actions) {
    const route = TESTNET_SWAP_ROUTES.find((r) => r.token === review.receiverId);
    if (a.methodName === 'storage_deposit') {
      lines.push(fill(c.register, { symbol: route?.symbol ?? 'wNEAR' }));
    } else if (a.methodName === 'ft_transfer_call') {
      try {
        const msg = JSON.parse(String(a.args['msg'])) as { actions: Array<{ token_out: string; min_amount_out: string; amount_in: string }> };
        const step = msg.actions[0];
        if (step === undefined) continue;
        if (route !== undefined) {
          lines.push(fill(c.sell, { amount: formatBaseUnits(step.amount_in, route.decimals, { locale, maxFractionDigits: 4 }).display, symbol: route.symbol, near: near(step.min_amount_out) }));
        } else {
          const out = TESTNET_SWAP_ROUTES.find((r) => r.token === step.token_out);
          if (out !== undefined)
            lines.push(fill(c.buy, { near: near(step.amount_in), amount: formatBaseUnits(step.min_amount_out, out.decimals, { locale, maxFractionDigits: 4 }).display, symbol: out.symbol }));
        }
      } catch {
        lines.push(fill(c.contract, { method: a.methodName }));
      }
    }
  }
  return lines;
}

export function ConfirmTransactionDialog({
  review,
  onDecide,
}: {
  readonly review: WalletTransactionReview;
  readonly onDecide: (approved: boolean) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const c = t.walletNative.confirm;
  const id = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => confirmRef.current?.focus(), []);
  const near = (v: string) => formatBaseUnits(v, 24, { locale, maxFractionDigits: 5 }).display;
  const row = (label: string, value: ReactNode) => (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] py-2 last:border-0">
      <dt className="shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 text-right">{value}</dd>
    </div>
  );
  return (
    <Shell labelledBy={`${id}-title`}>
      <div className="flex items-center gap-2">
        <Icon name="shield" size={20} className="text-[var(--taply-lime)]" />
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {c.title}
        </h2>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{c.body}</p>
      <dl className="mt-4 text-sm">
        {row(c.action, <ul className="flex flex-col gap-1 font-semibold">{describeReview(review, t, locale).map((l) => <li key={l}>{l}</li>)}</ul>)}
        {row(c.from, <span className="chain-id break-all">{review.signerAccountId}</span>)}
        {row(c.to, <span className="chain-id break-all">{review.receiverId}</span>)}
        {row(
          c.amount,
          <span className="font-semibold">
            {BigInt(review.depositYocto) > 0n && BigInt(review.depositYocto) < 10n ** 19n ? fill(c.tinyDeposit, { yocto: review.depositYocto }) : `${near(review.depositYocto)} NEAR`}
          </span>,
        )}
        {row(c.fee, <span className="text-xs">{fill(c.feeValue, { near: near(review.gasReserveYocto) })}</span>)}
        {row(c.network, t.app.networkBadge)}
      </dl>
      <p className="mt-3 text-xs text-[var(--text-muted)]">{c.expires}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" onClick={() => onDecide(false)}>
          {c.reject}
        </Button>
        <Button ref={confirmRef} size="lg" onClick={() => onDecide(true)}>
          <Icon name="check" size={18} />
          {c.approve}
        </Button>
      </div>
    </Shell>
  );
}

export function UnlockDialog({
  onUnlock,
  onCancel,
}: {
  readonly onUnlock: (password: string) => Promise<TaplyErrorCode | null>;
  readonly onCancel: () => void;
}) {
  const t = useT();
  const c = t.walletNative.confirm;
  const id = useId();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TaplyErrorCode | null>(null);
  return (
    <Shell labelledBy={`${id}-title`}>
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || password === '') return;
          setBusy(true);
          const problem = await onUnlock(password);
          setBusy(false);
          setPassword('');
          setError(problem);
        }}
      >
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {c.unlockTitle}
        </h2>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{c.unlockBody}</p>
        <PassphraseField id={id} label={t.walletNative.lock.passphrase} value={password} onChange={setPassword} autoComplete="current-password" />
        <TaplyErrorNotice code={error} />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={onCancel} disabled={busy}>
            {c.cancel}
          </Button>
          <Button type="submit" size="lg" disabled={busy || password === ''}>
            {busy ? <Spinner /> : <Icon name="shield" size={18} />}
            {t.walletNative.lock.unlock}
          </Button>
        </div>
      </form>
    </Shell>
  );
}
