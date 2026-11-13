'use client';

import { useState } from 'react';
import { MainnetGiftConfigSchema, prepareMainnetCreateGift, prepareMainnetGiftSettlement, signMainnetGiftClaim, GiftViewSchema } from '@taply/near-client';
import type { MainnetGiftConfig } from '@taply/near-client';
import { MainnetAccountSchema } from '@taply/shared';
import { Envelope } from '@/components/gift/Envelope';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Surface';
import { formatMainnetAmount, MAINNET_ASSETS, parseMainnetAmount } from '@/lib/mainnet/assets';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { CallPreview, Notice, Row } from './bits';

/**
 * Gift on Mainnet, bound to Codex's gift-mainnet candidate (0.2.0-mainnet)
 * through its typed builders and the Mainnet claim-signature domain
 * `taply-gift-claim:near-mainnet:v1`. Funding/claim/refund transactions stay
 * unsigned: no Gift account, fee or limits are owner-approved, so a REAL
 * profile is never built here. In a fixture Preview the clearly labelled
 * FIXTURE config below is used; it is test data, not a production default.
 */
export const FIXTURE_GIFT_CONFIG: MainnetGiftConfig = MainnetGiftConfigSchema.parse({
  contract: 'taply-gift-mainnet', version: '0.2.0-mainnet', network: 'near-mainnet', contractId: 'gift.fixture.near',
  testFaultBuild: false, unknownCallbackPolicy: 'PENDING_NO_RETRY_NO_ADMIN_OVERRIDE', reviewStatus: 'UNREVIEWED_NOT_FOR_REAL_FUNDS',
  asset: 'near:native', giftFeeYocto: '10000000000000000000000', minAmountYocto: '100000000000000000000000', maxAmountYocto: '1000000000000000000000000',
  minLifetimeS: '600', maxLifetimeS: '2592000', maxMessageBytes: 280, maxDesign: 7, claimDomain: 'taply-gift-claim:near-mainnet:v1',
});
const CREATOR = 'taply-fixture-creator.near';
const NOW_NS = 1_793_520_000_000_000_000n;
const HOUR_NS = 3_600_000_000_000n;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** One-use link key: Ed25519 key pair; the 32-byte seed goes only into the link fragment. */
export async function newLinkKey(): Promise<{ seed: Uint8Array; publicKeyHex: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { seed: pkcs8.slice(pkcs8.length - 32), publicKeyHex: hex(raw) };
}

