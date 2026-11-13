'use client';

import { useEffect, useState } from 'react';
import {
  createMainnetEscrowReader,
  mainnetEscrowConfigProblems,
  prepareMainnetCreateProtectedRequest,
  prepareMainnetFundProtectedNative,
  prepareMainnetProtectedTokenFunding,
} from '@taply/near-client';
import type { MainnetEscrowConfig } from '@taply/near-client';
import { calculateMainnetEscrowRequestId, MainnetAccountSchema, MainnetEscrowTermsSchema, MAINNET_USDC_ASSET } from '@taply/shared';
import type { MainnetEscrowRequest, MainnetEscrowTerms } from '@taply/shared';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Surface';
import { nsToDate } from '@/lib/format/time';
import { assetById, formatMainnetAmount, MAINNET_ASSETS, parseMainnetAmount } from '@/lib/mainnet/assets';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { CANCEL_MINUTES, ESCROW_PROFILE, FUNDING_MINUTES, minutesToNs, randomCreationNonce } from '@/lib/mainnet/escrow-profile';
import { useMainnetWallet } from '@/lib/mainnet/wallet';
import { availableActions, PROTECTED_COPY } from './Protected';
import { useMainnetVault } from './Wallet';
import { CallPreview, Notice, Row } from './bits';

/**
 * Protected Pay on a configured Mainnet escrow: request creation from the
 * contract's own quote (`quote_create_request`), the payer's consent and
 * funding call, and the live request page. Every transaction comes from
 * Codex's reviewed builders and is shown, never signed: escrow release is a
 * separate owner approval. Browser tests answer through synthetic RPC.
 */
