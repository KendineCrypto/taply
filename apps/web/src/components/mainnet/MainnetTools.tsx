'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { MainnetAccountSchema } from '@taply/shared';
import { MerchantTile, ReceivingAccountCard } from '@/components/merchant/MerchantParts';
import { Button } from '@/components/primitives/Button';
import { Card, EmptyState } from '@/components/primitives/Surface';
import { Icon } from '@/components/shell/Icons';
import { fill } from '@/lib/i18n/fill';
import { useT } from '@/lib/i18n/provider';
import { formatMainnetAmount, MAINNET_ASSETS, parseMainnetAmount } from '@/lib/mainnet/assets';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { requestPrefill } from '@/lib/mainnet/prefill';
import { splitMainnetAmount } from '@/lib/mainnet/product';
import { useLocalProduct } from '@/lib/mainnet/use-product';
import { productEn, productTr } from '@/lib/mainnet/product-copy';
import { ActivityList } from './Activity';

/**
 * Contacts, Split, Recurring and Merchant home in the Testnet layouts (list, empty state,
 * "Add" button, form card), backed by NEAR Mainnet data: this account's device-local
 * store (useLocalProduct) and Mainnet request links. No Testnet store is read.
 */
const MAX_LOCAL = 100;
const useP = () => (useMainnetLocale().locale === 'tr' ? productTr : productEn);