const giftEn = {
  title: 'Gift', fixture: 'FIXTURE Gift contract config (test values, not approved). No Gift contract exists on Mainnet.',
  createTitle: 'Open Gift', amount: 'Amount (NEAR)', message: 'Message (optional, up to 280 bytes)', design: 'Envelope',
  lifetime: 'Claimable for', prepare: 'Prepare gift', preview: 'Open envelope', close: 'Close envelope',
  fee: 'Gift fee', total: 'You pay', link: 'Claim link (contains the one-use key — share only with the recipient)',
  fund: 'Fund gift', fundOff: 'Funding real gifts is disabled until the Gift contract, fee and limits are owner-approved. Nothing was signed.',
  call: 'Transaction the wallet would sign', invalid: 'Check the amount, message and envelope.',
  statesTitle: 'Gift states (contract view)', claimant: 'Your NEAR account (claimant)', claim: 'Sign claim with the link key',
  claimSigned: 'Claim signed with the one-use link key (bound to this contract, gift and claimant).',
  refund: 'Refund to creator', retry: 'Retry payout (recipient)', noAction: 'No action is possible in this state.',
  state: { AVAILABLE: 'Available to claim', EXPIRED: 'Expired — the creator can take it back', CLAIMED: 'Claimed', REFUNDED: 'Refunded to the creator' } as Record<string, string>,
  payout: { PENDING: 'Payout result not recorded (R-2) — no automatic retry; do not claim again', CONFIRMED: 'Payout recorded by the contract', FAILED: 'Payout failed — funds held; the recipient may retry' } as Record<string, string>,
  verifyNote: 'Independent gift receipt verification exists in the protocol client but is not yet a public "Verified" claim on Mainnet.',
};
type GiftCopy = typeof giftEn;
const giftTr: GiftCopy = {
  title: 'Hediye', fixture: 'FİKSTÜR Hediye sözleşmesi ayarı (test değerleri, onaylı değil). Mainnet\'te Hediye sözleşmesi yok.',
  createTitle: 'Açık Hediye', amount: 'Tutar (NEAR)', message: 'Mesaj (isteğe bağlı, en fazla 280 bayt)', design: 'Zarf',
  lifetime: 'Talep süresi', prepare: 'Hediyeyi hazırla', preview: 'Zarfı aç', close: 'Zarfı kapat',
  fee: 'Hediye ücreti', total: 'Ödeyeceğiniz', link: 'Talep bağlantısı (tek kullanımlık anahtar içerir — yalnızca alıcıyla paylaşın)',
  fund: 'Hediyeyi fonla', fundOff: 'Hediye sözleşmesi, ücret ve limitler sahip tarafından onaylanana kadar gerçek hediye fonlama kapalı. Hiçbir şey imzalanmadı.',
  call: 'Cüzdanın imzalayacağı işlem', invalid: 'Tutarı, mesajı ve zarfı kontrol edin.',
  statesTitle: 'Hediye durumları (sözleşme görünümü)', claimant: 'NEAR hesabınız (talep eden)', claim: 'Talebi bağlantı anahtarıyla imzala',
  claimSigned: 'Talep tek kullanımlık bağlantı anahtarıyla imzalandı (bu sözleşme, hediye ve talep edene bağlı).',
  refund: 'Oluşturana iade et', retry: 'Ödemeyi tekrar dene (alıcı)', noAction: 'Bu durumda yapılabilecek bir işlem yok.',
  state: { AVAILABLE: 'Talep edilebilir', EXPIRED: 'Süresi doldu — oluşturan geri alabilir', CLAIMED: 'Talep edildi', REFUNDED: 'Oluşturana iade edildi' },
  payout: { PENDING: 'Ödeme sonucu kaydedilmedi (R-2) — otomatik tekrar yok; tekrar talep etmeyin', CONFIRMED: 'Ödeme sözleşme tarafından kaydedildi', FAILED: 'Ödeme başarısız — para tutuluyor; alıcı tekrar deneyebilir' },
  verifyNote: 'Bağımsız hediye makbuzu doğrulaması protokol istemcisinde var ancak Mainnet\'te henüz herkese açık bir "Doğrulandı" iddiası değil.',
};
export const GIFT_COPY = { en: giftEn, tr: giftTr };

export function GiftMainnet() {
  const { locale } = useMainnetLocale();
  const c = GIFT_COPY[locale];
  if (!(MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures)) return <Notice tone="caution">{c.fundOff}</Notice>;
  return (
    <div className="flex flex-col gap-4" data-testid="gift-mainnet">
      <Notice tone="muted">{c.fixture}</Notice>
      <GiftCreate c={c} />
      <GiftStates c={c} />
    </div>
  );
}

