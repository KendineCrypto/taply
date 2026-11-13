'use client';

import { useState } from 'react';
import {
  MainnetEscrowConfigSchema,
  prepareMainnetCancelProtected,
  prepareMainnetReleaseProtected,
  prepareMainnetRetryProtectedTransfer,
} from '@taply/near-client';
import type { MainnetEscrowConfig } from '@taply/near-client';
import { MainnetEscrowRequestSchema } from '@taply/shared';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Surface';
import { nsToDate } from '@/lib/format/time';
import { formatMainnetAmount, MAINNET_ASSETS } from '@/lib/mainnet/assets';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import open from '@/lib/mainnet/escrow-fixtures/protected-open.json';
import locked from '@/lib/mainnet/escrow-fixtures/protected-locked.json';
import releaseInFlight from '@/lib/mainnet/escrow-fixtures/protected-release-in-flight.json';
import refundInFlight from '@/lib/mainnet/escrow-fixtures/protected-refund-in-flight.json';
import releaseFailed from '@/lib/mainnet/escrow-fixtures/protected-release-failed.json';
import refundFailed from '@/lib/mainnet/escrow-fixtures/protected-refund-failed.json';
import finalPaid from '@/lib/mainnet/escrow-fixtures/protected-final-paid.json';
import cancelledRefunded from '@/lib/mainnet/escrow-fixtures/protected-cancelled-refunded.json';
import configFixture from '@/lib/mainnet/escrow-fixtures/protected-config.json';
import { CallPreview, Notice, Row } from './bits';

/**
 * Protected Pay on Mainnet, bound to Codex's escrow candidate
 * (contracts/payments-protected-mainnet 0.7.0-mainnet) through its typed
 * builders. The screen shows the contract's own state and derives every
 * available action by asking the reviewed builder: if the builder refuses,
 * the action is not offered. Escrow transaction submission stays disabled
 * pending release approval; no escrow account is configured or deployed.
 *
 * Fixture mode renders the Rust-emitted request states recorded by Codex's
 * sandbox (packages/near-client/test/fixtures/mainnet-protocol), copied
 * verbatim (a test asserts they are identical).
 */
type Req = ReturnType<typeof MainnetEscrowRequestSchema.parse>;
export const ESCROW_FIXTURES: ReadonlyArray<{ name: string; raw: unknown }> = [
  { name: 'open', raw: open }, { name: 'locked', raw: locked }, { name: 'release-in-flight', raw: releaseInFlight },
  { name: 'refund-in-flight', raw: refundInFlight }, { name: 'release-failed', raw: releaseFailed },
  { name: 'refund-failed', raw: refundFailed }, { name: 'final-paid', raw: finalPaid }, { name: 'cancelled-refunded', raw: cancelledRefunded },
];

