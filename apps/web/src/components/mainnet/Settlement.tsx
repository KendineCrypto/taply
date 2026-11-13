'use client';

import { useState } from 'react';
import {
  verifyMainnetDirectTransfer, verifyMainnetGiftSettlement, verifyMainnetSettlement, verifyMainnetUsdcTransfer,
} from '@taply/near-client';
import type { MainnetSettlementTransaction } from '@taply/near-client';
import { MainnetAccountSchema } from '@taply/shared';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Surface';
import { formatMainnetAmount, MAINNET_ASSETS } from '@/lib/mainnet/assets';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { ESCROW_PROFILE } from '@/lib/mainnet/escrow-profile';
import { GIFT_PROFILE } from '@/lib/mainnet/gift-profile';
import { MAINNET_INDEPENDENT_VERIFIER_AVAILABLE } from '@/lib/mainnet/release-gates';
import { USDC_CODE_HASH, signingProfiles } from '@/lib/mainnet/wallet-ops';
import { Notice } from './bits';

/**
 * Independent settlement checks on Codex's verifiers. Taply has no history
 * index, so the person supplies the transaction hashes (their wallet shows
 * them); nothing is inferred from contract state, wallet or server status.
 * Results are scoped NEAR-side, trust model "configured RPC", and pre-release:
 * the public "Verified Paid" label stays off (MAINNET_INDEPENDENT_VERIFIER_AVAILABLE).
 */
const en = {
  title: 'Independent settlement check',
  lead: 'Paste the transactions from your wallet, one per line as "hash signer". Taply reads the complete FINAL receipt graph itself.',
  leadInstant: 'Line 1: the payment (funding) transaction. Further lines: each payout retry, in order.',
  leadEscrow: 'Line 1: the funding transaction. Line 2: the cancel or release. Further lines: each retry, in order. Do not omit a failed attempt.',
  leadGift: 'One line per payout operation, in order (the claim or refund first, then each retry).',
  check: 'Check settlement', checking: 'Reading FINAL receipts…',
  bad: 'Each line must be a transaction hash followed by the NEAR account that signed it.',
  unavailable: 'Not available on this build: the contract for this receipt is not configured.',
  fixture: 'FIXTURE receipt — there are no chain transactions to check.',
  paid: 'Settlement found: PAID', refunded: 'Settlement found: REFUNDED', claimed: 'Gift settlement found: CLAIMED',
  scope: 'NEAR-side only, read through the configured RPC (not a light client). Pre-release: this is not a public "Verified Paid" label.',
  router: 'Funded through NEAR Intents: this proves delivery on NEAR only, not the customer\'s debit or refund on the origin chain.',
  notVerified: { UNRESOLVED: 'Not settled yet, or the outcome is unresolved (R-2). Nothing is assumed; do not pay again.', EVIDENCE_UNAVAILABLE_OR_MISMATCH: 'These transactions do not prove this settlement, or the evidence is unavailable. Nothing is assumed.' } as Record<string, string>,
  beneficiary: 'Beneficiary', amount: 'Amount', nonce: 'Operation',
  transfer: 'Check this transfer', transferOk: 'Transfer found at a FINAL block and matching exactly (configured RPC; pre-release).', transferBad: 'This transfer could not be matched on Mainnet. Nothing is assumed.',
};
type Copy = typeof en;
const tr: Copy = {
  title: 'Bağımsız ödeme kontrolü',
  lead: 'Cüzdanınızdaki işlemleri satır başına "hash imzalayan" olarak yapıştırın. Taply tüm KESİN makbuz grafiğini kendisi okur.',
  leadInstant: '1. satır: ödeme (fonlama) işlemi. Sonraki satırlar: sırayla her ödeme tekrarı.',
  leadEscrow: '1. satır: fonlama işlemi. 2. satır: iptal veya serbest bırakma. Sonraki satırlar: sırayla her tekrar. Başarısız bir denemeyi atlamayın.',
  leadGift: 'Her ödeme işlemi için bir satır, sırayla (önce talep veya iade, sonra her tekrar).',
  check: 'Ödemeyi kontrol et', checking: 'KESİN makbuzlar okunuyor…',
  bad: 'Her satır bir işlem hash\'i ve onu imzalayan NEAR hesabı olmalı.',
  unavailable: 'Bu sürümde yok: bu makbuzun sözleşmesi yapılandırılmamış.',
  fixture: 'FİKSTÜR makbuzu — kontrol edilecek zincir işlemi yok.',
  paid: 'Ödeme bulundu: ÖDENDİ', refunded: 'Ödeme bulundu: İADE EDİLDİ', claimed: 'Hediye ödemesi bulundu: TALEP EDİLDİ',
  scope: 'Yalnızca NEAR tarafı, yapılandırılmış RPC ile okundu (hafif istemci değil). Yayın öncesi: bu herkese açık bir "Doğrulandı" etiketi değildir.',
  router: 'NEAR Intents ile fonlandı: bu yalnızca NEAR\'daki teslimi kanıtlar, müşterinin kaynak zincirdeki çekimini veya iadesini değil.',
  notVerified: { UNRESOLVED: 'Henüz tamamlanmadı veya sonuç çözülmedi (R-2). Hiçbir şey varsayılmıyor; tekrar ödemeyin.', EVIDENCE_UNAVAILABLE_OR_MISMATCH: 'Bu işlemler bu ödemeyi kanıtlamıyor veya kanıt yok. Hiçbir şey varsayılmıyor.' },
  beneficiary: 'Alıcı', amount: 'Tutar', nonce: 'İşlem',
  transfer: 'Bu transferi kontrol et', transferOk: 'Transfer KESİN blokta bulundu ve tam eşleşiyor (yapılandırılmış RPC; yayın öncesi).', transferBad: 'Bu transfer Mainnet\'te eşleştirilemedi. Hiçbir şey varsayılmıyor.',
};
const COPY = { en, tr };
export const SETTLEMENT_COPY = COPY;