function GiftCreate({ c }: { c: GiftCopy }) {
  const { locale } = useMainnetLocale();
  const [amount, setAmount] = useState('0.5');
  const [message, setMessage] = useState('');
  const [design, setDesign] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState<{ call: ReturnType<typeof prepareMainnetCreateGift>; link: string } | null>(null);
  async function prepare() {
    setError(''); setPrepared(null);
    const p = parseMainnetAmount(amount, MAINNET_ASSETS.NEAR);
    try {
      if (!p.ok) throw new Error('INVALID_GIFT');
      const giftId = hex(crypto.getRandomValues(new Uint8Array(16)));
      const key = await newLinkKey();
      const call = prepareMainnetCreateGift({ config: FIXTURE_GIFT_CONFIG, signerAccountId: CREATOR, giftId, publicKeyHex: key.publicKeyHex, amountYocto: p.baseUnits, lifetimeS: 7 * 86400, message, design });
      setPrepared({ call, link: `${window.location.origin}/m/gift/${giftId}#k=${hex(key.seed)}` });
      key.seed.fill(0);
    } catch { setError(c.invalid); }
  }
  return (
    <Card>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void prepare(); }}>
        <h2 className="font-semibold">{c.createTitle}</h2>
        <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="g-amount">{c.amount}</label>
        <input id="g-amount" inputMode="decimal" className="min-h-[var(--tap-target)] rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] px-3" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="g-msg">{c.message}</label>
        <textarea id="g-msg" maxLength={280} className="rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] px-3 py-2" value={message} onChange={(e) => setMessage(e.target.value)} />
        <fieldset className="flex flex-wrap gap-2"><legend className="mb-1 text-[13px] text-[var(--text-secondary)]">{c.design}</legend>
          {['Forest', 'Lime', 'Linen', 'Midnight'].map((n, i) => (
            <label key={n} className={`pressable rounded-full border px-3 py-1.5 text-[13px] ${design === i ? 'border-[var(--taply-lime)]' : 'border-[var(--border-subtle)]'}`}>
              <input type="radio" name="g-design" className="sr-only" checked={design === i} onChange={() => setDesign(i)} />{n}
            </label>
          ))}
        </fieldset>
        <Envelope design={design} open={open} label={c.createTitle}><div className="p-6 text-center text-[#0B120E]"><p className="whitespace-pre-wrap break-words">{message}</p></div></Envelope>
        <Button type="button" variant="secondary" onClick={() => setOpen(!open)}>{open ? c.close : c.preview}</Button>
        <Button type="submit" data-testid="gift-prepare">{c.prepare}</Button>
        {error && <Notice tone="danger" live>{error}</Notice>}
      </form>
      {prepared && (
        <div className="mt-3 flex flex-col gap-2" data-testid="gift-prepared">
          <dl>
            <Row label={c.amount}>{formatMainnetAmount(prepared.call.args['amount'] as string, MAINNET_ASSETS.NEAR, locale)}</Row>
            <Row label={c.fee}>{formatMainnetAmount(FIXTURE_GIFT_CONFIG.giftFeeYocto, MAINNET_ASSETS.NEAR, locale)}</Row>
            <Row label={c.total}><span data-testid="gift-total">{formatMainnetAmount(prepared.call.depositYocto, MAINNET_ASSETS.NEAR, locale)}</span></Row>
          </dl>
          <p className="text-[12px] text-[var(--text-secondary)]">{c.link}</p>
          <p className="break-all font-mono text-[11px] text-[var(--text-muted)]">{prepared.link}</p>
          <CallPreview call={prepared.call} title={c.call} />
          <Button variant="primary" size="lg" disabled>{c.fund}</Button>
          <p className="text-[13px] text-[var(--tone-caution-fg)]">{c.fundOff}</p>
        </div>
      )}
    </Card>
  );
}

type View = ReturnType<typeof GiftViewSchema.parse>;
function fixtureGift(status: View['status'], payout: View['payout'], publicKeyHex: string): View {
  const settled = status === 'CLAIMED' || status === 'REFUNDED';
  return GiftViewSchema.parse({
    id: 'a1'.repeat(16), creator: CREATOR, amountYocto: '500000000000000000000000', publicKey: publicKeyHex, message: 'Happy birthday', design: 1,
    createdAtNs: (NOW_NS - HOUR_NS).toString(), createdHeight: '100', expiresAtNs: (status === 'EXPIRED' ? NOW_NS - 1n : NOW_NS + 24n * HOUR_NS).toString(), status,
    beneficiary: settled ? (status === 'REFUNDED' ? CREATOR : 'taply-fixture-friend.near') : null,
    settledAtNs: settled ? NOW_NS.toString() : null, settledHeight: settled ? '120' : null, payout: settled ? payout : null, payoutNonce: settled ? 1 : null,
  });
}
export const GIFT_STATES = ['available', 'expired', 'claimed-confirmed', 'claimed-pending', 'claimed-failed', 'refunded'] as const;

