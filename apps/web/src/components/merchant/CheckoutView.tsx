'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Monogram, NetworkPill } from '@/components/experience/Basics';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { AccountId } from '@/components/primitives/Amount';
import { Button, ButtonLink } from '@/components/primitives/Button';
import { PayLinkForm } from '@/components/scan/PayEntry';
import { QrScanner } from '@/components/scan/QrScanner';
import { Icon } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';
import { checkMerchantAccount, merchantCheckoutPath } from '@/lib/merchant/discovery';
import { rememberCheckout, sessionHints } from '@/lib/merchant/journey';
import { useWallet } from '@/lib/wallet/provider';

/**
 * Customer checkout (`/checkout/<accountId>`, freeze section 5).
 *
 * This is the DISCOVERY state: it identifies a NEAR Testnet account and tells
 * the customer how to pay a sale. It never shows an amount, never creates a
 * request and never opens a wallet. The only actions navigate to a sale the
 * merchant signed (/pay/<id>), which reads its terms from the contract.
 *
 * No display name is shown: without a verified NEP-413 profile, a name would
 * look like an identity claim the app cannot back.
 */
export function CheckoutView({ accountId }: { readonly accountId: string }) {
  const t = useT();
  const c = t.commerce.checkout;
  const router = useRouter();
  const { state } = useWallet();
  const [scanning, setScanning] = useState(false);
  const [pasting, setPasting] = useState(false);

  const checked = checkMerchantAccount(accountId);
  if (!checked.ok) {
    return (
      <div className="flex flex-col gap-4" data-testid="checkout-invalid">
        <InlineNotice copy={checked.reason === 'not_testnet' ? c.notTestnet : c.invalidAccount} tone="danger" live="assertive" />
        <p className="px-1 text-xs text-[var(--text-muted)]">{c.nothingSigned}</p>
      </div>
    );
  }

  const own = state.status === 'connected' && state.session.accountId === checked.accountId;
  const openRequest = (id: string) => {
    // Wording hint only: /pay calls it "Live checkout" if the sale pays THIS account.
    rememberCheckout(sessionHints(), checked.accountId, Date.now());
    router.push(`/pay/${id}`);
  };
  const openMerchant = (next: string) => router.push(merchantCheckoutPath(next));

  return (
    <div className="flex flex-col gap-5">
      <section
        aria-label={c.merchantAccount}
        className="relative overflow-hidden rounded-[var(--radius-hero)] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-5 pb-6 pt-5 text-center shadow-[var(--highlight-top)]"
      >
        <div className="flex justify-center">
          <NetworkPill />
        </div>
        <div className="mt-5 flex justify-center">
          <Monogram accountId={checked.accountId} size={64} />
        </div>
        <p className="eyebrow mt-4 text-[var(--text-muted)]">{c.eyebrow}</p>
        <AccountId accountId={checked.accountId} className="mt-1 block break-all text-xl font-semibold tracking-tight" />
        <p className="mt-2 text-xs text-[var(--text-muted)]">{c.unverifiedName}</p>
      </section>

      {own && (
        <InlineNotice
          copy={c.ownPage}
          tone="neutral"
          action={
            <ButtonLink href="/merchant/register" variant="secondary">
              {c.openPos}
            </ButtonLink>
          }
        />
      )}

      <section aria-labelledby="checkout-waiting" className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-5">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="relative mt-1 grid size-3 shrink-0 place-items-center">
            <span className="checkout-pulse absolute inset-0 rounded-full bg-[var(--taply-lime)] opacity-40" />
            <span className="size-2 rounded-full bg-[var(--taply-lime)]" />
          </span>
          <div className="min-w-0">
            <h2 id="checkout-waiting" className="font-semibold">
              {c.discoveryState.title}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{c.discoveryState.body}</p>
          </div>
        </div>

        {pasting ? (
          <div className="mt-5">
            <PayLinkForm onBack={() => setPasting(false)} onOpen={openRequest} onMerchant={openMerchant} />
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-1">
            <Button size="lg" block onClick={() => setScanning(true)}>
              <Icon name="scan" size={20} />
              {c.scanSale}
            </Button>
            <Button variant="ghost" block onClick={() => setPasting(true)}>
              <Icon name="link" size={18} />
              {c.pasteSale}
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="checkout-how" className="px-1">
        <h2 id="checkout-how" className="text-sm font-semibold">
          {c.howTitle}
        </h2>
        <ol className="mt-3 flex flex-col gap-3">
          {[c.step1, c.step2, c.step3].map((step, i) => (
            <li key={step} className="flex items-start gap-3 text-sm leading-snug text-[var(--text-secondary)]">
              <span
                aria-hidden="true"
                className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-xs font-semibold text-[var(--text-primary)] ring-1 ring-[var(--border-subtle)]"
              >
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </section>

      {/* Phase 7G: one notice instead of three (proves, no listing, signs nothing). */}
      <InlineNotice copy={{ title: c.authenticity.title, body: t.commerce.phase7g.checkoutNote }} tone="caution" />

      {scanning && (
        <QrScanner
          onClose={() => setScanning(false)}
          onRequest={(id) => {
            setScanning(false);
            openRequest(id);
          }}
          onMerchant={(next) => {
            setScanning(false);
            openMerchant(next);
          }}
          onPasteLink={() => {
            setScanning(false);
            setPasting(true);
          }}
        />
      )}
    </div>
  );
}
