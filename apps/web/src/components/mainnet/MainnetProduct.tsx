'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { Card, ScreenHeader } from '@/components/primitives/Surface';
import { Button } from '@/components/primitives/Button';
import { QrCode } from '@/components/payments/QrCode';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { productEn, productTr } from '@/lib/mainnet/product-copy';
import { parseMainnetScan, mainnetScanInput } from '@/lib/mainnet/product';
import { ScanEntry } from '@/components/scan/ScanEntry';
import { useLocalProduct } from '@/lib/mainnet/use-product';
import { ActivityList } from './Activity';
import { WalletCreate, WalletRestore, WalletSend } from './Wallet';
import { MainnetWalletPage } from './MainnetWalletPage';
import { ProtectedFixtures } from './Protected';
import { LedgerPanel } from './Operation';
import { MerchantCheckout, MerchantRegister } from './Merchant';
import { ProtectedCreate, ProtectedRequestPage } from './ProtectedLive';
import { GiftMainnet } from './GiftMainnet';
import { PersonalGiftOpen } from './GiftPages';
import { MainnetGiftWizard } from './GiftWizard';
import { openCamera, stopStream } from '@/lib/qr/camera';
import { createFrameDecoder, type FrameDecoder } from '@/lib/qr/decoder';
import { WalletPanel } from './WalletPanel';
import { ReceiveCard } from '@/components/wallet/ReceiveCard';
import { NoWalletCard } from './NoWalletCard';
import { MainnetContacts, MainnetMerchantHome, MainnetRecurring, MainnetSplit } from './MainnetTools';
import { ActivityEmptyView, MainnetSettingsView, MerchantHeader, RecurringPill, ToolNoWallet } from './ParityScreens';
import { useT } from '@/lib/i18n/provider';
import { useCurrentMainnetAccount } from './MainnetShell';
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
export function MainnetProduct({ path }: { path: string }) {
  const c = useProductCopy();
  const t = useT();
  const { accountId } = useCurrentMainnetAccount();
  const section = path.split('/')[0];
  const title = ({ wallet: c.wallet, send: c.send, receive: c.receive, pay: c.pay, scan: c.scan, activity: c.activity,
    contacts: c.contacts, split: c.split, recurring: c.recurring, gift: c.gift, merchant: c.merchant,
    checkout: c.pay, protected: c.protected, receipt: c.receipt, handshake: c.handshake, s: c.handshake,
    tools: c.tools, settings: c.settings } as Record<string, string>)[section ?? ''] ?? c.tools;
  if (section === 'scan' || section === 'pay') {
    // The Testnet Pay entry + fullscreen QR scanner, with the Mainnet /m/ link parser.
    return <div data-testid="mainnet-product"><ScanEntry payPath={(id) => `/m/pay/${id}`} checkoutPath={(a) => `/m/checkout/${a}`} parse={(text) => mainnetScanInput(text, window.location.origin)} /></div>;
  }
  // Testnet page headers (same words, Mainnet network) for every product screen.
  const tool = t.tools;
  const header: { title: string; description?: string } | 'merchant' | 'none' = section === 'send' ? { title: t.screens.send, description: t.walletUx.send.subtitle }
    : section === 'receive' ? { title: t.screens.receive, description: t.walletUx.receive.subtitle }
    : section === 'activity' ? { title: t.oneTap.activity.title }
    : section === 'merchant' && path === 'merchant' ? 'merchant'
    : path === 'wallet' ? 'none'
    : section === 'split' ? { title: tool.split.title, description: tool.split.description }
    : section === 'recurring' ? { title: tool.recurring.title, description: tool.recurring.description }
    : section === 'contacts' ? { title: tool.contacts.title, description: tool.contacts.description }
    : section === 'settings' ? { title: t.screens.settings }
    : section === 'gift' ? { title: t.gift.title }
    : path === 'protected/new' ? { title: t.protectedFlow.newTitle }
    : { title };
  const noWallet = accountId === null;
  return <div className="flex flex-col gap-4" data-testid="mainnet-product">{header === 'none' ? null : header === 'merchant' ? <MerchantHeader /> : <ScreenHeader title={header.title} {...(header.description !== undefined ? { description: header.description } : {})} />}
    {section === 'recurring' && <RecurringPill />}
    {path === 'wallet/create' && <WalletCreate />}
    {path === 'wallet/restore' && <><WalletRestore /><p className="px-1 text-xs leading-relaxed text-[var(--text-muted)]">{c.vaultHelp}</p></>}
    {path === 'wallet' && <MainnetWalletPage />}
    {section === 'tools' && <ProductLinks />}
    {section === 'send' && <WalletSend />}
    {section === 'receive' && <Receive />}
    {(section === 'pay' || section === 'scan') && <><Scan withCamera={section === 'scan'} /><PaymentNetworks /></>}
    {section === 'contacts' && <MainnetContacts />}
    {section === 'split' && (noWallet ? <ToolNoWallet kind="split" /> : <MainnetSplit />)}
    {section === 'recurring' && (noWallet ? <ToolNoWallet kind="recurring" /> : <MainnetRecurring />)}
    {section === 'gift' && (path === 'gift/new' ? <><MainnetGiftWizard />{MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures && <GiftMainnet />}</> : path === 'gift/p' ? <PersonalGiftOpen /> : <Notice tone="caution">{c.blocked}</Notice>)}
    {path === 'merchant/register' && <MerchantRegister />}
    {path === 'merchant/setup' && <Receive merchant />}
    {section === 'activity' && noWallet && <ActivityEmptyView />}
    {path === 'merchant' && noWallet && <NoWalletCard text={t.commerce.merchant.connectFirst} />}
    {section === 'activity' && !noWallet && (
      <>
        <ActivityList />
        <details className="disclosure px-1">
          <summary className="flex min-h-[var(--tap-target)] cursor-pointer items-center text-sm text-[var(--text-secondary)]">{t.oneTap.payment.details}</summary>
          <div className="flex flex-col gap-3 pb-2"><p className="text-sm text-[var(--text-secondary)]">{c.history}</p><TrackedRequests /><LedgerPanel /></div>
        </details>
      </>
    )}
    {path === 'merchant' && !noWallet && accountId !== null && (
      <MainnetMerchantHome accountId={accountId} details={<><p className="text-sm text-[var(--text-secondary)]">{c.merchantHelp}</p><Receive merchant /><TrackedRequests /></>} />
    )}
    {section === 'checkout' && <MerchantCheckout account={path.slice(9)} />}
    {section === 'protected' && <>{/^protected\/[0-9a-f]{64}(\/receipt)?$/.test(path) ? <ProtectedRequestPage id={path.slice(10, 74)} /> : <><ProtectedCreate />{MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures && <ProtectedFixtures />}</>}</>}
    {(section === 's' || section === 'handshake') && <Notice tone="caution">{c.handshakeHelp}</Notice>}
    {section === 'receipt' && <><Notice tone="caution">{c.receiptHelp}</Notice><Link href={`/m/pay/${path.slice(8)}` as Route}>{c.open}</Link></>}
    {section === 'settings' && <MainnetSettingsView extra={<PaymentNetworks />} />}
  </div>;
}
function PaymentNetworks() { const c = useProductCopy(); return <Card><h2 className="font-semibold">{c.routes}</h2><p className="mt-2 text-sm text-[var(--text-secondary)]">{c.routesHelp}</p></Card>; }

function Receive({ merchant = false }: { merchant?: boolean }) {
  const c = useProductCopy(); const t = useT(); const { accountId } = useCurrentMainnetAccount();
  // Personal receive: the Testnet receive card (address + QR + copy/share), Mainnet account.
  if (!merchant && accountId) return <ReceiveCard accountId={accountId} />;
  if (!merchant) return <NoWalletCard text={t.receive.connectFirst} />;
  const origin = MAINNET_CONFIG.ok ? MAINNET_CONFIG.shareOrigin : null;
  const value = accountId && (merchant ? origin ? `${origin}/m/checkout/${accountId}` : null : accountId);
  return <Card><p className="mb-3">{merchant ? c.checkoutHelp : c.receiveHelp}</p><WalletPanel />{value && <div className="mt-4 flex flex-col items-center gap-3"><QrCode value={value} label={merchant ? c.merchant : c.account} /><p className="break-all text-sm">{value}</p></div>}</Card>;
}
function WalletRequired() { const c = useProductCopy(); return <Card><p className="mb-2">{c.connectFirst}</p><WalletPanel /></Card>; }
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
