'use client';

import { useEffect, useState } from 'react';
import {
  createMainnetGiftReader,
  createMainnetNativeWalletBackend,
  openMainnetAttemptStore,
  prepareMainnetGiftSettlement,
  signMainnetGiftClaim,
  verifyMainnetDirectTransfer,
} from '@taply/near-client';
import type { MainnetDirectReceipt, MainnetNativeReview } from '@taply/near-client';
import { MainnetAccountSchema } from '@taply/shared';
import { Envelope } from '@/components/gift/Envelope';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Surface';
import { formatMainnetAmount, MAINNET_ASSETS } from '@/lib/mainnet/assets';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { GIFT_PROFILE } from '@/lib/mainnet/gift-profile';
import { decodePersonalGift } from '@/lib/mainnet/personal-gift';
import type { PersonalGiftPayload } from '@/lib/mainnet/personal-gift';
import { MAINNET_INDEPENDENT_VERIFIER_AVAILABLE } from '@/lib/mainnet/release-gates';
import { useMainnetWallet } from '@/lib/mainnet/wallet';
import { CallPreview, Notice, Row } from './bits';
import { readProfile, useMainnetVault, vault } from './Wallet';

/**
 * Gift pages on NEAR Mainnet (Codex interfaces, docs/MAINNET_PROTOCOL_PHASE2.md):
 *  - Personal Gift = a plain NEAR transfer (reviewed native backend) plus a
 *    secret-free `#p=` payload the recipient checks with verifyMainnetDirectTransfer.
 *  - Open Gift = gift-mainnet contract via createMainnetGiftReader and the typed
 *    builders. Unwrapping (reading the letter) and claiming (a transaction) are
 *    separate actions. The one-use link key from `#k=` signs the claim under the
 *    Mainnet domain; it never leaves the browser and is removed from the address bar.
 * Every transaction stays unsigned while the release gates are closed.
 */
