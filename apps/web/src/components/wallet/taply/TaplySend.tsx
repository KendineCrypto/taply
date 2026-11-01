'use client';

import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Amount } from '@/components/primitives/Amount';
import { Button, ButtonLink, Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { SendReview } from '@/components/send/SendParts';
import { fill } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n/provider';
import { formatBaseUnits } from '@/lib/format/amount';
import { NEAR_NATIVE } from '@/lib/protocol';
import { useTaplyWallet } from './TaplyWalletProvider';
import type { TaplyErrorCode } from './TaplyWalletProvider';
import { TaplyErrorNotice } from './TaplyWalletUi';
import { useWalletMode } from './mode';

/**
 * Native transfer review from Taply Wallet. `prepareSend` (controller) checks
 * the receiver on NEAR Testnet, converts the amount exactly and applies storage
 * and gas reserves. There is no sign action here; the controller's
 * `TAPLY_WALLET_SIGNING_ENABLED` is hard-coded false and no UI state changes it.
 */
type Prepared = { readonly receiverId: string; readonly depositYocto: string; readonly availableYocto: string; readonly storageReserveYocto: string; readonly gasReserveYocto: string };

export function TaplySend() {
  const t = useT();
  const { locale } = useLocale();
  const n = t.walletNative;
  const s = t.walletUx.send;
  const [, setMode] = useWalletMode();
  const { state, prepareSend, refresh } = useTaplyWallet();
  const receiverId = useId();
  const amountId = useId();
  const [receiver, setReceiver] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TaplyErrorCode | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);

  if (state.status === 'checking') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <Spinner /> {n.status.checking}
      </p>
    );
  }
  if (state.status === 'unavailable') return <InlineNotice copy={n.unavailable} tone="neutral" />;
  if (state.status === 'not_created') {
    return (
      <InlineNotice
        copy={n.intro}
        tone="neutral"
        action={<ButtonLink href="/wallet/create">{n.create}</ButtonLink>}
      />
    );
  }
  if (state.status === 'local_only') {
    return (
      <InlineNotice
        copy={n.send.notActive}
        tone="neutral"
        action={
          <Button variant="secondary" onClick={() => setMode('external')}>
            {n.external}
          </Button>
        }
      />
    );
  }
  if (state.status === 'unknown') {
    return (
      <InlineNotice
        copy={n.status.unknown}
        action={
          <Button variant="secondary" onClick={refresh}>
            <Icon name="refresh" size={16} />
            {t.common.retry}
          </Button>
        }
      />
    );
  }

  if (prepared !== null) {
    const row = (label: string, value: ReactNode) => (
      <div className="flex items-start justify-between gap-3">
        <dt className="shrink-0 whitespace-nowrap text-[var(--text-muted)]">{label}</dt>
        <dd className="text-right">{value}</dd>
      </div>
    );
    return (
      <SendReview
        recipientAccountId={prepared.receiverId}
        amountYocto={prepared.depositYocto}
        // This component has no sign action at all: confirming stays unavailable until a
        // reviewed signer exists (controller TAPLY_WALLET_SIGNING_ENABLED is hard-coded false).
        confirm={{ available: false, reason: n.send.signingOff }}
        onEdit={() => setPrepared(null)}
        details={
          <>
            {row(t.experience.from, <span className="chain-id break-all">{state.identity.accountId}</span>)}
            {row(n.send.available, <Amount baseUnits={prepared.availableYocto} asset={NEAR_NATIVE} />)}
            {row(n.send.storageReserve, <Amount baseUnits={prepared.storageReserveYocto} asset={NEAR_NATIVE} />)}
            {row(n.send.gasReserve, <Amount baseUnits={prepared.gasReserveYocto} asset={NEAR_NATIVE} />)}
          </>
        }
      />
    );
  }

  return (
    <form
      className="surface-card flex flex-col gap-5 p-5"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        const result = await prepareSend(receiver.trim(), amount.trim().replace(',', '.'));
        setBusy(false);
        if (result.ok) setPrepared(result.value);
        else setError(result.code);
      }}
    >
      <InlineNotice copy={{ title: s.preview.title, body: n.send.signingOff }} tone="neutral" />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={receiverId} className="text-sm font-medium">
          {s.recipientLabel}
        </label>
        <input
          id={receiverId}
          value={receiver}
          onChange={(e) => setReceiver(e.target.value)}
          placeholder={s.recipientPlaceholder}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="taply-input chain-id"
          aria-invalid={error === 'INVALID_ADDRESS' || undefined}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={amountId} className="text-sm font-medium">
          {s.amountLabel}
        </label>
        <div className="flex items-baseline gap-2 border-b-2 border-[var(--border-strong)] pb-2 focus-within:border-[var(--taply-lime)]">
          <input
            id={amountId}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="display-amount min-h-[64px] w-full min-w-0 bg-transparent text-[3rem] placeholder:text-[var(--text-muted)] focus-visible:outline-none"
            aria-invalid={error === 'INVALID_AMOUNT' || error === 'INSUFFICIENT_AVAILABLE_BALANCE' || undefined}
          />
          <span aria-hidden="true" className="text-xl font-semibold text-[var(--text-secondary)]">
            NEAR
          </span>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          {fill(s.available, { amount: `${formatBaseUnits(state.balance.amountYocto, NEAR_NATIVE.decimals, { locale }).display} NEAR` })}
        </p>
      </div>
      <TaplyErrorNotice code={error} />
      <Button type="submit" size="lg" block disabled={busy || receiver.trim() === '' || amount.trim() === ''}>
        {busy ? <Spinner /> : null}
        {busy ? n.send.preparing : s.review}
        {!busy && <Icon name="arrow-right" size={18} />}
      </Button>
    </form>
  );
}