function GiftStates({ c }: { c: GiftCopy }) {
  const [pick, setPick] = useState<(typeof GIFT_STATES)[number]>('available');
  const [claimant, setClaimant] = useState('taply-fixture-friend.near');
  const [signed, setSigned] = useState<{ pick: string; call: ReturnType<typeof prepareMainnetGiftSettlement> } | null>(null);
  const [key, setKey] = useState<{ seed: Uint8Array; publicKeyHex: string } | null>(null);
  const [error, setError] = useState('');
  const status: View['status'] = pick === 'available' ? 'AVAILABLE' : pick === 'expired' ? 'EXPIRED' : pick === 'refunded' ? 'REFUNDED' : 'CLAIMED';
  const payout: View['payout'] = pick === 'claimed-pending' ? 'PENDING' : pick === 'claimed-failed' ? 'FAILED' : 'CONFIRMED';
  const gift = fixtureGift(status, payout, key?.publicKeyHex ?? '00'.repeat(32));
  const settle = (action: 'refund' | 'retry', signer: string) => { try { return prepareMainnetGiftSettlement({ config: FIXTURE_GIFT_CONFIG, gift, signerAccountId: signer, observedAtNs: NOW_NS.toString(), action }); } catch { return null; } };
  const refund = settle('refund', CREATOR);
  const retry = gift.beneficiary ? settle('retry', gift.beneficiary) : null;
  async function claim() {
    setError(''); setSigned(null);
    try {
      if (!MainnetAccountSchema.safeParse(claimant).success) throw new Error('bad');
      const k = key ?? (await newLinkKey());
      setKey(k);
      const g = fixtureGift(status, payout, k.publicKeyHex);
      const sig = await signMainnetGiftClaim(crypto, k.seed, FIXTURE_GIFT_CONFIG.contractId, g.id, claimant);
      setSigned({ pick, call: prepareMainnetGiftSettlement({ config: FIXTURE_GIFT_CONFIG, gift: g, signerAccountId: claimant, observedAtNs: NOW_NS.toString(), action: 'claim', signatureHex: sig }) });
    } catch { setError(c.noAction); }
  }
  const claimable = status === 'AVAILABLE';
  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid="gift-states">
        <h2 className="font-semibold">{c.statesTitle}</h2>
        <div className="flex flex-wrap gap-2">
          {GIFT_STATES.map((s) => <button key={s} type="button" data-testid={`gift-${s}`} aria-pressed={s === pick} onClick={() => { setPick(s); setSigned(null); }} className={`pressable rounded-full border px-3 py-1.5 font-mono text-[12px] ${s === pick ? 'border-[var(--taply-lime)] bg-[var(--tone-success-bg)]' : 'border-[var(--border-subtle)]'}`}>{s}</button>)}
        </div>
        <Envelope design={gift.design} open={status === 'CLAIMED'} label={c.title}><div className="p-6 text-center text-[#0B120E]"><p>{gift.message}</p></div></Envelope>
        <p data-testid="gift-state" data-status={status} className="text-[16px] font-semibold">{c.state[status]}</p>
        {gift.payout && <p data-testid="gift-payout" data-payout={gift.payout} role={gift.payout === 'PENDING' ? 'alert' : undefined} className="text-[13px]">{c.payout[gift.payout]}</p>}
        {claimable && (
          <div className="flex flex-col gap-2">
            <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="g-claimant">{c.claimant}</label>
            <input id="g-claimant" className="min-h-[var(--tap-target)] rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] px-3 font-mono text-[13px]" value={claimant} onChange={(e) => setClaimant(e.target.value)} />
            <Button data-testid="gift-claim" onClick={() => void claim()}>{c.claim}</Button>
          </div>
        )}
        {signed && signed.pick === pick && <div data-testid="gift-claim-signed" className="flex flex-col gap-2"><Notice tone="muted">{c.claimSigned}</Notice><CallPreview call={signed.call} title={c.call} /></div>}
        {refund && <div data-testid="gift-refund" className="flex flex-col gap-2"><Button disabled>{c.refund}</Button><CallPreview call={refund} title={c.call} /></div>}
        {retry && <div data-testid="gift-retry" className="flex flex-col gap-2"><Button disabled>{c.retry}</Button><CallPreview call={retry} title={c.call} /></div>}
        {!claimable && !refund && !retry && <p data-testid="gift-no-action" className="text-[13px] text-[var(--text-secondary)]">{c.noAction}</p>}
        {error && <Notice tone="danger" live>{error}</Notice>}
        <p className="text-[13px] text-[var(--tone-caution-fg)]">{c.fundOff}</p>
        <p className="text-[12px] text-[var(--text-muted)]">{c.verifyNote}</p>
      </div>
    </Card>
  );
}