function FormField({ id, label, hint, children }: { readonly id: string; readonly label: string; readonly hint?: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children}
      {hint !== undefined && <p className="text-xs text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

function AssetToggle({ asset, onChange }: { readonly asset: 'NEAR' | 'USDC'; readonly onChange: (a: 'NEAR' | 'USDC') => void }) {
  const p = useP();
  return (
    <fieldset className="grid grid-cols-2 gap-1 self-start rounded-full bg-[var(--surface-1)] p-1 ring-1 ring-[var(--border-subtle)]">
      <legend className="sr-only">{p.asset}</legend>
      {(['NEAR', 'USDC'] as const).map((a) => (
        <label key={a} className={`relative flex min-h-[36px] cursor-pointer items-center justify-center rounded-full px-4 text-xs font-semibold ${asset === a ? 'bg-[var(--text-primary)] text-[var(--taply-night)]' : 'text-[var(--text-secondary)]'}`}>
          <input type="radio" className="absolute inset-0 cursor-pointer opacity-0" checked={asset === a} onChange={() => onChange(a)} />
          {a}
        </label>
      ))}
    </fieldset>
  );
}

export function MainnetContacts() {
  const t = useT();
  const c = t.tools.contacts;
  const local = useLocalProduct();
  const ids = { name: useId(), account: useId(), search: useId() };
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [account, setAccount] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const contacts = local.data.contacts;
  const p = useP();
  if (adding) {
    return (
      <Card className="p-5">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const id = account.trim();
            if (!MainnetAccountSchema.safeParse(id).success || name.trim() === '') { setError(p.invalid); return; }
            local.save({ ...local.data, contacts: [...contacts.filter((v) => v.id !== id), { id, label: name.trim() }] });
            setAdding(false); setName(''); setAccount(''); setError(''); setNotice(c.saved);
          }}
        >
          <h2 className="text-lg font-semibold">{c.addTitle}</h2>
          <FormField id={ids.name} label={c.labelField} hint={c.labelHint}>
            <input id={ids.name} className="taply-input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField id={ids.account} label={c.accountField} hint={c.accountHint}>
            <input id={ids.account} className="taply-input chain-id" autoCapitalize="none" autoComplete="off" spellCheck={false} value={account} onChange={(e) => setAccount(e.target.value)} />
          </FormField>
          {error !== '' && <p role="alert" className="text-sm text-[var(--tone-danger-fg)]">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => { setAdding(false); setError(''); }}>{c.cancel}</Button>
            <Button type="submit" block disabled={!local.ready}>{c.save}</Button>
          </div>
        </form>
      </Card>
    );
  }
  const q = query.trim().toLowerCase();
  const visible = contacts.filter((v) => q === '' || v.label.toLowerCase().includes(q) || v.id.includes(q));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full border border-[var(--border-subtle)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
          {c.localOnly} · {fill(c.count, { n: String(contacts.length), max: String(MAX_LOCAL) })}
        </span>
        <Button onClick={() => { setAdding(true); setNotice(null); }} disabled={!local.ready || contacts.length >= MAX_LOCAL}>
          <Icon name="request" size={16} /> {c.add}
        </Button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{notice ?? ''}</p>
      {notice !== null && <p className="px-1 text-sm text-[var(--text-secondary)]">{notice}</p>}
      {contacts.length === 0 ? (
        <EmptyState title={c.empty.title} body={c.empty.body} />
      ) : (
        <>
          <FormField id={ids.search} label={c.searchLabel}>
            <input id={ids.search} type="search" className="taply-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={c.searchPlaceholder} autoComplete="off" autoCapitalize="none" spellCheck={false} />
          </FormField>
          {visible.length === 0 ? (
            <p className="px-1 text-sm text-[var(--text-secondary)]">{c.noMatches}</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label={c.title} data-testid="contact-list">
              {visible.map((contact) => (
                <li key={contact.id} className="surface-card flex flex-col gap-2 p-4" data-testid="contact-row">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold">{contact.label}</span>
                    <span className="chain-id break-all text-sm text-[var(--text-secondary)]">{contact.id}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => { local.save({ ...local.data, contacts: contacts.filter((a) => a.id !== contact.id) }); setNotice(c.deleted); }}>
                      {c.delete}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function MainnetSplit() {
  const t = useT();
  const s = t.tools.split;
  const { locale } = useMainnetLocale();
  const p = useP();
  const ids = { amount: useId(), count: useId() };
  const [adding, setAdding] = useState(false);
  const [asset, setAsset] = useState<'NEAR' | 'USDC'>('USDC');
  const [amount, setAmount] = useState('');
  const [count, setCount] = useState(2);
  const [shares, setShares] = useState<string[]>([]);
  const [error, setError] = useState('');
  const reset = () => { setShares([]); setError(''); };
  return (
    <div className="flex flex-col gap-4">
      {!adding && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}><Icon name="request" size={16} /> {s.add}</Button>
        </div>
      )}
      {adding && (
        <Card className="p-5">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault(); reset();
              const parsed = parseMainnetAmount(amount, MAINNET_ASSETS[asset]);
              try { if (!parsed.ok) throw new Error(); setShares(splitMainnetAmount(parsed.baseUnits, count)); } catch { setError(p.invalid); }
            }}
          >
            <h2 className="text-lg font-semibold">{s.addTitle}</h2>
            <AssetToggle asset={asset} onChange={(a) => { setAsset(a); reset(); }} />
            <FormField id={ids.amount} label={p.amount}>
              <input id={ids.amount} className="taply-input" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); reset(); }} />
            </FormField>
            <FormField id={ids.count} label={p.count}>
              <input id={ids.count} className="taply-input" type="number" min={2} max={50} value={count} onChange={(e) => { setCount(e.target.valueAsNumber); reset(); }} />
            </FormField>
            {error !== '' && <p role="alert" className="text-sm text-[var(--tone-danger-fg)]">{error}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => { setAdding(false); reset(); }}>{s.cancel}</Button>
              <Button type="submit" block>{p.calculate}</Button>
            </div>
          </form>
        </Card>
      )}
      {shares.length > 0 ? (
        <section className="surface-card flex flex-col gap-2 p-5" aria-label={s.previewTitle}>
          <h3 className="font-semibold">{s.previewTitle}</h3>
          <ol className="flex flex-col" data-testid="split-shares">
            {shares.map((share, i) => (
              <li key={i} className="flex min-h-[48px] items-center justify-between gap-3 border-b border-[var(--border-subtle)] last:border-0">
                <span className="tabular-nums">{i + 1}. {formatMainnetAmount(share, MAINNET_ASSETS[asset], locale)}</span>
                <Link className="tap-target inline-flex items-center text-sm font-medium text-[var(--taply-lime)]" href={requestPrefill(asset, share, `Split ${i + 1}/${shares.length}`)}>{s.prepare}</Link>
              </li>
            ))}
          </ol>
          <p className="text-xs text-[var(--text-muted)]">{s.sumOk} {s.prepareNote}</p>
        </section>
      ) : !adding ? (
        <EmptyState title={s.empty.title} body={s.empty.body} />
      ) : null}
      <details className="disclosure px-1">
        <summary className="flex min-h-[var(--tap-target)] cursor-pointer items-center text-sm text-[var(--text-secondary)]">{s.howItWorksTitle}</summary>
        <p className="pb-2 text-sm text-[var(--text-secondary)]">{s.howItWorks}</p>
      </details>
    </div>
  );
}

export function MainnetRecurring() {
  const t = useT();
  const r = t.tools.recurring;
  const { locale } = useMainnetLocale();
  const local = useLocalProduct();
  const p = useP();
  const ids = { name: useId(), amount: useId(), memo: useId(), cadence: useId() };
  const [adding, setAdding] = useState(false);
  const [asset, setAsset] = useState<'NEAR' | 'USDC'>('NEAR');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [cadence, setCadence] = useState<'weekly' | 'monthly'>('monthly');
  const [error, setError] = useState('');
  const templates = local.data.drafts.filter((d) => d.kind === 'recurring');
  if (adding) {
    return (
      <Card className="p-5">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = parseMainnetAmount(amount, MAINNET_ASSETS[asset]);
            if (!parsed.ok || name.trim() === '' || new TextEncoder().encode(name).length > 280) { setError(p.invalid); return; }
            local.save({ ...local.data, drafts: [...local.data.drafts, { id: crypto.randomUUID(), kind: 'recurring', recipient: '', amount: parsed.baseUnits, asset, note: name.trim(), cadence, design: 0 }] });
            setAdding(false); setName(''); setAmount(''); setError('');
          }}
        >
          <h2 className="text-lg font-semibold">{r.addTitle}</h2>
          <FormField id={ids.name} label={r.nameField}>
            <input id={ids.name} className="taply-input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <AssetToggle asset={asset} onChange={setAsset} />
          <FormField id={ids.amount} label={`${t.walletUx.send.amountLabel} (${asset})`}>
            <input id={ids.amount} className="taply-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </FormField>
          <FormField id={ids.cadence} label={r.cadenceField}>
            <select id={ids.cadence} className="taply-input" value={cadence} onChange={(e) => setCadence(e.target.value as 'weekly' | 'monthly')}>
              <option value="weekly">{p.weekly}</option>
              <option value="monthly">{p.monthly}</option>
            </select>
          </FormField>
          {error !== '' && <p role="alert" className="text-sm text-[var(--tone-danger-fg)]">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => { setAdding(false); setError(''); }}>{r.cancel}</Button>
            <Button type="submit" block disabled={!local.ready}>{r.save}</Button>
          </div>
        </form>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setAdding(true)} disabled={!local.ready || local.data.drafts.length >= MAX_LOCAL}>
          <Icon name="clock" size={16} /> {r.add}
        </Button>
      </div>
      {templates.length === 0 ? (
        <EmptyState title={r.empty.title} body={r.empty.body} />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="template-list">
          {templates.map((d) => (
            <li key={d.id} className="surface-card flex flex-col gap-2 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">{d.note}</span>
                <span className="tabular-nums text-sm font-semibold">{formatMainnetAmount(d.amount, MAINNET_ASSETS[d.asset], locale)}</span>
              </div>
              <span className="text-xs text-[var(--text-muted)]">{r.cadenceField}: {d.cadence === 'weekly' ? p.weekly : p.monthly}</span>
              <div className="flex gap-2">
                <Link className="tap-target inline-flex items-center text-sm font-medium text-[var(--taply-lime)]" href={requestPrefill(d.asset, d.amount, d.note)}>{r.openRequest}</Link>
                <Button variant="ghost" onClick={() => local.save({ ...local.data, drafts: local.data.drafts.filter((a) => a.id !== d.id) })}>{r.delete}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Merchant home (Testnet layout): receiving account, New sale / Store QR tiles, details, sales. */
export function MainnetMerchantHome({ accountId, details }: { readonly accountId: string; readonly details: ReactNode }) {
  const t = useT();
  const m = t.commerce.merchant;
  return (
    <div className="flex flex-col gap-6">
      <ReceivingAccountCard accountId={accountId} />
      <nav aria-label={m.title} className="flex flex-col gap-3">
        <MerchantTile index={0} primary href={'/m/merchant/register' as Route} icon="request" title={m.newSale.title} body={m.newSale.body} />
        <MerchantTile index={1} href={'/m/merchant/setup' as Route} icon="scan" title={m.discovery.title} body={m.discovery.body} />
      </nav>
      <details className="disclosure">
        <summary className="flex min-h-[44px] cursor-pointer items-center text-sm text-[var(--text-secondary)]">{t.oneTap.payment.details}</summary>
        <div className="flex flex-col gap-3 pb-2">{details}</div>
      </details>
      <ActivityList preview />
    </div>
  );
}