const en = {
  personalTitle: 'Personal Gift', personalLead: 'Send NEAR to someone with a sealed envelope and a note. They can check the transfer on Mainnet themselves.',
  to: 'Recipient (NEAR account)', amount: 'Amount (NEAR)', message: 'Note (optional, up to 280 bytes)', design: 'Envelope',
  review: 'Review gift', reviewTitle: 'Review — exact NEAR transfer', send: 'Send gift', gate: 'Sending real funds is disabled until the owner-approved release review. Nothing was signed.',
  needWallet: 'Create or restore a Taply Wallet first.', invalid: 'Check the recipient, amount and note.',
  shareAfter: 'After the transfer is final, the share link carries only the transfer details (no secret) so the recipient can verify it.',
  openTitle: 'You received a gift', unwrap: 'Unwrap', rewrap: 'Close envelope', from: 'From', check: 'Check the transfer on Mainnet',
  checking: 'Checking a final block…', badLink: 'This gift link is not valid.',
  verified: 'Transfer found at a final block and matching exactly (checked through the configured RPC, not a light client).',
  preRelease: 'Independent verification is pre-release on Mainnet; this is not a public "Verified Paid" label.',
  notVerified: { MISMATCH: 'The transfer on Mainnet does not match this gift.', NOT_FOUND: 'This transfer was not found on Mainnet.', UNAVAILABLE: 'Mainnet could not be read. Nothing is assumed.' } as Record<string, string>,
  openGift: 'Open Gift', notConfigured: 'No Mainnet Gift contract is configured on this deployment. Open Gifts cannot be read or claimed yet.',
  loading: 'Reading the Gift contract at a final block…', missing: 'This gift does not exist on the Gift contract.', unreadable: 'The Gift contract could not be read. Nothing is assumed.',
  state: { AVAILABLE: 'Available to claim', EXPIRED: 'Expired', CLAIMED: 'Claimed', REFUNDED: 'Refunded to the sender' } as Record<string, string>,
  payout: { PENDING: 'Payout result not recorded (R-2). No automatic retry — do not claim again.', CONFIRMED: 'Payout recorded by the Gift contract.', FAILED: 'Payout failed; the funds are held. The recipient may retry.' } as Record<string, string>,
  expires: 'Claimable until', claimant: 'Claim to (your NEAR account)', claim: 'Claim gift', claimSign: 'Sign claim with the gift link',
  claimSigned: 'Claim signed with the one-use gift key (bound to this contract, gift and account).', noKey: 'This link has no claim key. Only the person who received the full link can claim.',
  refund: 'Take back (sender, after expiry)', retry: 'Retry payout (recipient)', receipt: 'Receipt',
  recorded: 'Recorded by the Gift contract (contract state). Independent receipt verification is pre-release.', call: 'Transaction the wallet would sign',
  submitOff: 'Gift transactions are disabled until the Gift contract, fee and limits are approved and released. Nothing was signed.',
};
type C = typeof en;
const tr: C = {
  personalTitle: 'Kişisel Hediye', personalLead: 'Birine mühürlü bir zarf ve notla NEAR gönderin. Transferi Mainnet\'te kendisi kontrol edebilir.',
  to: 'Alıcı (NEAR hesabı)', amount: 'Tutar (NEAR)', message: 'Not (isteğe bağlı, en fazla 280 bayt)', design: 'Zarf',
  review: 'Hediyeyi incele', reviewTitle: 'İnceleme — tam NEAR transferi', send: 'Hediyeyi gönder', gate: 'Sahibin onaylayacağı sürüm incelemesine kadar gerçek para göndermek kapalı. Hiçbir şey imzalanmadı.',
  needWallet: 'Önce bir Taply Cüzdan oluşturun veya geri yükleyin.', invalid: 'Alıcıyı, tutarı ve notu kontrol edin.',
  shareAfter: 'Transfer kesinleştikten sonra paylaşım bağlantısı yalnızca transfer bilgilerini taşır (gizli bilgi yok); alıcı doğrulayabilir.',
  openTitle: 'Bir hediye aldınız', unwrap: 'Aç', rewrap: 'Zarfı kapat', from: 'Gönderen', check: 'Transferi Mainnet\'te kontrol et',
  checking: 'Kesinleşmiş blok kontrol ediliyor…', badLink: 'Bu hediye bağlantısı geçerli değil.',
  verified: 'Transfer kesinleşmiş blokta bulundu ve tam eşleşiyor (yapılandırılmış RPC ile; hafif istemci değil).',
  preRelease: 'Mainnet\'te bağımsız doğrulama yayın öncesidir; bu herkese açık bir "Doğrulandı" etiketi değildir.',
  notVerified: { MISMATCH: 'Mainnet\'teki transfer bu hediyeyle eşleşmiyor.', NOT_FOUND: 'Bu transfer Mainnet\'te bulunamadı.', UNAVAILABLE: 'Mainnet okunamadı. Hiçbir şey varsayılmıyor.' },
  openGift: 'Açık Hediye', notConfigured: 'Bu dağıtımda yapılandırılmış bir Mainnet Hediye sözleşmesi yok. Açık Hediyeler henüz okunamaz veya talep edilemez.',
  loading: 'Hediye sözleşmesi kesinleşmiş blokta okunuyor…', missing: 'Bu hediye Hediye sözleşmesinde yok.', unreadable: 'Hediye sözleşmesi okunamadı. Hiçbir şey varsayılmıyor.',
  state: { AVAILABLE: 'Talep edilebilir', EXPIRED: 'Süresi doldu', CLAIMED: 'Talep edildi', REFUNDED: 'Gönderene iade edildi' },
  payout: { PENDING: 'Ödeme sonucu kaydedilmedi (R-2). Otomatik tekrar yok — tekrar talep etmeyin.', CONFIRMED: 'Ödeme Hediye sözleşmesi tarafından kaydedildi.', FAILED: 'Ödeme başarısız; para tutuluyor. Alıcı tekrar deneyebilir.' },
  expires: 'Son talep zamanı', claimant: 'Talep edilecek hesap (NEAR hesabınız)', claim: 'Hediyeyi talep et', claimSign: 'Talebi hediye bağlantısıyla imzala',
  claimSigned: 'Talep tek kullanımlık hediye anahtarıyla imzalandı (bu sözleşme, hediye ve hesaba bağlı).', noKey: 'Bu bağlantıda talep anahtarı yok. Yalnızca tam bağlantıyı alan kişi talep edebilir.',
  refund: 'Geri al (gönderen, süre dolunca)', retry: 'Ödemeyi tekrar dene (alıcı)', receipt: 'Makbuz',
  recorded: 'Hediye sözleşmesi tarafından kaydedildi (sözleşme durumu). Bağımsız makbuz doğrulaması yayın öncesidir.', call: 'Cüzdanın imzalayacağı işlem',
  submitOff: 'Hediye sözleşmesi, ücret ve limitler onaylanıp yayınlanana kadar hediye işlemleri kapalı. Hiçbir şey imzalanmadı.',
};
export const GIFT_PAGES_COPY = { en, tr };
const useC = (): C => (useMainnetLocale().locale === 'tr' ? tr : en);
const field = 'min-h-[var(--tap-target)] w-full rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] px-3';

