'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { Card, ScreenHeader } from '@/components/primitives/Surface';
import { nsToDate } from '@/lib/format/time';
import { assetById, formatMainnetAmount } from '@/lib/mainnet/assets';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { useMainnetCopy, useMainnetLocale } from '@/lib/mainnet/copy';
import { nearAccountUrl } from '@/lib/mainnet/explorer';
import { fixtureById } from '@/lib/mainnet/fixtures';
import type { MainnetRequest } from '@/lib/mainnet/fixtures';
import { readerOrNull } from '@/lib/mainnet/hooks';
import { derivePaymentView } from '@/lib/mainnet/status';
import { useLocalProduct } from '@/lib/mainnet/use-product';
import { useMainnetWallet } from '@/lib/mainnet/wallet';
import { useMainnetVault } from './Wallet';
import { Notice, Row, short } from './bits';

/**
 * Mainnet payment history and contract-state receipts.
 *
 * History = request IDs this account chose to keep on this device, each read
 * live from the pinned contract at a final block (or fixtures in a fixture
 * Preview). It is not an indexer: requests never opened or tracked here are
 * not listed (parity gap: Mainnet history index, see docs/MAINNET_PARITY_MATRIX.md).
 *
 * The receipt shows the contract's own record. It is labelled "Payment
 * recorded (contract state)" and never "Verified Paid": the independent
 * receipt-graph verifier does not exist on mainnet yet.
 */
const activityEn = {
  track: 'Save to activity',
  tracked: 'Saved to activity',
  trackHint: 'Connect a wallet to keep this request in your activity on this device.',
  title: 'Activity',
  lead: 'Requests you created, paid or saved on this device, read live from the Taply contract. Not a full on-chain history.',
  empty: 'No requests in your activity yet. Open a request and choose "Save to activity".',
  loading: 'Reading…',
  unreadable: 'Could not read this request.',
  missing: 'Not found on the contract.',
  receipt: 'Receipt',
  open: 'Open',
  receiptTitle: 'Receipt',
  recorded: 'Payment recorded (contract state)',
  recordedHelp: 'This is the Taply contract\'s own record at a final block. Independent verification of the transfer is not available on mainnet yet.',
  notFinal: 'No final payment recorded for this request.',
  amount: 'Amount',
  merchant: 'Paid to',
  payer: 'Paid by',
  router: 'NEAR Intents (cross-chain)',
  fundedAt: 'Funded',
  payoutAt: 'Payout recorded',
  operation: 'Payout operation',
  contract: 'Contract',
  requestId: 'Request ID',
  termsHash: 'Terms hash',
  status: 'Contract status',
  readAt: 'Read at a final block',
  explorer: 'Contract on nearblocks',
  fixture: 'FIXTURE receipt — not on chain.',
  filterLabel: 'Show',
  filters: { all: 'All', received: 'Received', paid: 'Paid by me', open: 'Open' },
  filterAccounts: 'Matched against',
  noMatch: 'No saved requests match this filter.',
  noAccount: 'Connect a wallet or unlock your Taply Wallet to filter by account.',
};
type ActivityCopy = typeof activityEn;
const activityTr: ActivityCopy = {
  track: 'Etkinliğe kaydet',
  tracked: 'Etkinliğe kaydedildi',
  trackHint: 'Bu talebi bu cihazdaki etkinliğinizde tutmak için bir cüzdan bağlayın.',
  title: 'Etkinlik',
  lead: 'Bu cihazda oluşturduğunuz, ödediğiniz veya kaydettiğiniz talepler; Taply sözleşmesinden canlı okunur. Tam zincir geçmişi değildir.',
  empty: 'Etkinlikte henüz talep yok. Bir talebi açıp "Etkinliğe kaydet"i seçin.',
  loading: 'Okunuyor…',
  unreadable: 'Bu talep okunamadı.',
  missing: 'Sözleşmede bulunamadı.',
  receipt: 'Makbuz',
  open: 'Aç',
  receiptTitle: 'Makbuz',
  recorded: 'Ödeme kaydedildi (sözleşme durumu)',
  recordedHelp: 'Bu, Taply sözleşmesinin kesinleşmiş bloktaki kendi kaydıdır. Transferin bağımsız doğrulaması mainnet\'te henüz yok.',
  notFinal: 'Bu talep için kesinleşmiş bir ödeme kaydı yok.',
  amount: 'Tutar',
  merchant: 'Ödenen',
  payer: 'Ödeyen',
  router: 'NEAR Intents (zincirler arası)',
  fundedAt: 'Fonlandı',
  payoutAt: 'Ödeme kaydedildi',
  operation: 'Ödeme işlemi',
  contract: 'Sözleşme',
  requestId: 'Talep kimliği',
  termsHash: 'Koşul özeti',
  status: 'Sözleşme durumu',
  readAt: 'Kesinleşmiş blokta okundu',
  explorer: 'Sözleşme nearblocks\'ta',
  fixture: 'FİKSTÜR makbuzu — zincirde değil.',
  filterLabel: 'Göster',
  filters: { all: 'Tümü', received: 'Alınan', paid: 'Benim ödediklerim', open: 'Açık' },
  filterAccounts: 'Eşleştirilen hesaplar',
  noMatch: 'Bu filtreye uyan kayıtlı talep yok.',
  noAccount: 'Hesaba göre filtrelemek için bir cüzdan bağlayın veya Taply Cüzdan\'ınızı açın.',
};
export const ACTIVITY_COPY = { en: activityEn, tr: activityTr };
export function useActivityCopy(): ActivityCopy {
  return useMainnetLocale().locale === 'tr' ? activityTr : activityEn;
}