const en = {
  createTitle: 'New protected request',
  createLead: 'You receive the payment. The payer can cancel and be refunded until the cancellation window ends; you are paid only after it ends and the funds are released.',
  notConfigured: 'No Mainnet escrow contract is configured. Protected requests cannot be created on this build.',
  noAccount: 'Unlock your Taply Wallet or connect a NEAR wallet to create a protected request.',
  creator: 'Paid to (you)',
  asset: 'Asset', amount: 'Amount', cancelMinutes: 'Cancellation window (minutes, 1–60)', fundingMinutes: 'Payer must fund within (minutes, 5–1440)',
  payer: 'Only this payer (optional NEAR account)', memo: 'Note (optional)',
  quote: 'Get escrow quote', working: 'Reading the escrow…',
  reviewTitle: 'Review — exact create_request', window: 'Cancellation window', minutes: 'min', fundBy: 'Payer must fund by',
  anyone: 'Anyone', requestId: 'Request ID', termsHash: 'Terms hash', storage: 'Storage deposit (paid by you)', gas: 'Gas',
  contract: 'Escrow contract', review: 'Contract review', unreviewed: 'UNREVIEWED candidate — not for real funds',
  consent: 'I agree that the payer can cancel and be refunded in full until the window ends, and that I am paid only after it ends and the funds are released.',
  create: 'Create protected request',
  disabled: 'Escrow transactions are disabled until the separate escrow release approval. Nothing was signed or created.',
  link: 'Payer link (works after the request exists on chain)',
  call: 'Transaction the wallet would sign',
  errors: {
    BAD_AMOUNT: 'Enter a valid amount within the Mainnet pilot limit.', BAD_CANCEL: 'Cancellation window must be 1–60 whole minutes.',
    BAD_FUNDING: 'Funding window must be 5–1440 whole minutes.', BAD_PAYER: 'Enter a valid NEAR account for the payer, or leave it empty.',
    SELF_PAYER: 'The payer cannot be you.', USDC_OFF: 'This escrow does not accept USDC.', MEMO: 'The note is too long.',
    BUILDER: 'The reviewed builder refused these terms or this quote. Nothing was prepared.',
    READ: 'Could not read the escrow contract (code hash, config or network check failed). Nothing was prepared.',
  },
  pageTitle: 'Protected request', notFound: 'This request does not exist on the configured escrow.',
  loading: 'Reading the escrow at a final block…', readAt: 'Read at final block',
  fundTitle: 'Fund this protected payment', payAs: 'Paying from',
  payerConsent: (m: string) => `I understand I can cancel and get a full refund only within ${m} minutes of funding. After that, the funds can be released to the merchant.`,
  fund: 'Fund protected payment', notPermitted: 'Only the named payer can fund this request.',
  expired: 'The funding deadline has passed. This request can no longer be funded.',
  countdown: 'Cancellation window ends in', windowOver: 'Cancellation window has ended.',
};
type Copy = typeof en;
const tr: Copy = {
  createTitle: 'Yeni korumalı talep',
  createLead: 'Ödemeyi siz alırsınız. Ödeyen, iptal süresi bitene kadar iptal edip iade alabilir; süre bittikten ve para serbest bırakıldıktan sonra ödenirsiniz.',
  notConfigured: 'Yapılandırılmış bir Mainnet emanet sözleşmesi yok. Bu sürümde korumalı talep oluşturulamaz.',
  noAccount: 'Korumalı talep oluşturmak için Taply Cüzdan\'ınızı açın veya bir NEAR cüzdanı bağlayın.',
  creator: 'Alıcı (siz)',
  asset: 'Varlık', amount: 'Tutar', cancelMinutes: 'İptal süresi (dakika, 1–60)', fundingMinutes: 'Ödeyen şu süre içinde fonlamalı (dakika, 5–1440)',
  payer: 'Yalnızca bu ödeyen (isteğe bağlı NEAR hesabı)', memo: 'Not (isteğe bağlı)',
  quote: 'Emanet teklifini al', working: 'Emanet okunuyor…',
  reviewTitle: 'İnceleme — tam create_request', window: 'İptal süresi', minutes: 'dk', fundBy: 'Ödeyenin son fonlama zamanı',
  anyone: 'Herkes', requestId: 'Talep kimliği', termsHash: 'Koşul özeti', storage: 'Depolama depozitosu (sizin ödediğiniz)', gas: 'Gas',
  contract: 'Emanet sözleşmesi', review: 'Sözleşme incelemesi', unreviewed: 'İNCELENMEMİŞ aday — gerçek para için değil',
  consent: 'Süre bitene kadar ödeyenin iptal edip tam iade alabileceğini ve ancak süre bitip para serbest bırakıldıktan sonra ödeneceğimi kabul ediyorum.',
  create: 'Korumalı talep oluştur',
  disabled: 'Ayrı emanet sürüm onayına kadar emanet işlemleri kapalı. Hiçbir şey imzalanmadı veya oluşturulmadı.',
  link: 'Ödeyen bağlantısı (talep zincirde oluştuktan sonra çalışır)',
  call: 'Cüzdanın imzalayacağı işlem',
  errors: {
    BAD_AMOUNT: 'Mainnet pilot sınırı içinde geçerli bir tutar girin.', BAD_CANCEL: 'İptal süresi 1–60 tam dakika olmalı.',
    BAD_FUNDING: 'Fonlama süresi 5–1440 tam dakika olmalı.', BAD_PAYER: 'Ödeyen için geçerli bir NEAR hesabı girin veya boş bırakın.',
    SELF_PAYER: 'Ödeyen siz olamazsınız.', USDC_OFF: 'Bu emanet USDC kabul etmiyor.', MEMO: 'Not çok uzun.',
    BUILDER: 'İncelenmiş oluşturucu bu koşulları veya teklifi reddetti. Hiçbir şey hazırlanmadı.',
    READ: 'Emanet sözleşmesi okunamadı (kod özeti, yapılandırma veya ağ kontrolü başarısız). Hiçbir şey hazırlanmadı.',
  },
  pageTitle: 'Korumalı talep', notFound: 'Bu talep yapılandırılmış emanette yok.',
  loading: 'Emanet kesinleşmiş blokta okunuyor…', readAt: 'Okunan kesinleşmiş blok',
  fundTitle: 'Bu korumalı ödemeyi fonla', payAs: 'Ödeyen hesap',
  payerConsent: (m: string) => `Fonlamadan sonra yalnızca ${m} dakika içinde iptal edip tam iade alabileceğimi anlıyorum. Sonrasında para işletmeye serbest bırakılabilir.`,
  fund: 'Korumalı ödemeyi fonla', notPermitted: 'Bu talebi yalnızca belirtilen ödeyen fonlayabilir.',
  expired: 'Fonlama süresi doldu. Bu talep artık fonlanamaz.',
  countdown: 'İptal süresinin bitmesine', windowOver: 'İptal süresi bitti.',
};
const COPY = { en, tr };

