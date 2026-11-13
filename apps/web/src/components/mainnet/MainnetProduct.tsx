'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter, usePathname } from 'next/navigation';
import { MainnetAccountSchema } from '@taply/shared';
import { createMainnetAccountReader } from '@taply/near-client';
import { Card, ScreenHeader } from '@/components/primitives/Surface';
import { Button } from '@/components/primitives/Button';
import { QrCode } from '@/components/payments/QrCode';
import { Envelope } from '@/components/gift/Envelope';
import { Icon, type IconName } from '@/components/shell/Icons';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { useMainnetWallet } from '@/lib/mainnet/wallet';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { MAINNET_ASSETS, parseMainnetAmount, formatMainnetAmount } from '@/lib/mainnet/assets';
import { productEn, productTr } from '@/lib/mainnet/product-copy';
import { splitMainnetAmount, parseMainnetScan } from '@/lib/mainnet/product';
import { useLocalProduct } from '@/lib/mainnet/use-product';
import { ActivityList } from './Activity';
import { requestPrefill } from '@/lib/mainnet/prefill';
import { openCamera, stopStream } from '@/lib/qr/camera';
import { createFrameDecoder, type FrameDecoder } from '@/lib/qr/decoder';
import { WalletPanel } from './WalletPanel';
import { Notice } from './bits';

export function useProductCopy() { return useMainnetLocale().locale === 'tr' ? productTr : productEn; }
const inputClass = 'min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-0)] px-3 py-2';
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex flex-col gap-1 text-sm"><span>{label}</span>{children}</label>;
}
export function ProductLinks({ compact = false }: { compact?: boolean }) {
  const c = useProductCopy();
  const links = compact ? [['wallet', c.wallet], ['send', c.send], ['receive', c.receive], ['tools', c.tools]] : [
    ['wallet', c.wallet], ['send', c.send], ['receive', c.receive], ['request/new', c.request], ['pay', c.pay],
    ['scan', c.scan], ['merchant', c.merchant], ['contacts', c.contacts], ['split', c.split], ['recurring', c.recurring],
    ['gift/new', c.gift], ['protected/new', c.protected], ['handshake', c.handshake], ['activity', c.activity], ['settings', c.settings],
  ];
  return <div className="grid grid-cols-2 gap-2">{links.map(([path, title]) => <Link key={path} href={`/m/${path}` as Route} className="pressable flex min-h-12 items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-3 text-sm font-semibold">{title}</Link>)}</div>;
}
export function ProductNav() {
  const c = useProductCopy(); const pathname = usePathname();
  const tabs: [string, string, IconName][] = [['wallet', c.wallet, 'wallet'], ['activity', c.activity, 'activity'], ['tools', 'Tap', 'pay'], ['contacts', c.contacts, 'contacts'], ['settings', c.settings, 'settings']];
  return <nav aria-label={c.tools} className="sticky bottom-0 z-20 grid grid-cols-5 border-t border-[var(--border-subtle)] bg-[var(--surface-0)] pb-[env(safe-area-inset-bottom)]">
    {tabs.map(([path, title, icon]) =>
      <Link key={path} href={`/m/${path}` as Route} aria-current={pathname === `/m/${path}` ? 'page' : undefined} className="tap-target flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-xs font-semibold aria-[current=page]:text-[var(--taply-lime)]"><Icon name={icon} />{title}</Link>)}
  </nav>;
}