type Read = { kind: 'loading' } | { kind: 'error' } | { kind: 'missing' } | { kind: 'ok'; request: MainnetRequest; fixture: boolean; readAtMs: number };

/** One final-block read (or fixture), refreshed on demand. */
export function useRequestOnce(id: string): Read {
  const [read, setRead] = useState<{ id: string; value: Read } | null>(null);
  useEffect(() => {
    let live = true;
    void readOne(id).then((value) => { if (live) setRead({ id, value }); });
    return () => {
      live = false;
    };
  }, [id]);
  return read?.id === id ? read.value : { kind: 'loading' };
}

async function readOne(id: string): Promise<Read> {
  if (MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures) {
    const entry = fixtureById(id, Date.now());
    return entry === null ? { kind: 'missing' } : { kind: 'ok', request: entry.request, fixture: true, readAtMs: Date.now() };
  }
  const reader = readerOrNull();
  if (reader === null) return { kind: 'error' };
  try {
    const r = await reader.readRequest(id);
    return r.data === null ? { kind: 'missing' } : { kind: 'ok', request: r.data, fixture: false, readAtMs: Date.now() };
  } catch {
    return { kind: 'error' };
  }
}

/** Reads every saved request so the list can be filtered by account relation. */
function useRequestsOnce(ids: readonly string[]): ReadonlyMap<string, Read> {
  const key = ids.join(',');
  const [reads, setReads] = useState<{ key: string; map: ReadonlyMap<string, Read> }>({ key: '', map: new Map() });
  useEffect(() => {
    let live = true;
    const list = key === '' ? [] : key.split(',');
    void Promise.all(list.map(async (id) => [id, await readOne(id)] as const)).then((entries) => {
      if (live) setReads({ key, map: new Map(entries) });
    });
    return () => { live = false; };
  }, [key]);
  return reads.key === key ? reads.map : new Map();
}

export type ActivityFilter = 'all' | 'received' | 'paid' | 'open';

/** Pure: does a contract record match the filter for these accounts? Unread rows only show under "all". */
export function matchesActivityFilter(read: Read | undefined, filter: ActivityFilter, accounts: ReadonlySet<string>): boolean {
  if (filter === 'all') return true;
  if (read === undefined || read.kind !== 'ok') return false;
  const r = read.request;
  if (filter === 'received') return accounts.has(r.recipientAccountId);
  if (filter === 'paid') return r.payerAccountId !== null && accounts.has(r.payerAccountId);
  return r.status === 'OPEN';
}