const input = 'min-h-[var(--tap-target)] w-full rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] px-3 text-[15px]';
const minutesOf = (ns: string) => (BigInt(ns) / 60_000_000_000n).toString();
const utc = (ns: string) => nsToDate(ns).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

/** The account this device acts as: the unlocked Taply Wallet first, else a connected external wallet. */
function useActingAccount(): string | null {
  const { identity } = useMainnetVault();
  const { accountId } = useMainnetWallet();
  return identity?.accountId ?? accountId ?? null;
}

type Prepared = { config: MainnetEscrowConfig; terms: MainnetEscrowTerms; quote: { depositYocto: string; gas: string; termsHash: string; storageBytes: string }; call: ReturnType<typeof prepareMainnetCreateProtectedRequest> };

export function ProtectedCreate() {
  const { locale } = useMainnetLocale();
  const c = COPY[locale];
  const creator = useActingAccount();
  const [asset, setAsset] = useState<'NEAR' | 'USDC'>('NEAR');
  const [amount, setAmount] = useState('');
  const [cancel, setCancel] = useState('10');
  const [funding, setFunding] = useState('60');
  const [payer, setPayer] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [consent, setConsent] = useState(false);
  if (ESCROW_PROFILE === null) return <Notice tone="caution" testId="pc-not-configured">{c.notConfigured}</Notice>;
  if (creator === null) return <Notice tone="muted" testId="pc-no-account">{c.noAccount}</Notice>;
  const profile = ESCROW_PROFILE;
  const me = creator;

  async function quote() {
    setError(''); setPrepared(null); setConsent(false);
    const a = asset === 'USDC' ? MAINNET_ASSETS.USDC : MAINNET_ASSETS.NEAR;
    const amt = parseMainnetAmount(amount, a);
    if (!amt.ok) { setError(c.errors.BAD_AMOUNT); return; }
    const cancelNs = minutesToNs(cancel, CANCEL_MINUTES);
    if (cancelNs === null) { setError(c.errors.BAD_CANCEL); return; }
    const fundingNs = minutesToNs(funding, FUNDING_MINUTES);
    if (fundingNs === null) { setError(c.errors.BAD_FUNDING); return; }
    const p = payer.trim();
    if (p !== '' && !MainnetAccountSchema.safeParse(p).success) { setError(c.errors.BAD_PAYER); return; }
    if (p === me) { setError(c.errors.SELF_PAYER); return; }
    if (new TextEncoder().encode(memo).length > 256) { setError(c.errors.MEMO); return; }
    setBusy(true);
    try {
      const reader = createMainnetEscrowReader(profile);
      let cfg;
      try { cfg = await reader.readConfig(); } catch { setError(c.errors.READ); return; }
      const config = cfg.data;
      if (asset === 'USDC' && !(config.capabilities.nep141 && config.tokens.some((t) => t.assetId === MAINNET_USDC_ASSET))) { setError(c.errors.USDC_OFF); return; }
      const creationNonce = randomCreationNonce();
      const id = calculateMainnetEscrowRequestId({ network: 'near-mainnet', contractId: config.contractId, creatorAccountId: me, creationNonce });
      const parsed = MainnetEscrowTermsSchema.safeParse({
        schemaVersion: 'taply.intent.v1', id, network: 'near-mainnet', contractId: config.contractId, creatorAccountId: me, creationNonce,
        assetId: a.id, amountBaseUnits: amt.baseUnits, mode: 'protected', cancelDurationNs: cancelNs,
        fundingExpiresAtNs: (BigInt(cfg.timestampNs) + BigInt(fundingNs)).toString(),
        permittedPayerAccountId: p === '' ? null : p, merchantAccountId: null, sessionBinding: null, memo,
      });
      if (!parsed.success) { setError(c.errors.BUILDER); return; }
      let q;
      try { q = await reader.quoteCreateRequest(parsed.data); } catch { setError(c.errors.READ); return; }
      try {
        const call = prepareMainnetCreateProtectedRequest({ contractId: config.contractId, config, terms: parsed.data, quote: q.data, signerAccountId: me });
        setPrepared({ config, terms: parsed.data, quote: q.data, call });
      } catch { setError(c.errors.BUILDER); }
    } finally { setBusy(false); }
  }

  const a = prepared === null ? null : assetById(prepared.terms.assetId);
  return (
    <div className="flex flex-col gap-3" data-testid="protected-create">
      <Card>
        <h2 className="font-semibold">{c.createTitle}</h2>
        <p className="mt-1 text-[14px] text-[var(--text-secondary)]">{c.createLead}</p>
        <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void quote(); }} onChange={() => { setPrepared(null); setConsent(false); }}>
          <p className="text-[13px] text-[var(--text-secondary)]">{c.creator}: <span className="font-mono" data-testid="pc-creator">{me}</span></p>
          <fieldset className="flex gap-2">
            <legend className="mb-1 text-[13px] text-[var(--text-secondary)]">{c.asset}</legend>
            {(['NEAR', 'USDC'] as const).map((x) => (
              <label key={x} className="flex min-h-[var(--tap-target)] cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-subtle)] px-3 has-[:checked]:border-[var(--accent)]">
                <input type="radio" name="pc-asset" value={x} checked={asset === x} onChange={() => setAsset(x)} />{x}
              </label>
            ))}
          </fieldset>
          <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="pc-amount">{c.amount} ({asset})</label>
          <input id="pc-amount" inputMode="decimal" className={input} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="pc-cancel">{c.cancelMinutes}</label>
          <input id="pc-cancel" inputMode="numeric" className={input} value={cancel} onChange={(e) => setCancel(e.target.value)} />
          <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="pc-funding">{c.fundingMinutes}</label>
          <input id="pc-funding" inputMode="numeric" className={input} value={funding} onChange={(e) => setFunding(e.target.value)} />
          <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="pc-payer">{c.payer}</label>
          <input id="pc-payer" className={input} autoCapitalize="none" spellCheck={false} value={payer} onChange={(e) => setPayer(e.target.value)} />
          <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="pc-memo">{c.memo}</label>
          <input id="pc-memo" className={input} value={memo} onChange={(e) => setMemo(e.target.value)} />
          <Button type="submit" data-testid="pc-quote" disabled={busy}>{busy ? c.working : c.quote}</Button>
          {error && <Notice tone="danger" live testId="pc-error">{error}</Notice>}
        </form>
      </Card>
      {prepared !== null && a !== null && (
        <Card>
          <div data-testid="pc-review" className="flex flex-col gap-2">
            <h2 className="font-semibold">{c.reviewTitle}</h2>
            <dl>
              <Row label={c.amount}><span data-testid="pc-review-amount">{formatMainnetAmount(prepared.terms.amountBaseUnits, a, locale)}</span></Row>
              <Row label={c.creator} mono>{prepared.terms.creatorAccountId}</Row>
              <Row label={c.window}><span data-testid="pc-review-window">{minutesOf(prepared.terms.cancelDurationNs!)} {c.minutes}</span></Row>
              <Row label={c.fundBy}>{utc(prepared.terms.fundingExpiresAtNs)}</Row>
              <Row label={c.payer} mono>{prepared.terms.permittedPayerAccountId ?? c.anyone}</Row>
              <Row label={c.requestId} mono><span data-testid="pc-review-id">{prepared.terms.id}</span></Row>
              <Row label={c.termsHash} mono>{prepared.quote.termsHash}</Row>
              <Row label={c.storage}><span data-testid="pc-review-deposit">{formatMainnetAmount(prepared.call.depositYocto, MAINNET_ASSETS.NEAR, locale)}</span></Row>
              <Row label={c.gas}>{(BigInt(prepared.call.gas) / 1_000_000_000_000n).toString()} Tgas</Row>
              <Row label={c.contract} mono>{prepared.config.contractId} · {prepared.config.contractVersion}</Row>
              <Row label={c.review}>{mainnetEscrowConfigProblems(prepared.config, prepared.config.contractId).includes('UNREVIEWED_CANDIDATE') ? <span data-testid="pc-unreviewed" className="text-[var(--tone-caution-fg)]">{c.unreviewed}</span> : '—'}</Row>
            </dl>
            <label className="flex items-start gap-2 text-[14px]">
              <input type="checkbox" data-testid="pc-consent" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{c.consent}</span>
            </label>
            {consent && (
              <div data-testid="pc-ready" className="flex flex-col gap-2">
                <CallPreview call={prepared.call} title={c.call} />
                <p className="text-[13px] text-[var(--text-secondary)]">{c.link}: <span className="break-all font-mono">/m/protected/{prepared.terms.id}</span></p>
              </div>
            )}
            <Button variant="primary" size="lg" disabled data-testid="pc-create">{c.create}</Button>
            <p className="text-[13px] text-[var(--tone-caution-fg)]">{c.disabled}</p>
          </div>
        </Card>
      )}
    </div>
  );
}