const HASH = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** "hash signer" per line → transactions; any malformed line → null. */
export function parseSettlementLines(text: string): MainnetSettlementTransaction[] | null {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length === 0 || lines.length > 33) return null;
  const out: MainnetSettlementTransaction[] = [];
  for (const line of lines) {
    const [hash, signer, ...rest] = line.split(/\s+/);
    if (rest.length > 0 || !hash || !signer || !HASH.test(hash) || !MainnetAccountSchema.safeParse(signer).success) return null;
    out.push({ transactionHash: hash, signerAccountId: signer });
  }
  return out;
}

type Result = { ok: true; status: 'PAID' | 'REFUNDED' | 'CLAIMED'; router: boolean; detail: string } | { ok: false; reason: string };

export function SettlementCheck({ kind, id, fixture = false }: { readonly kind: 'instant' | 'escrow' | 'gift'; readonly id: string; readonly fixture?: boolean }) {
  const { locale } = useMainnetLocale();
  const c = COPY[locale];
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const instant = MAINNET_CONFIG.ok ? MAINNET_CONFIG.profile : null;
  const available = kind === 'instant' ? instant !== null : kind === 'escrow' ? ESCROW_PROFILE !== null : GIFT_PROFILE !== null;
  async function run() {
    setError(''); setResult(null);
    const txs = parseSettlementLines(text);
    if (txs === null || (kind !== 'gift' && txs.length < 1) || (kind === 'escrow' && txs.length < 2)) { setError(c.bad); return; }
    setBusy(true);
    try {
      if (kind === 'gift') {
        const r = await verifyMainnetGiftSettlement(GIFT_PROFILE!, { giftId: id, operations: txs });
        setResult(r.kind === 'VERIFIED_GIFT_SETTLEMENT' ? { ok: true, status: r.status, router: false, detail: r.giftId } : { ok: false, reason: r.reason });
      } else {
        const [funding, ...rest] = txs;
        const operations = kind === 'instant' ? [funding!, ...rest] : rest;
        const ref = { id, funding: funding!, operations, ...(USDC_CODE_HASH ? { usdcCodeHash: USDC_CODE_HASH } : {}) };
        const r = kind === 'instant' ? await verifyMainnetSettlement({ kind: 'instant', profile: instant! }, ref) : await verifyMainnetSettlement({ kind: 'escrow', profile: ESCROW_PROFILE! }, ref);
        setResult(r.kind === 'VERIFIED_SETTLEMENT'
          ? { ok: true, status: r.status, router: r.routerDelivery, detail: `${r.beneficiary} · #${r.operationNonce} · ${r.settlementTransactionHash}` }
          : { ok: false, reason: r.reason });
      }
    } catch { setResult({ ok: false, reason: 'EVIDENCE_UNAVAILABLE_OR_MISMATCH' }); }
    finally { setBusy(false); }
  }
  return (
    <Card>
      <div className="flex flex-col gap-2" data-testid="settlement-check" data-kind={kind}>
        <h2 className="font-semibold">{c.title}</h2>
        {fixture ? <Notice tone="muted" testId="settlement-fixture">{c.fixture}</Notice> : !available ? <Notice tone="muted" testId="settlement-unavailable">{c.unavailable}</Notice> : (
          <>
            <p className="text-[13px] text-[var(--text-secondary)]">{c.lead} {kind === 'instant' ? c.leadInstant : kind === 'escrow' ? c.leadEscrow : c.leadGift}</p>
            <textarea aria-label={c.title} data-testid="settlement-input" rows={3} spellCheck={false} autoCapitalize="none"
              className="w-full rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] p-2 font-mono text-[12px]" value={text} onChange={(e) => setText(e.target.value)} />
            <Button data-testid="settlement-run" disabled={busy} onClick={() => void run()}>{busy ? c.checking : c.check}</Button>
            {error && <Notice tone="danger" live testId="settlement-error">{error}</Notice>}
            {result !== null && (result.ok
              ? <Notice tone="muted" live testId="settlement-result"><span data-kind="VERIFIED" data-status={result.status} className="font-semibold">{result.status === 'PAID' ? c.paid : result.status === 'REFUNDED' ? c.refunded : c.claimed}</span>
                  <span className="mt-1 block break-all font-mono text-[11px]">{result.detail}</span>
                  {result.router && <span className="mt-1 block text-[12px]">{c.router}</span>}
                  <span className="mt-1 block text-[12px]">{MAINNET_INDEPENDENT_VERIFIER_AVAILABLE ? '' : c.scope}</span></Notice>
              : <Notice tone="caution" live testId="settlement-result"><span data-kind="NOT_VERIFIED" data-reason={result.reason}>{c.notVerified[result.reason] ?? c.notVerified['EVIDENCE_UNAVAILABLE_OR_MISMATCH']}</span></Notice>)}
          </>
        )}
      </div>
    </Card>
  );
}