export function MainnetProduct({ path }: { path: string }) {
  const c = useProductCopy();
  const section = path.split('/')[0];
  const title = ({ wallet: c.wallet, send: c.send, receive: c.receive, pay: c.pay, scan: c.scan, activity: c.activity,
    contacts: c.contacts, split: c.split, recurring: c.recurring, gift: c.gift, merchant: c.merchant,
    checkout: c.pay, protected: c.protected, receipt: c.receipt, handshake: c.handshake, s: c.handshake,
    tools: c.tools, settings: c.settings } as Record<string, string>)[section ?? ''] ?? c.tools;
  return <div className="flex flex-col gap-4" data-testid="mainnet-product"><ScreenHeader title={title} description={c.readOnly} />
    {section === 'wallet' && <><Card><p>{path === 'wallet' ? c.walletHelp : c.vaultHelp}</p><WalletPanel />
      <div className="mt-3 flex flex-wrap gap-4"><Link href="/m/wallet/create">{c.create}</Link><Link href="/m/wallet/restore">{c.restore}</Link></div></Card><Balances /><ProductLinks compact /></>}
    {section === 'tools' && <ProductLinks />}
    {section === 'send' && <><DraftComposer kind="send" /><PaymentNetworks /><Link href="/m/pay">{c.review}</Link></>}
    {section === 'receive' && <Receive />}
    {(section === 'pay' || section === 'scan') && <><Scan withCamera={section === 'scan'} /><PaymentNetworks /></>}
    {section === 'contacts' && <Contacts />}
    {section === 'split' && <Split />}
    {section === 'recurring' && <DraftComposer kind="recurring" />}
    {section === 'gift' && <><Notice tone="caution">{c.giftHelp}</Notice>{path === 'gift/new' ? <DraftComposer kind="gift" /> : <Notice tone="caution">{c.blocked}</Notice>}</>}
    {(section === 'activity' || section === 'merchant') && <><p className="text-sm text-[var(--text-secondary)]">{section === 'merchant' ? c.merchantHelp : c.history}</p><ActivityList removeLabel={c.remove} /><TrackedRequests /><Link href="/m/request/new" className="tap-target">{c.request}</Link>{section === 'merchant' && <Receive merchant />}</>}
    {section === 'checkout' && <Card><p className="break-all font-mono">{path.slice(9)}</p><p className="mt-2">{c.checkoutHelp}</p><Link href="/m/pay">{c.pay}</Link></Card>}
    {section === 'protected' && <><Notice tone="caution">{c.protectedHelp}</Notice><Notice tone="caution">{c.blocked}</Notice></>}
    {(section === 's' || section === 'handshake') && <Notice tone="caution">{c.handshakeHelp}</Notice>}
    {section === 'receipt' && <><Notice tone="caution">{c.receiptHelp}</Notice><Link href={`/m/pay/${path.slice(8)}` as Route}>{c.open}</Link></>}
    {section === 'settings' && <><Card><p>{c.local}</p><p className="mt-2">{c.vaultHelp}</p><WalletPanel /></Card><PaymentNetworks /><ProductLinks /></>}
  </div>;
}
function PaymentNetworks() { const c = useProductCopy(); return <Card><h2 className="font-semibold">{c.routes}</h2><p className="mt-2 text-sm text-[var(--text-secondary)]">{c.routesHelp}</p></Card>; }

