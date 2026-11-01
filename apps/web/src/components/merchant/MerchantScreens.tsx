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
      <ScreenHeader title={m.title} description={m.subtitle} trailing={<InstantOnlyBadge />} />
      <WithMerchantAccount>
        {(accountId) => (
          <div className="flex flex-col gap-6">
            <ReceivingAccountCard accountId={accountId} />
            <nav aria-label={m.title} className="flex flex-col gap-3">
              <MerchantTile index={0} primary href="/merchant/register" icon="request" title={m.newSale.title} body={m.newSale.body} />
              <MerchantTile index={1} href="/merchant/setup" icon="scan" title={m.discovery.title} body={m.discovery.body} />
              {/* No session backend, no on-chain binding, no profile signing: inert in every build, whatever the flags say. */}
              <MerchantTile index={2} icon="link" title={m.handshake.title} body={m.handshake.body} disabledLabel={t.commerce.comingLater} />
              <MerchantTile
                index={3}
                icon="shield"
                title={m.profile.title}
                body={m.profile.body}
                disabledLabel={t.commerce.comingLater}
              />
            </nav>
            <InlineNotice copy={t.commerce.unbound} tone="neutral" />
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
      <ScreenHeader title={s.title} description={s.subtitle} trailing={<InstantOnlyBadge />} />
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
