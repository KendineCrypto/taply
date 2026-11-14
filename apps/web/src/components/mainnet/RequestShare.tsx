'use client';

import Link from 'next/link';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Surface';
import { QrCode } from '@/components/payments/QrCode';
import { ReceiptTicket } from '@/components/experience/ReceiptTicket';
import { useVerifiedMainnetReceipt } from '@/lib/mainnet/use-verified-receipt';
import { useMainnetRequest } from '@/lib/mainnet/hooks';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { assetById } from '@/lib/mainnet/assets';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { displayMemo } from '@/lib/mainnet/commerce';
import { Notice } from './bits';
import { SettlementCheck } from './Settlement';
import { useState } from 'react';

/** The creator stays on this screen: QR → FINAL payout → receipt, without another payment action. */
export function RequestShare({ id, link, amount }: { readonly id: string; readonly link: string; readonly amount: string }) {
  const { read, refresh } = useMainnetRequest(id, true);
  const tr = useMainnetLocale().locale === 'tr';
  const [copied, setCopied] = useState(false);
  const request = read.kind === 'ok' ? read.request : null;
  const verification = useVerifiedMainnetReceipt(request);
  const receiptAsset = request ? assetById(request.terms.assetId) : null;
  const paid = request?.status === 'FINAL_PAID' && request.latestOperation?.status === 'SUCCEEDED';
  if (paid && request && receiptAsset) return <div data-testid="request-paid" className="animate-rise">
    <p role="status" className="mb-3 text-center font-semibold text-[var(--taply-lime)]">{tr ? 'Ödeme alındı' : 'Payment received'}</p>
    <ReceiptTicket compact
      {...(verification?.kind !== 'verified' ? { statusNote: verification?.kind === 'checking' ? (tr ? 'Makbuz kontrol ediliyor…' : 'Checking receipt…') : (tr ? 'Ödeme alındı' : 'Payment received') } : {})}
      status={verification?.kind === 'verified' ? 'verified' : 'contract_paid'}
      {...(verification?.kind === 'verified' ? { celebrateKey: `mainnet:${id}:${verification.proof.transferReceiptId}` } : {})} asset={receiptAsset} amountBaseUnits={request.terms.amountBaseUnits}
      recipientAccountId={request.recipientAccountId} payerAccountId={request.payerAccountId} memo={displayMemo(request.terms.memo)}
      settledAtNs={request.latestOperation?.resolvedAtNs ?? request.fundedAtNs} references={[{ label: tr ? 'Talep' : 'Request', value: id }, ...(verification?.kind === 'verified' ? [{ label: tr ? 'İşlem' : 'Transaction', value: verification.proof.fundingTransactionHash, transaction: true }] : [])]}
      explorerBaseUrl={MAINNET_CONFIG.ok ? MAINNET_CONFIG.explorerBaseUrl : null} checkedVia={request.terms.contractId}
      proofActions={verification?.kind === 'verified' ? undefined : <SettlementCheck key={id} kind="instant" id={id} fixture={read.kind === 'ok' && read.fixture} automatic />}
      actions={<Link href="/m" className="tap-target inline-flex items-center justify-center font-semibold">{tr ? 'Cüzdana dön' : 'Back to wallet'}</Link>} />
  </div>;
  const waiting = request === null || request.status === 'OPEN';
  return <Card><div className="flex flex-col items-center gap-4 text-center" data-testid="request-share">
    <p role="status" className="text-sm font-medium text-[var(--text-secondary)]">{waiting ? (tr ? 'Ödeme bekleniyor' : 'Waiting for payment') : request.status === 'PAYOUT_IN_FLIGHT' ? (tr ? 'Ödeme tamamlanıyor…' : 'Completing payment…') : (tr ? 'Ödeme durumunu kontrol et' : 'Check payment status')}</p>
    <p className="display-amount text-[2rem] leading-none">{amount}</p>
    {waiting && <QrCode value={link} label={tr ? 'Ödeme isteği' : 'Payment request'} />}
    {read.kind === 'error' && <Notice tone="caution" live>{tr ? 'Bağlantı kurulamadı. Ödeme henüz doğrulanmadı; tekrar ödeme istemeyin.' : 'Connection unavailable. Payment is not confirmed yet; do not request another payment.'}</Notice>}
    <details className="w-full text-xs text-[var(--text-muted)]"><summary className="cursor-pointer">{tr ? 'Bağlantı ayrıntıları' : 'Link details'}</summary><p className="mt-2 break-all font-mono" data-testid="request-link">{link}</p></details>
    {waiting && <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } }}>{copied ? (tr ? 'Kopyalandı' : 'Copied') : (tr ? 'Bağlantıyı kopyala' : 'Copy link')}</Button>}
    <Button variant="ghost" onClick={refresh}>{tr ? 'Tekrar kontrol et' : 'Check again'}</Button>
    <a className="text-sm underline" href={`/m/pay/${id}`}>{tr ? 'Ödeme durumunu aç' : 'Open payment status'}</a>
  </div></Card>;
}