export function TrackRequestButton({ requestId }: { readonly requestId: string }) {
  const c = useActivityCopy();
  const local = useLocalProduct();
  const tracked = local.data.requests.includes(requestId);
  if (!local.ready) return <p className="text-[12px] text-[var(--text-muted)]">{c.trackHint}</p>;
  return (
    <Button
      variant="secondary"
      data-testid="track-request"
      disabled={tracked || local.data.requests.length >= 100}
      onClick={() => local.save({ ...local.data, requests: [...local.data.requests, requestId] })}
    >
      {tracked ? c.tracked : c.track}
    </Button>
  );
}

function ActivityRow({ id, read, onRemove, removeLabel }: { id: string; read: Read; onRemove: () => void; removeLabel: string }) {
  const c = useActivityCopy();
  const m = useMainnetCopy();
  const { locale } = useMainnetLocale();
  return (
    <li>
      <Card>
        <div data-testid="activity-row" className="flex flex-col gap-1">
          {read.kind === 'ok' ? (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[17px] font-semibold tabular-nums">{formatMainnetAmount(read.request.terms.amountBaseUnits, assetById(read.request.terms.assetId)!, locale)}</p>
                <p data-testid="activity-state" className="text-[13px] font-semibold">
                  {m.status.states[derivePaymentView({ contract: { status: read.request.status, readAtMs: read.readAtMs, inFlightSinceMs: read.request.status === 'PAYOUT_IN_FLIGHT' && read.request.latestOperation ? nsToDate(read.request.latestOperation.startedAtNs).getTime() : null }, oneClick: null, nowMs: read.readAtMs }).state]}
                </p>
              </div>
              <p className="break-all text-[13px] text-[var(--text-secondary)]">{read.request.recipientAccountId}{read.request.terms.memo ? ` · ${read.request.terms.memo}` : ''}</p>
            </>
          ) : (
            <p className="text-[13px] text-[var(--text-secondary)]">{read.kind === 'loading' ? c.loading : read.kind === 'missing' ? c.missing : c.unreadable}</p>
          )}
          <p className="font-mono text-[11px] text-[var(--text-muted)]">{short(id, 12, 12)}</p>
          <div className="flex flex-wrap gap-3 text-[14px]">
            <Link className="tap-target inline-flex items-center underline" href={`/m/pay/${id}` as Route}>{c.open}</Link>
            <Link className="tap-target inline-flex items-center underline" href={`/m/receipt/${id}` as Route}>{c.receipt}</Link>
            <Button variant="ghost" onClick={onRemove}>{removeLabel}</Button>
          </div>
        </div>
      </Card>
    </li>
  );
}

export function ActivityList({ removeLabel }: { readonly removeLabel: string }) {
  const c = useActivityCopy();
  const local = useLocalProduct();
  const { accountId } = useMainnetWallet();
  const { identity } = useMainnetVault();
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const accounts = useMemo(() => new Set([accountId, identity?.accountId].filter((a): a is string => typeof a === 'string' && a !== '')), [accountId, identity?.accountId]);
  const ids = useMemo(() => [...local.data.requests].reverse(), [local.data.requests]);
  const reads = useRequestsOnce(ids);
  const shown = ids.filter((id) => matchesActivityFilter(reads.get(id), filter, accounts));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] text-[var(--text-secondary)]">{c.lead}</p>
      {local.ready && local.data.requests.length === 0 && <Notice tone="muted">{c.empty}</Notice>}
      {ids.length > 0 && (
        <fieldset className="flex flex-wrap gap-2" data-testid="activity-filter">
          <legend className="mb-1 text-[13px] text-[var(--text-secondary)]">{c.filterLabel}</legend>
          {(['all', 'received', 'paid', 'open'] as const).map((f) => (
            <label key={f} className="flex min-h-[var(--tap-target)] cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-subtle)] px-3 text-[14px] has-[:checked]:border-[var(--accent)]">
              <input type="radio" name="activity-filter" value={f} checked={filter === f} onChange={() => setFilter(f)} />
              {c.filters[f]}
            </label>
          ))}
        </fieldset>
      )}
      {(filter === 'received' || filter === 'paid') && (
        accounts.size === 0
          ? <Notice tone="muted" testId="activity-no-account">{c.noAccount}</Notice>
          : <p className="break-all text-[12px] text-[var(--text-muted)]" data-testid="activity-accounts">{c.filterAccounts}: {[...accounts].join(', ')}</p>
      )}
      {ids.length > 0 && shown.length === 0 && filter !== 'all' && <Notice tone="muted" testId="activity-no-match">{c.noMatch}</Notice>}
      <ul className="flex flex-col gap-2" data-testid="activity-list">
        {shown.map((id) => (
          <ActivityRow key={id} id={id} read={reads.get(id) ?? { kind: 'loading' }} removeLabel={removeLabel} onRemove={() => local.save({ ...local.data, requests: local.data.requests.filter((r) => r !== id) })} />
        ))}
      </ul>
    </div>
  );
}