/** Check one of this account's own executed direct sends (native or USDC) with Codex's direct-transfer readers. */
export function DirectTransferCheck({ from, transactionHash, receiverId, action }: {
  readonly from: string; readonly transactionHash: string; readonly receiverId: string;
  readonly action: { kind: 'transfer'; depositYocto: string } | { kind: 'call'; methodName: string; argsJson: string };
}) {
  const { locale } = useMainnetLocale();
  const c = COPY[locale];
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'bad'>('idle');
  const profiles = signingProfiles();
  let usdc: { to: string; amount: string } | null = null;
  if (action.kind === 'call' && action.methodName === 'ft_transfer') {
    try { const a = JSON.parse(action.argsJson) as { receiver_id?: unknown; amount?: unknown }; if (typeof a.receiver_id === 'string' && typeof a.amount === 'string') usdc = { to: a.receiver_id, amount: a.amount }; } catch { usdc = null; }
  }
  if (profiles === null || (action.kind === 'call' && (usdc === null || !USDC_CODE_HASH))) return null;
  async function run() {
    setState('busy');
    try {
      const ok = action.kind === 'transfer'
        ? (await verifyMainnetDirectTransfer(profiles!.network, { txHash: transactionHash, from, to: receiverId, amountYocto: action.depositYocto })).kind === 'VERIFIED'
        : (await verifyMainnetUsdcTransfer(profiles!.network, { transactionHash, from, to: usdc!.to, amountBaseUnits: usdc!.amount, usdcCodeHash: USDC_CODE_HASH! })).kind === 'VERIFIED_USDC_TRANSFER';
      setState(ok ? 'ok' : 'bad');
    } catch { setState('bad'); }
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" data-testid="direct-check" disabled={state === 'busy'} onClick={() => void run()}>{c.transfer}</Button>
      {action.kind === 'transfer' && <span className="text-[11px]">{formatMainnetAmount(action.depositYocto, MAINNET_ASSETS.NEAR, locale)}</span>}
      {state === 'ok' && <span data-testid="direct-result" data-kind="VERIFIED" className="text-[12px]">{c.transferOk}</span>}
      {state === 'bad' && <span data-testid="direct-result" data-kind="NOT_VERIFIED" className="text-[12px]">{c.transferBad}</span>}
    </span>
  );
}