/** Personal Gift composer: exact NEAR transfer review from the reviewed backend. */
export function PersonalGiftCompose() {
  const c = useC();
  const { locale } = useMainnetLocale();
  const { identity } = useMainnetVault();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [design, setDesign] = useState(0);
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<MainnetNativeReview | null>(null);
  const [error, setError] = useState('');
  async function prepare() {
    setError(''); setReview(null);
    const profile = readProfile();
    if (identity === null || profile === null) { setError(c.needWallet); return; }
    if (!MainnetAccountSchema.safeParse(to.trim()).success || new TextEncoder().encode(message).length > 280) { setError(c.invalid); return; }
    let store: Awaited<ReturnType<typeof openMainnetAttemptStore>> | null = null;
    try {
      store = await openMainnetAttemptStore();
      setReview(await createMainnetNativeWalletBackend({ profile, store, signer: { kind: 'internal', vault: vault() } }).prepare(to.trim(), amount.trim()));
    } catch { setError(c.invalid); } finally { store?.close(); }
  }
  return (
    <Card>
      <form className="flex flex-col gap-2" data-testid="personal-gift" onSubmit={(e) => { e.preventDefault(); void prepare(); }}>
        <h2 className="font-semibold">{c.personalTitle}</h2>
        <p className="text-[13px] text-[var(--text-secondary)]">{c.personalLead}</p>
        <label className="text-[13px]" htmlFor="pg-to">{c.to}</label><input id="pg-to" className={field} autoCapitalize="none" value={to} onChange={(e) => setTo(e.target.value)} />
        <label className="text-[13px]" htmlFor="pg-amount">{c.amount}</label><input id="pg-amount" inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <label className="text-[13px]" htmlFor="pg-msg">{c.message}</label><textarea id="pg-msg" maxLength={280} className={`${field} py-2`} value={message} onChange={(e) => setMessage(e.target.value)} />
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={c.design}>
          {['Forest', 'Lime', 'Linen', 'Midnight'].map((n, i) => <button key={n} type="button" aria-pressed={design === i} onClick={() => setDesign(i)} className={`pressable rounded-full border px-3 py-1.5 text-[13px] ${design === i ? 'border-[var(--taply-lime)]' : 'border-[var(--border-subtle)]'}`}>{n}</button>)}
        </div>
        <Envelope design={design} open={open} label={c.personalTitle}><div className="p-6 text-center text-[#0B120E]"><p className="whitespace-pre-wrap break-words">{message}</p></div></Envelope>
        <Button type="button" variant="secondary" onClick={() => setOpen(!open)}>{open ? c.rewrap : c.unwrap}</Button>
        <Button type="submit" data-testid="pg-review">{c.review}</Button>
        {error && <Notice tone="danger" live testId="pg-error">{error}</Notice>}
      </form>
      {review && (
        <div className="mt-3 flex flex-col gap-2" data-testid="pg-review-card">
          <h3 className="font-semibold">{c.reviewTitle}</h3>
          <dl><Row label={c.to} mono>{review.receiverId}</Row><Row label={c.amount}>{formatMainnetAmount(review.depositYocto, MAINNET_ASSETS.NEAR, locale)}</Row><Row label={c.from} mono>{review.signerAccountId}</Row><Row label="Nonce" mono>{review.nonce}</Row></dl>
          <p className="text-[12px] text-[var(--text-muted)]">{c.shareAfter}</p>
          <Button variant="primary" size="lg" disabled>{c.send}</Button>
          <p className="text-[13px] text-[var(--tone-caution-fg)]">{c.gate}</p>
        </div>
      )}
    </Card>
  );
}

