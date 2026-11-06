'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { CreateRequest } from '@/components/payments/CreateRequest';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Card, ScreenHeader } from '@/components/primitives/Surface';
import { ConnectWalletButton, WalletErrorNotice } from '@/components/wallet/WalletConnect';
import { useT } from '@/lib/i18n/provider';
import { checkMerchantAccount } from '@/lib/merchant/discovery';
import { useWallet } from '@/lib/wallet/provider';
import { DiscoveryQr } from './DiscoveryQr';
import { InstantOnlyBadge, MerchantBack, MerchantTile, ReceivingAccountCard, SaleSteps } from './MerchantParts';
import { RecentSales } from './RecentSales';

/**
 * Merchant screens (Phase 7).
 *
 * What is real: the connected Testnet account, the discovery QR, and sale
 * requests created through the SAME `CreateRequest` flow as personal requests
 * (same wallet signer, journal, nonce, quote and freshness guards). What is
 * not: merchant-bound terms, signed merchant profiles and live Handshake. Those
 * stay behind `merchantCheckout` / `handshake`, which are off.
 */

/** Renders children only with a connected wallet whose account is a valid Testnet merchant account. */
function WithMerchantAccount({ children }: { readonly children: (accountId: string) => ReactNode }) {
  const t = useT();
  const { state } = useWallet();
  if (state.status !== 'connected') {
    return (
      <Card className="flex flex-col gap-4">
        <p className="text-sm text-[var(--text-secondary)]">{t.commerce.merchant.connectFirst}</p>
        <WalletErrorNotice />
        {state.status !== 'disabled' && <ConnectWalletButton />}
      </Card>
    );
  }
  const checked = checkMerchantAccount(state.session.accountId);
  if (!checked.ok) {
    return (
      <InlineNotice
        copy={checked.reason === 'not_testnet' ? t.commerce.checkout.notTestnet : t.commerce.checkout.invalidAccount}
        tone="danger"
      />
    );
  }
  return <>{children(checked.accountId)}</>;
}

export function MerchantHome() {
  const t = useT();
  const m = t.commerce.merchant;
  return (
    <>
      <ScreenHeader title={m.title} />
      <div className="-mt-2 mb-5">
        <InstantOnlyBadge />
      </div>
      <WithMerchantAccount>
        {(accountId) => (
          <div className="flex flex-col gap-6">
            <ReceivingAccountCard accountId={accountId} />
            <nav aria-label={m.title} className="flex flex-col gap-3">
              <MerchantTile index={0} primary href="/merchant/register" icon="request" title={m.newSale.title} body={m.newSale.body} />
              <MerchantTile index={1} href="/merchant/setup" icon="scan" title={m.discovery.title} body={m.discovery.body} />
            </nav>
            <details className="disclosure">
              <summary className="flex min-h-[44px] cursor-pointer items-center text-sm text-[var(--text-secondary)]">{t.oneTap.payment.details}</summary>
            {/* Phase 7G: one quiet, inert row instead of two full disabled tiles. No session
                backend, no on-chain binding, no profile signing: inert whatever the flags say. */}
            <section
              aria-labelledby="merchant-later"
              className="rounded-[var(--radius-card)] border border-dashed border-[var(--border-subtle)] px-4 py-3"
              data-testid="merchant-coming-later"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 id="merchant-later" className="text-sm font-semibold text-[var(--text-secondary)]">
                  {m.handshake.title} · {m.profile.title}
                </h2>
                <span className="shrink-0 rounded-full border border-[var(--tone-caution-border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--tone-caution-fg)]">
                  {t.commerce.comingLater}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{t.commerce.phase7g.merchantHome.comingLaterBody}</p>
            </section>
            <p className="-mt-2 px-1 text-xs leading-relaxed text-[var(--text-muted)]">{t.commerce.phase7g.merchantHome.unboundShort}</p>
            </details>
            <RecentSales accountId={accountId} />
          </div>
        )}
      </WithMerchantAccount>
    </>
  );
}

export function MerchantSetup() {
  const t = useT();
  const d = t.commerce.discovery;
  return (
    <>
      <MerchantBack label={t.commerce.sale.back} />
      <ScreenHeader title={d.title} description={d.subtitle} />
      <WithMerchantAccount>{(accountId) => <DiscoveryQr accountId={accountId} />}</WithMerchantAccount>
    </>
  );
}

export function SaleRegister() {
  const t = useT();
  const s = t.commerce.sale;
  const [step, setStep] = useState<0 | 1>(0);
  const onStep = useCallback((next: 0 | 1) => setStep(next), []);
  return (
    <>
      <MerchantBack label={s.back} />
      <ScreenHeader title={s.title} />
      <div className="-mt-2 mb-5">
        <InstantOnlyBadge />
      </div>
      <WithMerchantAccount>
        {() => (
          <>
            <SaleSteps current={step} />
            {/* The one approved creation path. No second signer, no second journal. */}
            <CreateRequest variant="sale" onStepChange={onStep} />
          </>
        )}
      </WithMerchantAccount>
    </>
  );
}