const protectedEn = {
  title: 'Protected Pay',
  lead: 'The payer funds an escrow. The merchant is paid only after the cancellation window ends and someone releases it; until then the payer can cancel and is refunded.',
  fixture: 'FIXTURE — request states emitted by the escrow contract in a local NEAR sandbox. Not on Mainnet.',
  notConfigured: 'No Mainnet escrow contract is configured or approved for deployment. Protected Pay cannot be used with real funds yet.',
  state: {
    OPEN: 'Waiting for the protected payment',
    LOCKED: 'Locked — NOT PAID to the merchant yet',
    RELEASE_IN_FLIGHT: 'Release in progress — not final',
    REFUND_IN_FLIGHT: 'Refund in progress — not final',
    RELEASE_FAILED_RECOVERABLE: 'Release transfer failed — funds held by the contract',
    REFUND_FAILED_RECOVERABLE: 'Refund transfer failed — funds held by the contract',
    FINAL_PAID: 'Released to the merchant — Payment recorded (contract state)',
    CANCELLED_REFUNDED: 'Cancelled — refunded to the payer',
    CANCELLED_UNFUNDED: 'Cancelled before payment',
  } as Record<string, string>,
  inFlightNote: 'The transfer may already have happened. Its result has not been recorded (R-2). Nothing is retried automatically; do not pay or release again.',
  lockedNote: 'Locked funds are not paid. A deadline passing does not pay the merchant by itself.',
  amount: 'Amount', payer: 'Payer', merchant: 'Merchant', cutoff: 'Cancellation window ends', contract: 'Contract', status: 'Contract status',
  rights: 'Payer rights', rightsText: 'Until the window ends the payer can cancel and is refunded in full. After it ends, anyone can release the funds to the merchant.',
  when: 'Viewing as of', before: 'Before the window ends', after: 'After the window ends',
  cancel: 'Cancel and refund (payer)', release: 'Release to merchant', retryRefund: 'Retry refund (payer)', retryRelease: 'Retry payout (merchant)',
  noAction: 'No action is possible in this state.',
  disabled: 'Escrow transactions are disabled until the separate escrow release approval. Nothing was signed.',
  call: 'Transaction the wallet would sign',
};
type ProtectedCopy = typeof protectedEn;
const protectedTr: ProtectedCopy = {
  title: 'Korumalı Ödeme',
  lead: 'Ödeyen bir emaneti fonlar. İşletme yalnızca iptal süresi bittikten ve biri serbest bıraktıktan sonra ödenir; o zamana kadar ödeyen iptal edip iade alabilir.',
  fixture: 'FİKSTÜR — yerel NEAR sandbox\'ta emanet sözleşmesinin ürettiği talep durumları. Mainnet\'te değil.',
  notConfigured: 'Yapılandırılmış veya dağıtım için onaylanmış bir Mainnet emanet sözleşmesi yok. Korumalı Ödeme henüz gerçek parayla kullanılamaz.',
  state: {
    OPEN: 'Korumalı ödeme bekleniyor',
    LOCKED: 'Kilitli — işletmeye henüz ÖDENMEDİ',
    RELEASE_IN_FLIGHT: 'Serbest bırakma sürüyor — kesin değil',
    REFUND_IN_FLIGHT: 'İade sürüyor — kesin değil',
    RELEASE_FAILED_RECOVERABLE: 'Serbest bırakma transferi başarısız — para sözleşmede',
    REFUND_FAILED_RECOVERABLE: 'İade transferi başarısız — para sözleşmede',
    FINAL_PAID: 'İşletmeye serbest bırakıldı — Ödeme kaydedildi (sözleşme durumu)',
    CANCELLED_REFUNDED: 'İptal edildi — ödeyene iade edildi',
    CANCELLED_UNFUNDED: 'Ödemeden önce iptal edildi',
  },
  inFlightNote: 'Transfer gerçekleşmiş olabilir. Sonucu kaydedilmedi (R-2). Hiçbir şey otomatik tekrarlanmaz; tekrar ödemeyin veya serbest bırakmayın.',
  lockedNote: 'Kilitli para ödenmiş değildir. Sürenin dolması tek başına işletmeye ödeme yapmaz.',
  amount: 'Tutar', payer: 'Ödeyen', merchant: 'İşletme', cutoff: 'İptal süresinin bitişi', contract: 'Sözleşme', status: 'Sözleşme durumu',
  rights: 'Ödeyenin hakları', rightsText: 'Süre bitene kadar ödeyen iptal edip tam iade alabilir. Süre bittikten sonra herkes parayı işletmeye serbest bırakabilir.',
  when: 'Görünüm zamanı', before: 'Süre bitmeden önce', after: 'Süre bittikten sonra',
  cancel: 'İptal et ve iade al (ödeyen)', release: 'İşletmeye serbest bırak', retryRefund: 'İadeyi tekrar dene (ödeyen)', retryRelease: 'Ödemeyi tekrar dene (işletme)',
  noAction: 'Bu durumda yapılabilecek bir işlem yok.',
  disabled: 'Ayrı emanet sürüm onayına kadar emanet işlemleri kapalı. Hiçbir şey imzalanmadı.',
  call: 'Cüzdanın imzalayacağı işlem',
};
export const PROTECTED_COPY = { en: protectedEn, tr: protectedTr };

interface Action { readonly label: string; readonly call: ReturnType<typeof prepareMainnetCancelProtected> }

/** Every action the reviewed builders accept for this request at this time. */
export function availableActions(c: ProtectedCopy, config: MainnetEscrowConfig, contractId: string, r: Req, observedAtNs: string): Action[] {
  const out: Action[] = [];
  const attempt = (label: string, build: () => Action['call']) => { try { out.push({ label, call: build() }); } catch { /* builder refused: not offered */ } };
  if (r.payerAccountId !== null) attempt(c.cancel, () => prepareMainnetCancelProtected({ contractId, config, request: r, signerAccountId: r.payerAccountId!, observedAtNs }));
  attempt(c.release, () => prepareMainnetReleaseProtected({ contractId, config, request: r, observedAtNs }));
  const op = r.latestOperation;
  if (op !== null) {
    attempt(op.kind === 'PROTECTED_REFUND' ? c.retryRefund : c.retryRelease, () => prepareMainnetRetryProtectedTransfer({ contractId, config, request: r, signerAccountId: op.destinationAccountId }));
  }
  return out;
}