/** Recipient view of `#p=`: separate unwrap and independent transfer check. */
export function PersonalGiftOpen() {
  const c = useC();
  const { locale } = useMainnetLocale();
  const [payload, setPayload] = useState<PersonalGiftPayload | null | 'invalid'>(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<MainnetDirectReceipt | 'checking' | null>(null);
  useEffect(() => { queueMicrotask(() => setPayload(decodePersonalGift(window.location.hash) ?? 'invalid')); }, []);
  if (payload === null) return null;
  if (payload === 'invalid') return <Notice tone="danger" testId="pg-bad">{c.badLink}</Notice>;
  async function check(p: PersonalGiftPayload) {
    const profile = readProfile();
    if (profile === null) return;
    setResult('checking');
    try { setResult(await verifyMainnetDirectTransfer(profile, { txHash: p.txHash, from: p.from, to: p.to, amountYocto: p.amountYocto })); }
    catch { setResult({ kind: 'NOT_VERIFIED', reason: 'UNAVAILABLE' }); }
  }
  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid="pg-open">
        <h2 className="font-semibold">{c.openTitle}</h2>
        <Envelope design={payload.design} open={open} label={c.openTitle}><div className="p-6 text-center text-[#0B120E]"><p className="whitespace-pre-wrap break-words">{payload.message}</p></div></Envelope>
        <Button variant="secondary" data-testid="pg-unwrap" onClick={() => setOpen(!open)}>{open ? c.rewrap : c.unwrap}</Button>
        <dl><Row label={c.from} mono>{payload.from}</Row><Row label={c.amount}>{formatMainnetAmount(payload.amountYocto, MAINNET_ASSETS.NEAR, locale)}</Row></dl>
        <Button data-testid="pg-check" onClick={() => void check(payload)} disabled={result === 'checking'}>{result === 'checking' ? c.checking : c.check}</Button>
        {result !== null && result !== 'checking' && (
          <Notice tone={result.kind === 'VERIFIED' ? 'success' : 'caution'} live testId="pg-result">
            <span data-kind={result.kind}>{result.kind === 'VERIFIED' ? c.verified : c.notVerified[result.reason]}</span>
            {result.kind === 'VERIFIED' && !MAINNET_INDEPENDENT_VERIFIER_AVAILABLE && <span className="mt-1 block text-[12px]">{c.preRelease}</span>}
          </Notice>
        )}
      </div>
    </Card>
  );
}

type GiftRead = { kind: 'loading' } | { kind: 'error' } | { kind: 'missing' } | { kind: 'ok'; data: NonNullable<Awaited<ReturnType<ReturnType<typeof createMainnetGiftReader>['readGift']>>['data']>; config: Awaited<ReturnType<ReturnType<typeof createMainnetGiftReader>['readGift']>>['config']; nowNs: string };