type Live = { kind: 'loading' } | { kind: 'error' } | { kind: 'missing' } | { kind: 'ok'; request: MainnetEscrowRequest; config: MainnetEscrowConfig; blockHash: string; timestampNs: string };

function useEscrowRequest(id: string): Live {
  const [state, setState] = useState<{ id: string; value: Live } | null>(null);
  useEffect(() => {
    if (ESCROW_PROFILE === null) return;
    let live = true;
    createMainnetEscrowReader(ESCROW_PROFILE).readRequest(id)
      .then((r) => { if (live) setState({ id, value: r.data === null ? { kind: 'missing' } : { kind: 'ok', request: r.data, config: r.config, blockHash: r.blockHash, timestampNs: r.timestampNs } }); })
      .catch(() => { if (live) setState({ id, value: { kind: 'error' } }); });
    return () => { live = false; };
  }, [id]);
  return state?.id === id ? state.value : { kind: 'loading' };
}

/** Funding call for the payer, only from the reviewed builders and only with the window the payer was shown. */
export function fundingCall(config: MainnetEscrowConfig, r: MainnetEscrowRequest, signer: string, observedAtNs: string, shownCancelNs: string) {
  try {
    return r.terms.assetId === 'near:native'
      ? prepareMainnetFundProtectedNative({ contractId: config.contractId, config, request: r, signerAccountId: signer, observedAtNs, acceptedCancelDurationNs: shownCancelNs })
      : prepareMainnetProtectedTokenFunding({ config, request: r, signerAccountId: signer, observedAtNs, acceptedCancelDurationNs: shownCancelNs });
  } catch { return null; }
}

