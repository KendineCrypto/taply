// Synthetic presentations only. No chain reads, wallet or signing.
import { renderToStaticMarkup } from 'react-dom/server';
import { SharedSession } from '@/components/experience/SharedSession';
import { I18nProvider } from '@/lib/i18n/provider';
export const fixtures = (['en', 'tr'] as const).flatMap(locale =>
  (['awaiting', 'contract_paid', 'verified', 'unresolved', 'transfer'] as const).map(stage => ({
    locale, stage,
    html: renderToStaticMarkup(<I18nProvider locale={locale}><SharedSession side="payer" context="checkout" stage={stage} requestId={'1234567890abcdef'.repeat(4)} amountBaseUnits="2500000000000000000000000" recipientAccountId="shop.testnet" payerAccountId="customer.testnet" showAmount live={false} proofAction={<button className="min-h-[44px] rounded-xl bg-[var(--taply-lime)] px-4 text-[var(--taply-night)]">{locale === 'en' ? 'Check receipt' : 'Makbuzu kontrol et'}</button>} /></I18nProvider>),
  })),
);