function useGift(id: string): GiftRead {
  const [read, setRead] = useState<GiftRead>({ kind: 'loading' });
  useEffect(() => {
    if (GIFT_PROFILE === null) return;
    let live = true;
    createMainnetGiftReader(GIFT_PROFILE).readGift(id)
      .then((r) => live && setRead(r.data === null ? { kind: 'missing' } : { kind: 'ok', data: r.data, config: r.config, nowNs: r.timestampNs }))
      .catch(() => live && setRead({ kind: 'error' }));
    return () => { live = false; };
  }, [id]);
  return read;
}

/** Open Gift claim / expiry / refund / retry page: `/m/gift/<32 hex>#k=<64 hex link seed>`. */
export function OpenGiftPage({ id }: { readonly id: string }) {
  const c = useC();
  const { locale } = useMainnetLocale();
  const { identity } = useMainnetVault();
  const external = useMainnetWallet();
  const read = useGift(id);
  const [seed, setSeed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [claimant, setClaimant] = useState('');
  const [claim, setClaim] = useState<ReturnType<typeof prepareMainnetGiftSettlement> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const m = /^#k=([0-9a-f]{64})$/.exec(window.location.hash);
    const key = `taply.mainnet.gift.key:${id}`;
    if (m) { sessionStorage.setItem(key, m[1]!); history.replaceState(null, '', window.location.pathname); }
    queueMicrotask(() => setSeed(sessionStorage.getItem(key)));
  }, [id]);
  const me = identity?.accountId ?? external.accountId ?? null;
  useEffect(() => { if (me) queueMicrotask(() => setClaimant((v) => v || me)); }, [me]);
  if (GIFT_PROFILE === null) return <Notice tone="caution" testId="gift-not-configured">{c.notConfigured}</Notice>;
  if (read.kind === 'loading') return <Notice live>{c.loading}</Notice>;
  if (read.kind !== 'ok') return <Notice tone="danger" testId="gift-read-error">{read.kind === 'missing' ? c.missing : c.unreadable}</Notice>;
  const g = read.data;
  const settle = (action: 'refund' | 'retry', signer: string | null) => { if (!signer) return null; try { return prepareMainnetGiftSettlement({ config: read.config, gift: g, signerAccountId: signer, observedAtNs: read.nowNs, action }); } catch { return null; } };
  const refund = settle('refund', me);
  const retry = settle('retry', me);
  const claimable = (g.status === 'AVAILABLE') && BigInt(read.nowNs) < BigInt(g.expiresAtNs);
  async function signClaim() {
    setError(''); setClaim(null);
    try {
      if (seed === null) throw new Error('NO_KEY');
      if (!MainnetAccountSchema.safeParse(claimant.trim()).success) throw new Error('BAD');
      const bytes = Uint8Array.from(seed.match(/../g)!.map((h) => Number.parseInt(h, 16)));
      const sig = await signMainnetGiftClaim(crypto, bytes, read.kind === 'ok' ? read.config.contractId : '', g.id, claimant.trim());
      bytes.fill(0);
      setClaim(prepareMainnetGiftSettlement({ config: read.kind === 'ok' ? read.config : (null as never), gift: g, signerAccountId: claimant.trim(), observedAtNs: read.kind === 'ok' ? read.nowNs : '0', action: 'claim', signatureHex: sig }));
    } catch (e) { setError(e instanceof Error && e.message === 'NO_KEY' ? c.noKey : c.unreadable); }
  }
  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid="open-gift">
        <h2 className="font-semibold">{c.openGift}</h2>
        <Envelope design={g.design} open={open} label={c.openGift}><div className="p-6 text-center text-[#0B120E]"><p className="whitespace-pre-wrap break-words">{g.message}</p></div></Envelope>
        <Button variant="secondary" data-testid="og-unwrap" onClick={() => setOpen(!open)}>{open ? c.rewrap : c.unwrap}</Button>
        <p data-testid="og-state" data-status={g.status} className="text-[16px] font-semibold">{c.state[g.status]}</p>
        {g.payout && <p data-testid="og-payout" data-payout={g.payout} className="text-[13px]">{c.payout[g.payout]}</p>}
        <dl>
          <Row label={c.amount}>{formatMainnetAmount(g.amountYocto, MAINNET_ASSETS.NEAR, locale)}</Row>
          <Row label={c.from} mono>{g.creator}</Row>
          <Row label={c.expires}>{new Date(Number.parseInt((BigInt(g.expiresAtNs) / 1_000_000n).toString(), 10)).toISOString()}</Row>
        </dl>
        {claimable && (
          <div className="flex flex-col gap-2" data-testid="og-claim">
            {seed === null ? <Notice tone="muted" testId="og-no-key">{c.noKey}</Notice> : (
              <>
                <label className="text-[13px]" htmlFor="og-claimant">{c.claimant}</label>
                <input id="og-claimant" className={`${field} font-mono text-[13px]`} autoCapitalize="none" value={claimant} onChange={(e) => setClaimant(e.target.value)} />
                <Button data-testid="og-sign" onClick={() => void signClaim()}>{c.claimSign}</Button>
              </>
            )}
          </div>
        )}
        {claim && <div data-testid="og-claim-ready" className="flex flex-col gap-2"><Notice tone="muted">{c.claimSigned}</Notice><CallPreview call={claim} title={c.call} /><Button disabled>{c.claim}</Button></div>}
        {refund && <div data-testid="og-refund" className="flex flex-col gap-2"><Button disabled>{c.refund}</Button><CallPreview call={refund} title={c.call} /></div>}
        {retry && <div data-testid="og-retry" className="flex flex-col gap-2"><Button disabled>{c.retry}</Button><CallPreview call={retry} title={c.call} /></div>}
        {(g.status === 'CLAIMED' || g.status === 'REFUNDED') && <a className="underline" href={`/m/gift/${g.id}/receipt`}>{c.receipt}</a>}
        {error && <Notice tone="danger" live>{error}</Notice>}
        <p className="text-[13px] text-[var(--tone-caution-fg)]">{c.submitOff}</p>
      </div>
    </Card>
  );
}