export function ProtectedFixtures() {
  const { locale } = useMainnetLocale();
  const c = PROTECTED_COPY[locale];
  const [pick, setPick] = useState('locked');
  const [after, setAfter] = useState(false);
  if (!(MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures)) return <Notice tone="caution">{c.notConfigured}</Notice>;
  const config = MainnetEscrowConfigSchema.parse(configFixture);
  const entry = ESCROW_FIXTURES.find((f) => f.name === pick)!;
  const r = MainnetEscrowRequestSchema.parse(entry.raw);
  const cutoff = r.cancelUntilNs;
  const observed = cutoff === null ? r.createdAtNs : (BigInt(cutoff) + (after ? 1_000_000_000n : -30_000_000_000n)).toString();
  const actions = availableActions(c, config, config.contractId, r, observed);
  const inFlight = r.status.endsWith('_IN_FLIGHT');
  return (
    <div className="flex flex-col gap-3" data-testid="protected-mainnet">
      <Notice tone="muted">{c.fixture}</Notice>
      <p className="text-[14px] text-[var(--text-secondary)]">{c.lead}</p>
      <div className="flex flex-wrap gap-2" role="group">
        {ESCROW_FIXTURES.map((f) => (
          <button key={f.name} type="button" data-testid={`escrow-${f.name}`} aria-pressed={f.name === pick} onClick={() => setPick(f.name)}
            className={`pressable rounded-full border px-3 py-1.5 text-[12px] font-mono ${f.name === pick ? 'border-[var(--taply-lime)] bg-[var(--tone-success-bg)]' : 'border-[var(--border-subtle)]'}`}>{f.name}</button>
        ))}
      </div>
      <Card>
        <p data-testid="escrow-state" data-status={r.status} className="text-[17px] font-semibold">{c.state[r.status] ?? r.status}</p>
        {r.status === 'LOCKED' && <p className="mt-1 text-[13px] text-[var(--tone-caution-fg)]">{c.lockedNote}</p>}
        {inFlight && <p data-testid="escrow-r2" role="alert" className="mt-1 text-[13px] font-semibold text-[var(--tone-caution-fg)]">{c.inFlightNote}</p>}
        <dl className="mt-2">
          <Row label={c.amount}>{formatMainnetAmount(r.terms.amountBaseUnits, MAINNET_ASSETS.NEAR, locale)}</Row>
          <Row label={c.merchant} mono>{r.recipientAccountId}</Row>
          {r.payerAccountId && <Row label={c.payer} mono>{r.payerAccountId}</Row>}
          {cutoff && <Row label={c.cutoff}>{nsToDate(cutoff).toISOString()}</Row>}
          <Row label={c.status} mono>{r.status}</Row>
          <Row label={c.contract} mono>{config.contractId} · {config.contractVersion}</Row>
        </dl>
        <p className="mt-2 text-[12px] text-[var(--text-muted)]"><span className="font-semibold">{c.rights}: </span>{c.rightsText}</p>
      </Card>
      {cutoff && (
        <div className="flex gap-2" role="group" aria-label={c.when}>
          <Button variant={after ? 'ghost' : 'secondary'} data-testid="escrow-before" onClick={() => setAfter(false)}>{c.before}</Button>
          <Button variant={after ? 'secondary' : 'ghost'} data-testid="escrow-after" onClick={() => setAfter(true)}>{c.after}</Button>
        </div>
      )}
      <Card>
        <ul className="flex flex-col gap-3" data-testid="escrow-actions">
          {actions.length === 0 && <li className="text-[13px] text-[var(--text-secondary)]" data-testid="escrow-no-action">{c.noAction}</li>}
          {actions.map((a) => (
            <li key={a.label} data-method={a.call.methodName} className="flex flex-col gap-2">
              <Button variant="primary" disabled>{a.label}</Button>
              <CallPreview call={a.call} title={c.call} />
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[13px] text-[var(--tone-caution-fg)]">{c.disabled}</p>
      </Card>
    </div>
  );
}
