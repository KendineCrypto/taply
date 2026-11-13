'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Surface';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { useMainnetWallet } from '@/lib/mainnet/wallet';
import { CreateRequest } from './CreateRequest';
import { Notice, Row } from './bits';

/**
 * Merchant register and store checkout on Mainnet.
 *
 * The permanent store QR (`/m/checkout/<account>`) never carries an amount. Each
 * sale is a distinct request: a fresh creation nonce, so a fresh request id and
 * terms hash, created by the store account itself. The customer opens that
 * sale's request from the checkout with `?m=<store>` so the pay page refuses a
 * request whose recipient is not this store. No on-chain merchant profile exists
 * on Mainnet (`merchantProfiles: false`); the store identity is the account.
 */
const en = {
  registerTitle: 'Register',
  registerLead: 'Each sale gets its own request with its own ID. The store QR never carries an amount.',
  sale: 'Sale',
  nextSale: 'Next sale (new request)',
  storeAccount: 'Store account (receives every sale)',
  storeQr: 'Permanent store checkout',
  noStore: 'Connect the store\'s NEAR wallet to take sales.',
  checkoutTitle: 'Store checkout',
  checkoutLead: 'Pay this store only through the request for your sale. Ask the cashier to show this sale\'s QR or code, or join their live Handshake.',
  yourStore: 'This is your store.',
  openRegister: 'Open the register',
  saleCode: 'Sale request (code or link from the cashier)',
  openSale: 'Review this sale',
  badCode: 'That is not a Taply Mainnet request code or link.',
  handshake: 'Live Handshake',
};
type Copy = typeof en;
const tr: Copy = {
  registerTitle: 'Kasa',
  registerLead: 'Her satış kendi kimliğiyle ayrı bir talep alır. Mağaza QR\'ı hiçbir zaman tutar taşımaz.',
  sale: 'Satış',
  nextSale: 'Sonraki satış (yeni talep)',
  storeAccount: 'Mağaza hesabı (her satışı alır)',
  storeQr: 'Kalıcı mağaza ödeme sayfası',
  noStore: 'Satış almak için mağazanın NEAR cüzdanını bağlayın.',
  checkoutTitle: 'Mağaza ödemesi',
  checkoutLead: 'Bu mağazaya yalnızca satışınızın talebiyle ödeyin. Kasiyerden bu satışın QR\'ını veya kodunu isteyin ya da canlı Handshake\'e katılın.',
  yourStore: 'Bu sizin mağazanız.',
  openRegister: 'Kasayı aç',
  saleCode: 'Satış talebi (kasiyerden kod veya bağlantı)',
  openSale: 'Bu satışı incele',
  badCode: 'Bu bir Taply Mainnet talep kodu veya bağlantısı değil.',
  handshake: 'Canlı Handshake',
};
const COPY = { en, tr };

export function MerchantRegister() {
  const { locale } = useMainnetLocale();
  const c = COPY[locale];
  const { accountId } = useMainnetWallet();
  const [sale, setSale] = useState(1);
  return (
    <div className="flex flex-col gap-3" data-testid="merchant-register">
      <Card>
        <h2 className="font-semibold">{c.registerTitle} · {c.sale} <span data-testid="sale-number">{sale}</span></h2>
        <p className="mt-1 text-[14px] text-[var(--text-secondary)]">{c.registerLead}</p>
        {accountId !== null ? (
          <dl className="mt-2">
            <Row label={c.storeAccount} mono><span data-testid="store-account">{accountId}</span></Row>
            <Row label={c.storeQr} mono><Link className="underline" href={`/m/checkout/${accountId}` as Route}>/m/checkout/{accountId}</Link></Row>
          </dl>
        ) : <p className="mt-2 text-[13px] text-[var(--text-muted)]">{c.noStore}</p>}
        <Button className="mt-3" variant="secondary" data-testid="next-sale" onClick={() => setSale((n) => n + 1)}>{c.nextSale}</Button>
      </Card>
      {/* key = sale: a new CreateRequest instance draws a new creation nonce, so a new request id. */}
      <CreateRequest key={sale} />
    </div>
  );
}

/** Extract a request id from a 64-hex code or a same-origin /m/pay/<id> link. */
export function saleRequestId(text: string, origin: string): string | null {
  const t = text.trim();
  if (/^[0-9a-f]{64}$/.test(t)) return t;
  try {
    const url = new URL(t);
    if (url.origin !== new URL(origin).origin) return null;
    const m = /^\/m\/pay\/([0-9a-f]{64})$/.exec(url.pathname);
    return m ? m[1]! : null;
  } catch { return null; }
}

export function MerchantCheckout({ account }: { readonly account: string }) {
  const { locale } = useMainnetLocale();
  const c = COPY[locale];
  const router = useRouter();
  const { accountId } = useMainnetWallet();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="flex flex-col gap-3" data-testid="merchant-checkout">
      <Card>
        <h2 className="font-semibold">{c.checkoutTitle}</h2>
        <p data-testid="checkout-account" className="mt-1 break-all font-mono text-[17px]">{account}</p>
        <p className="mt-2 text-[14px] text-[var(--text-secondary)]">{c.checkoutLead}</p>
        {accountId === account && (
          <Notice tone="muted" testId="checkout-own-store">{c.yourStore} <Link className="underline" href="/m/merchant/register">{c.openRegister}</Link></Notice>
        )}
      </Card>
      <Card>
        <form className="flex flex-col gap-2" onSubmit={(e) => {
          e.preventDefault();
          const id = saleRequestId(code, window.location.origin);
          if (id === null) { setError(c.badCode); return; }
          router.push(`/m/pay/${id}?m=${encodeURIComponent(account)}` as Route);
        }}>
          <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="sale-code">{c.saleCode}</label>
          <input id="sale-code" className="min-h-[var(--tap-target)] w-full rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] px-3 font-mono text-[13px]" autoCapitalize="none" spellCheck={false} value={code} onChange={(e) => { setCode(e.target.value); setError(''); }} />
          <Button type="submit" variant="primary" data-testid="open-sale">{c.openSale}</Button>
          {error && <Notice tone="danger" live testId="sale-code-error">{error}</Notice>}
        </form>
        <Link className="tap-target mt-2 inline-flex underline" href="/m/handshake">{c.handshake}</Link>
      </Card>
    </div>
  );
}