export function OpenGiftReceipt({ id }: { readonly id: string }) {
  const c = useC();
  const { locale } = useMainnetLocale();
  const read = useGift(id);
  if (GIFT_PROFILE === null) return <Notice tone="caution" testId="gift-not-configured">{c.notConfigured}</Notice>;
  if (read.kind === 'loading') return <Notice live>{c.loading}</Notice>;
  if (read.kind !== 'ok') return <Notice tone="danger" testId="gift-read-error">{read.kind === 'missing' ? c.missing : c.unreadable}</Notice>;
  const g = read.data;
  return (
    <Card>
      <div className="flex flex-col gap-2" data-testid="og-receipt">
        <h2 className="font-semibold">{c.receipt}</h2>
        <p data-testid="og-receipt-state" data-status={g.status} data-payout={g.payout ?? ''} className="font-semibold">{c.state[g.status]}{g.payout ? ` · ${c.payout[g.payout]}` : ''}</p>
        <dl>
          <Row label={c.amount}>{formatMainnetAmount(g.amountYocto, MAINNET_ASSETS.NEAR, locale)}</Row>
          <Row label={c.from} mono>{g.creator}</Row>
          {g.beneficiary && <Row label={c.to} mono>{g.beneficiary}</Row>}
          <Row label="Gift ID" mono>{g.id}</Row>
          <Row label="Contract" mono>{read.config.contractId} · {read.config.version}</Row>
        </dl>
        <p className="text-[12px] text-[var(--text-muted)]">{c.recorded}</p>
      </div>
    </Card>
  );
}