export function ProtectedRequestPage({ id }: { readonly id: string }) {
  const { locale } = useMainnetLocale();
  const c = COPY[locale];
  const p = PROTECTED_COPY[locale];
  const me = useActingAccount();
  const read = useEscrowRequest(id);
  const [consent, setConsent] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (ESCROW_PROFILE === null) return <Notice tone="caution" testId="pc-not-configured">{c.notConfigured}</Notice>;
  if (read.kind === 'loading') return <Notice tone="neutral" live>{c.loading}</Notice>;
  if (read.kind === 'error') return <Notice tone="danger" live testId="pr-error">{c.errors.READ}</Notice>;
  if (read.kind === 'missing') return <Notice tone="danger" live testId="pr-missing">{c.notFound}</Notice>;
  const { request: r, config } = read;
  const a = assetById(r.terms.assetId)!;
  const cancelNs = r.terms.cancelDurationNs!;
  const expired = BigInt(read.timestampNs) >= BigInt(r.terms.fundingExpiresAtNs);
  const permitted = r.terms.permittedPayerAccountId === null || r.terms.permittedPayerAccountId === me;
  const fund = r.status === 'OPEN' && me !== null && consent ? fundingCall(config, r, me, read.timestampNs, cancelNs) : null;
  const actions = r.status === 'OPEN' ? [] : availableActions(p, config, config.contractId, r, read.timestampNs);
  const cutoffMs = r.cancelUntilNs === null ? null : nsToDate(r.cancelUntilNs).getTime();
  const inFlight = r.status.endsWith('_IN_FLIGHT');
  return (
    <div className="flex flex-col gap-3" data-testid="protected-request">
      <Card>
        <p data-testid="pr-state" data-status={r.status} className="text-[17px] font-semibold">{p.state[r.status] ?? r.status}</p>
        {r.status === 'LOCKED' && <p className="mt-1 text-[13px] text-[var(--tone-caution-fg)]">{p.lockedNote}</p>}
        {inFlight && <p data-testid="pr-r2" role="alert" className="mt-1 text-[13px] font-semibold text-[var(--tone-caution-fg)]">{p.inFlightNote}</p>}
        {r.status === 'LOCKED' && cutoffMs !== null && (
          <p data-testid="pr-countdown" className="mt-1 text-[13px]">{cutoffMs > now ? `${c.countdown} ${Math.ceil((cutoffMs - now) / 60000)} ${c.minutes}` : c.windowOver}</p>
        )}
        <dl className="mt-2">
          <Row label={p.amount}><span data-testid="pr-amount">{formatMainnetAmount(r.terms.amountBaseUnits, a, locale)}</span></Row>
          <Row label={p.merchant} mono>{r.recipientAccountId}</Row>
          <Row label={c.window}><span data-testid="pr-window">{minutesOf(cancelNs)} {c.minutes}</span></Row>
          {r.status === 'OPEN' && <Row label={c.fundBy}>{utc(r.terms.fundingExpiresAtNs)}</Row>}
          {r.payerAccountId && <Row label={p.payer} mono>{r.payerAccountId}</Row>}
          {r.cancelUntilNs && <Row label={p.cutoff}>{utc(r.cancelUntilNs)}</Row>}
          <Row label={p.status} mono>{r.status}</Row>
          <Row label={c.contract} mono>{config.contractId} · {config.contractVersion}</Row>
          <Row label={c.readAt} mono>{read.blockHash}</Row>
        </dl>
        <p className="mt-2 text-[12px] text-[var(--text-muted)]"><span className="font-semibold">{p.rights}: </span>{p.rightsText}</p>
      </Card>
      {r.status === 'OPEN' && (
        <Card>
          <div className="flex flex-col gap-2" data-testid="pr-fund">
            <h2 className="font-semibold">{c.fundTitle}</h2>
            {me === null ? <Notice tone="muted">{c.noAccount}</Notice>
              : expired ? <Notice tone="danger" testId="pr-expired">{c.expired}</Notice>
              : !permitted ? <Notice tone="danger" testId="pr-not-permitted">{c.notPermitted}</Notice>
              : (
                <>
                  <p className="text-[13px] text-[var(--text-secondary)]">{c.payAs}: <span className="font-mono">{me}</span></p>
                  <label className="flex items-start gap-2 text-[14px]">
                    <input type="checkbox" data-testid="pr-consent" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                    <span>{c.payerConsent(minutesOf(cancelNs))}</span>
                  </label>
                  {fund !== null && <div data-testid="pr-fund-ready" data-method={fund.methodName}><CallPreview call={fund} title={c.call} /></div>}
                  <Button variant="primary" size="lg" disabled data-testid="pr-fund-button">{c.fund}</Button>
                </>
              )}
            <p className="text-[13px] text-[var(--tone-caution-fg)]">{c.disabled}</p>
          </div>
        </Card>
      )}
      {r.status !== 'OPEN' && (
        <Card>
          <ul className="flex flex-col gap-3" data-testid="pr-actions">
            {actions.length === 0 && <li className="text-[13px] text-[var(--text-secondary)]" data-testid="pr-no-action">{p.noAction}</li>}
            {actions.map((x) => (
              <li key={x.label} data-method={x.call.methodName} className="flex flex-col gap-2">
                <Button variant="primary" disabled>{x.label}</Button>
                <CallPreview call={x.call} title={c.call} />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-[var(--tone-caution-fg)]">{c.disabled}</p>
        </Card>
      )}
    </div>
  );
}