export function ContractReceipt({ id }: { readonly id: string }) {
  const c = useActivityCopy();
  const { locale } = useMainnetLocale();
  const read = useRequestOnce(id);
  const time = (ns: string) => new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }).format(nsToDate(ns)) + ' UTC';
  if (read.kind !== 'ok') {
    return <><ScreenHeader title={c.receiptTitle} /><Notice tone={read.kind === 'loading' ? 'neutral' : 'danger'} live>{read.kind === 'loading' ? c.loading : read.kind === 'missing' ? c.missing : c.unreadable}</Notice></>;
  }
  const r = read.request;
  const asset = assetById(r.terms.assetId)!;
  const op = r.latestOperation;
  const paid = r.status === 'FINAL_PAID' && op !== null && op.status === 'SUCCEEDED';
  const contractUrl = nearAccountUrl(r.terms.contractId);
  return (
    <div className="flex flex-col gap-4" data-testid="contract-receipt">
      <ScreenHeader title={c.receiptTitle} />
      {read.fixture && <Notice tone="muted">{c.fixture}</Notice>}
      <Card>
        <p data-testid="receipt-state" data-paid={paid ? 'recorded' : 'no'} className="text-[17px] font-semibold">{paid ? c.recorded : c.notFinal}</p>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">{c.recordedHelp}</p>
        <p data-testid="receipt-amount" className="mt-3 text-[2rem] font-semibold tabular-nums">{formatMainnetAmount(r.terms.amountBaseUnits, asset, locale)}</p>
        <dl className="mt-2">
          <Row label={c.merchant} mono>{r.recipientAccountId}</Row>
          {r.payerAccountId !== null && <Row label={c.payer} mono>{r.payerAccountId === 'intents.near' ? `${c.router} · intents.near` : r.payerAccountId}</Row>}
          {r.fundedAtNs !== null && <Row label={c.fundedAt}>{time(r.fundedAtNs)}</Row>}
          {op?.resolvedAtNs && <Row label={c.payoutAt}>{time(op.resolvedAtNs)}</Row>}
          {op !== null && <Row label={c.operation} mono>#{op.nonce} · {op.kind} · {op.status}</Row>}
          <Row label={c.status} mono>{r.status}</Row>
          <Row label={c.contract} mono>{r.terms.contractId}</Row>
          <Row label={c.requestId} mono>{r.terms.id}</Row>
          <Row label={c.termsHash} mono>{r.termsHash}</Row>
          <Row label={c.readAt}>{new Date(read.readAtMs).toISOString()}</Row>
        </dl>
        <div className="mt-3 flex flex-wrap gap-4 text-[14px]">
          {contractUrl !== null && <a className="underline" href={contractUrl} target="_blank" rel="noreferrer noopener">{c.explorer}</a>}
          <Link className="underline" href={`/m/pay/${id}` as Route}>{c.open}</Link>
        </div>
      </Card>
    </div>
  );
}