function Balances() {
  const c = useProductCopy(); const { locale } = useMainnetLocale(); const w = useMainnetWallet();
  const [input, setInput] = useState(''); const account = input || w.accountId || '';
  const [result, setResult] = useState<Awaited<ReturnType<ReturnType<typeof createMainnetAccountReader>['readBalances']>> | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const sequence = useRef(0);
  useEffect(() => () => { sequence.current++; }, []);
  async function read() {
    const id = ++sequence.current; setResult(null); setError('');
    if (!MainnetAccountSchema.safeParse(account).success || !MAINNET_CONFIG.ok) { setError(c.invalid); return; }
    setBusy(true);
    try { const data = await createMainnetAccountReader({ network: 'near-mainnet', rpcUrl: MAINNET_CONFIG.rpcUrl, rpcProviderId: MAINNET_CONFIG.rpcProviderId }).readBalances(account);
      if (id === sequence.current) setResult(data);
    } catch { if (id === sequence.current) setError(c.unknown); }
    finally { if (id === sequence.current) setBusy(false); }
  }
  const visible = result?.accountId === account ? result : null;
  return <Card><div className="flex flex-col gap-3"><Field label={c.account}><input className={inputClass} value={account} onChange={e => { sequence.current++; setBusy(false); setInput(e.target.value); setResult(null); }} autoCapitalize="none" spellCheck={false} /></Field>
    <Button disabled={busy} onClick={() => void read()}>{c.refresh}</Button>
    {visible ? <><p>{formatMainnetAmount(visible.native, MAINNET_ASSETS.NEAR, locale)}</p><p>{formatMainnetAmount(visible.usdc, MAINNET_ASSETS.USDC, locale)}</p><p className="break-all text-xs">RPC · final · {visible.providerId} · {visible.blockHash}</p></> : <p role="status">{error || c.unknown}</p>}
    <p className="text-xs text-[var(--text-secondary)]">{c.balanceHelp}</p></div></Card>;
}
function Receive({ merchant = false }: { merchant?: boolean }) {
  const c = useProductCopy(); const { accountId } = useMainnetWallet();
  const origin = MAINNET_CONFIG.ok ? MAINNET_CONFIG.shareOrigin : null;
  const value = accountId && (merchant ? origin ? `${origin}/m/checkout/${accountId}` : null : accountId);
  return <Card><p className="mb-3">{merchant ? c.checkoutHelp : c.receiveHelp}</p><WalletPanel />{value && <div className="mt-4 flex flex-col items-center gap-3"><QrCode value={value} label={merchant ? c.merchant : c.account} /><p className="break-all text-sm">{value}</p></div>}</Card>;
}
function Contacts() {
  const c = useProductCopy(); const local = useLocalProduct(); const [name, setName] = useState(''); const [id, setId] = useState(''); const [error, setError] = useState('');
  return <><p>{c.local}</p><Card><form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault();
    if (!MainnetAccountSchema.safeParse(id).success || !name.trim()) { setError(c.invalid); return; }
    setError(''); local.save({ ...local.data, contacts: [...local.data.contacts.filter(v => v.id !== id), { id, label: name.trim() }] });
  }}><Field label={c.name}><input className={inputClass} maxLength={60} value={name} onChange={e => setName(e.target.value)} /></Field><Field label={c.account}><input className={inputClass} value={id} onChange={e => setId(e.target.value)} autoCapitalize="none" /></Field><Button type="submit" disabled={!local.ready}>{c.save}</Button></form></Card>
    {!local.ready && <WalletRequired />}<p role="status">{error || local.message}</p><ul className="flex flex-col gap-2">{local.data.contacts.map(v => <li key={v.id}><Card><p>{v.label}</p><p className="break-all text-sm">{v.id}</p><Button variant="ghost" onClick={() => local.save({ ...local.data, contacts: local.data.contacts.filter(a => a.id !== v.id) })}>{c.remove}</Button></Card></li>)}</ul></>;
}
function WalletRequired() { const c = useProductCopy(); return <Card><p className="mb-2">{c.connectFirst}</p><WalletPanel /></Card>; }
function Split() {
  const c = useProductCopy(); const [amount, setAmount] = useState(''); const [count, setCount] = useState(2); const [asset, setAsset] = useState<'NEAR' | 'USDC'>('USDC'); const [shares, setShares] = useState<string[]>([]); const [error, setError] = useState('');
  return <><Card><form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); setShares([]); setError(''); const parsed = parseMainnetAmount(amount, MAINNET_ASSETS[asset]);
    try { if (!parsed.ok) throw new Error(); setShares(splitMainnetAmount(parsed.baseUnits, count)); } catch { setError(c.invalid); }
  }}><AssetAmount asset={asset} amount={amount} onAsset={v => { setAsset(v); setShares([]); }} onAmount={v => { setAmount(v); setShares([]); }} /><Field label={c.count}><input className={inputClass} type="number" min={2} max={50} value={count} onChange={e => { setCount(e.target.valueAsNumber); setShares([]); }} /></Field><Button type="submit">{c.calculate}</Button></form></Card><p role="status">{error}</p><ol data-testid="split-shares">{shares.map((share, i) => <li key={i} className="flex items-center justify-between gap-3"><span>{i + 1}. {formatMainnetAmount(share, MAINNET_ASSETS[asset])}</span><Link className="tap-target inline-flex items-center underline" href={requestPrefill(asset, share, `Split ${i + 1}/${shares.length}`)}>{c.request}</Link></li>)}</ol><p>{c.splitHelp}</p><Link href="/m/request/new">{c.request}</Link></>;
}
function AssetAmount({ asset, amount, onAsset, onAmount }: { asset: 'NEAR' | 'USDC'; amount: string; onAsset: (v: 'NEAR' | 'USDC') => void; onAmount: (v: string) => void }) {
  const c = useProductCopy(); return <><Field label={c.asset}><select className={inputClass} value={asset} onChange={e => onAsset(e.target.value as 'NEAR' | 'USDC')}><option>NEAR</option><option>USDC</option></select></Field><Field label={c.amount}><input className={inputClass} inputMode="decimal" value={amount} onChange={e => onAmount(e.target.value)} /></Field></>;
}
function DraftComposer({ kind }: { kind: 'send' | 'recurring' | 'gift' }) {
  const c = useProductCopy(); const local = useLocalProduct(); const [recipient, setRecipient] = useState(''); const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState<'NEAR' | 'USDC'>('NEAR'); const [note, setNote] = useState(''); const [cadence, setCadence] = useState<'weekly' | 'monthly'>('monthly');
  const [giftType, setGiftType] = useState<'personal' | 'open'>('personal'); const [design, setDesign] = useState(0); const [open, setOpen] = useState(false); const [message, setMessage] = useState('');
  function submit() { const parsed = parseMainnetAmount(amount, MAINNET_ASSETS[asset]);
    if (!parsed.ok || new TextEncoder().encode(note).length > 280 || ((kind !== 'gift' || giftType === 'personal') && !MainnetAccountSchema.safeParse(recipient).success)) { setMessage(c.invalid); return; }
    if (kind === 'send') { setMessage(c.blocked); return; }
    setMessage(''); local.save({ ...local.data, drafts: [...local.data.drafts, { id: crypto.randomUUID(), kind: kind === 'recurring' ? 'recurring' : giftType, recipient: kind === 'gift' && giftType === 'open' ? '' : recipient, amount: parsed.baseUnits, asset, note, cadence, design }] });
  }
  const drafts = local.data.drafts.filter(d => kind === 'recurring' ? d.kind === 'recurring' : d.kind !== 'recurring');
  return <><Notice tone="caution">{kind === 'recurring' ? c.noAuto : c.blocked}</Notice><Card><form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); submit(); }}>
    {kind === 'gift' && <Field label={c.gift}><select className={inputClass} value={giftType} onChange={e => setGiftType(e.target.value as 'personal' | 'open')}><option value="personal">{c.personal}</option><option value="open">{c.openGift}</option></select></Field>}
    {(kind !== 'gift' || giftType === 'personal') && <Field label={c.recipient}><input className={inputClass} autoCapitalize="none" value={recipient} onChange={e => setRecipient(e.target.value)} list="mainnet-contacts" /><datalist id="mainnet-contacts">{local.data.contacts.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</datalist></Field>}
    <AssetAmount asset={asset} amount={amount} onAsset={setAsset} onAmount={setAmount} />
    <Field label={c.note}><textarea className={inputClass} maxLength={280} value={note} onChange={e => setNote(e.target.value)} /></Field>
    {kind === 'recurring' && <Field label={c.cadence}><select className={inputClass} value={cadence} onChange={e => setCadence(e.target.value as 'weekly' | 'monthly')}><option value="weekly">{c.weekly}</option><option value="monthly">{c.monthly}</option></select></Field>}
    {kind === 'gift' && <><Field label={c.design}><select className={inputClass} value={design} onChange={e => setDesign(['0', '1', '2', '3'].indexOf(e.target.value))}>{['Forest', 'Lime', 'Linen', 'Midnight'].map((v, i) => <option key={v} value={i}>{v}</option>)}</select></Field><Envelope design={design} open={open} label={c.draft}><div className="p-6 text-center text-[#0B120E]"><p className="font-semibold">{c.draft}</p><p className="mt-3 whitespace-pre-wrap break-words">{note}</p></div></Envelope><Button type="button" variant="secondary" onClick={() => setOpen(!open)}>{open ? c.close : c.preview}</Button></>}
    <Button type="submit" disabled={kind === 'send' || !local.ready}>{kind === 'send' ? c.send : c.save}</Button></form></Card>
    {kind !== 'send' && <><p>{c.local}</p>{!local.ready && <WalletRequired />}<p role="status">{message || local.message}</p><ul className="flex flex-col gap-2">{drafts.map(d => <li key={d.id}><Card><p>{c.draft} · {formatMainnetAmount(d.amount, MAINNET_ASSETS[d.asset])}</p><p className="break-all text-sm">{d.recipient}</p><p className="whitespace-pre-wrap break-words">{d.note}</p>{d.kind === 'recurring' && <Link className="tap-target inline-flex items-center underline" href={requestPrefill(d.asset, d.amount, d.note)}>{c.request}</Link>}<Button variant="ghost" onClick={() => local.save({ ...local.data, drafts: local.data.drafts.filter(a => a.id !== d.id) })}>{c.remove}</Button></Card></li>)}</ul></>}
  </>;
}
function TrackedRequests() {
  const c = useProductCopy(); const local = useLocalProduct(); const [id, setId] = useState(''); const [error, setError] = useState('');
  return <><Card><p className="mb-3">{c.tracked}</p><form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); if (!/^[0-9a-f]{64}$/.test(id)) { setError(c.invalid); return; } setError(''); local.save({ ...local.data, requests: [...new Set([...local.data.requests, id])] }); }}><Field label={c.requestId}><input className={inputClass} value={id} onChange={e => setId(e.target.value)} /></Field><Button type="submit" disabled={!local.ready}>{c.track}</Button></form></Card>{!local.ready && <WalletRequired />}<p role="status">{error || local.message}</p></>;
}
function Scan({ withCamera }: { withCamera: boolean }) {
  const c = useProductCopy(); const router = useRouter(); const [text, setText] = useState(''); const [error, setError] = useState(''); const [running, setRunning] = useState(false);
  const video = useRef<HTMLVideoElement>(null); const stream = useRef<MediaStream | null>(null); const decoder = useRef<FrameDecoder | null>(null); const sequence = useRef(0);
  function stop() { sequence.current++; stopStream(stream.current); stream.current = null; decoder.current?.dispose?.(); decoder.current = null; setRunning(false); }
  useEffect(() => { const hide = () => { if (document.hidden) { sequence.current++; stopStream(stream.current); decoder.current?.dispose?.(); setRunning(false); } }; document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); sequence.current++; stopStream(stream.current); decoder.current?.dispose?.(); }; }, []);
  function accept(value: string) { const route = parseMainnetScan(value, location.origin); if (!route) { setError(c.invalid); return false; } stop(); router.push(route as Route); return true; }
  async function start() {
    stop(); const id = sequence.current; setError(''); setRunning(true);
    try {
      const media = await openCamera(navigator.mediaDevices, window.isSecureContext);
      if (id !== sequence.current) { stopStream(media); return; } stream.current = media;
      const frame = await createFrameDecoder(); if (id !== sequence.current) { frame.dispose?.(); return; } decoder.current = frame;
      if (!video.current) throw new Error(); video.current.srcObject = media; await video.current.play();
      const loop = async () => { if (id !== sequence.current || !video.current) return; const value = await frame.decode(video.current); if (id !== sequence.current) return; if (value && accept(value)) return; setTimeout(() => void loop(), 250); }; void loop();
    } catch { if (id === sequence.current) { stop(); setError(c.cameraError); } }
  }
  return <Card><div className="flex flex-col gap-3"><p>{c.scanHelp}</p>{withCamera && <><video ref={video} muted playsInline className={running ? 'aspect-square w-full rounded-xl object-cover' : 'hidden'} /><Button onClick={() => running ? stop() : void start()}>{running ? c.stop : c.camera}</Button></>}<form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); accept(text); }}><Field label={c.link}><input className={inputClass} value={text} onChange={e => setText(e.target.value)} autoComplete="off" /></Field><Button type="submit">{c.open}</Button></form><p role="status">{error}</p></div></Card>;
}
