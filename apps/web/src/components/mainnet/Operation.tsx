'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MainnetAuthorityCommand, MainnetOperation, MainnetWalletReview } from '@taply/near-client';
import { MAINNET_USDC } from '@taply/shared';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Surface';
import { formatMainnetAmount, MAINNET_ASSETS } from '@/lib/mainnet/assets';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { MAINNET_SIGNING_RELEASE_APPROVED } from '@/lib/mainnet/release-gates';
import { useMainnetWallet } from '@/lib/mainnet/wallet';
import {
  currentAuthority, deviceId, prepareOperation, signingProfiles, walletBackend,
} from '@/lib/mainnet/wallet-ops';
import type { AuthorityState, PreparedOperation, WalletSigner } from '@/lib/mainnet/wallet-ops';
import { authoritySignerFor } from '@/lib/mainnet/wallet-ops';
import { AuthorityError, createHttpMainnetAuthority } from '@/lib/mainnet/authority-client';
import { useMainnetVault, vault } from './Wallet';
import { Notice, Row } from './bits';
import { DirectTransferCheck } from './Settlement';

/**
 * Shared UI for Codex's unified wallet protocol: one exact review card for
 * every financial operation and one unknown-outcome panel. Confirm is always
 * disabled: MAINNET_SIGNING_RELEASE_APPROVED / MAINNET_PROTOCOL_SIGNING_RELEASED
 * are false and no reviewed authenticated authority exists.
 */
const en = {
  from: 'From', key: 'Signing key', receiver: 'Receiver', action: 'Action', transfer: 'Transfer', call: 'Contract call',
  method: 'Method', args: 'Arguments', deposit: 'Attached deposit', gas: 'Gas', nonce: 'Nonce',
  nonceExternal: (floor: string) => `Chosen by your wallet; must be above ${floor}`,
  block: 'Reference block', reserved: 'Reserved (storage + gas)', opId: 'Operation ID', network: 'Network',
  expires: 'This review expires in', expired: 'This review expired. Review again.',
  authority: 'Payment authority',
  authorityUnavailable: 'Not available on this build. Taply cannot check this account\'s pending payments on other devices, so nothing can be reserved or sent.',
  authoritySimulated: 'SIMULATED — test harness in this browser only, not account-wide. Never for real funds.',
  authorityHttp: 'Checked by the authenticated payment authority (isolated test configuration — not a production authority).',
  authorityHttpGated: 'The payment authority answered, but your wallet cannot authorize it yet: wallet signing stays disabled until the release review. Nothing can be reserved or sent.',
  authorityHttpUnavailable: 'The payment authority is not reachable or refused this device. Nothing can be reserved or sent.',
  confirmCommand: (what: string): string => `Authorize this Taply payment-safety step with your wallet?\n\n${what}\n\nThis does not send money by itself.`,
  confirm: 'Confirm and send',
  gate: 'Sending real funds is disabled until the owner-approved release review and a reviewed payment authority. Nothing was signed.',
  pickSigner: 'Pay from', taplyWallet: 'Taply Wallet', external: 'Connected wallet',
  noSigner: 'Create or unlock your Taply Wallet, or connect a NEAR wallet that reports its public key.',
  externalNoKey: 'Your connected wallet does not report its account public key, so Taply cannot verify what it would sign. Use your Taply Wallet.',
  ledgerTitle: 'Payment safety',
  ledgerUnavailable: 'Outcome checks across devices need the payment authority, which is not available on this build. Sending stays disabled.',
  ledgerSimulated: 'SIMULATED authority (this browser only).',
  ledgerHttpGated: 'Reading this account\'s payment record needs a wallet authorization, which stays disabled until the release review. Sending stays disabled.',
  ledgerHttpUnavailable: 'The payment authority is not reachable from this build or refused this device. Sending stays disabled.',
  ledgerHttpOk: 'Payment record read from the authenticated authority (isolated test configuration).',
  pendingTitle: 'A payment from this account has an unknown outcome',
  pendingLead: 'New payments are blocked until its FINAL outcome is read from the chain. Do not pay again.',
  pendingState: 'Recorded state', states: { RESERVED: 'Reserved before signing', HANDOFF: 'Handed to the signer', UNCERTAIN: 'Outcome unknown' },
  txHash: 'Transaction hash', noHash: 'None recorded — the transaction may or may not have been broadcast.',
  hint: 'Transaction hash from your wallet (optional, used only as a lookup hint)',
  check: 'Check FINAL outcome', checking: 'Reading the chain…',
  unresolved: 'Still unknown. No FINAL transaction matching this exact payment was found. Do not pay again.',
  executed: (ok: boolean): string => ok ? 'Executed at a FINAL block (success).' : 'Executed at a FINAL block, but it failed on chain.',
  settlementNote: 'This proves the transaction executed, not that the payment settled. This exact operation can never be sent again.',
  ownerOther: 'This account\'s payments are owned by another device. This device can check outcomes but cannot send.',
  ownerThis: 'Payments for this account are owned by this device.',
  history: 'Executed on this account (permanent record)', none: 'No payment attempts recorded for this account.',
  errors: {
    OUTCOME_UNRESOLVED: 'A previous payment has an unknown outcome. Check it below. Do not pay again.',
    AUTHORITY_POLICY_MISMATCH: 'The payment authority answered with a different account, key or contract policy than this app expects. Nothing was signed.',
    LEGACY_OUTCOME_UNRESOLVED: 'An older payment record on this device has an unknown outcome. It is not migrated automatically, so sending stays blocked.',
    JOURNAL_UNAVAILABLE: 'This browser\'s payment safety record is unavailable. Sending is blocked.',
    OTHER_DEVICE_READ_ONLY: 'Another device owns payments for this account. This device is read-only.',
    OPERATION_ALREADY_CONSUMED: 'This exact payment was already executed. To pay again, start a new payment.',
    ACCOUNT_NOT_ACTIVATED: 'This account is not active on Mainnet yet. Receive NEAR first.',
    WALLET_NOT_CREATED: 'Create or unlock your Taply Wallet first.',
    EXTERNAL_IDENTITY_MISMATCH: 'Your wallet no longer reports this account and key. Reconnect it.',
    TOKEN_CODE_PIN_REQUIRED: 'USDC is not enabled on this build: the USDC contract code is not pinned.',
    TOKEN_BALANCE_OR_STORAGE: 'Not enough USDC, or an account is not registered with the USDC contract.',
    INSUFFICIENT_AVAILABLE_BALANCE: 'Not enough NEAR after storage and gas reserves.',
    SELF_TRANSFER: 'You cannot send to your own account.',
    CONTRACT_NOT_CONFIGURED: 'The contract for this action is not configured or approved on this build.',
    PROFILE_REQUIRED: 'The contract for this action is not configured or approved on this build.',
    GIFT_ID_CONSUMED: 'That gift ID is already used. Start again.',
    BAD_LINK_SIGNATURE: 'The gift link key does not match this gift.',
    REQUEST_MISMATCH: 'The contract returned a different request. Nothing was prepared.',
    CONFIG_MISMATCH: 'The contract configuration does not match the pinned profile. Nothing was prepared.',
    WRONG_CONTRACT: 'The contract configuration does not match the pinned profile. Nothing was prepared.',
    EVIDENCE_MISMATCH: 'The network answer was inconsistent. Nothing was prepared.',
    NETWORK_MISMATCH: 'Wrong network.',
    ACCOUNT_NOT_FOUND: 'The recipient account does not exist on Mainnet.',
    ALREADY_REGISTERED: 'This account is already registered with USDC.',
    ARCHIVE_REQUIRED: 'This account\'s payment record is full and needs a reviewed archive. Sending is blocked.',
    INVALID_ARGUMENT: 'The reviewed builder refused this action in the current state. Nothing was prepared.',
    UNKNOWN: 'Something went wrong. Nothing was signed or sent.',
  } as Record<string, string>,
};
type Copy = typeof en;
const tr: Copy = {
  from: 'Gönderen', key: 'İmza anahtarı', receiver: 'Alıcı', action: 'İşlem', transfer: 'Transfer', call: 'Sözleşme çağrısı',
  method: 'Yöntem', args: 'Argümanlar', deposit: 'Eklenen depozito', gas: 'Gas', nonce: 'Nonce',
  nonceExternal: (floor: string) => `Cüzdanınız seçer; ${floor} değerinin üzerinde olmalı`,
  block: 'Referans blok', reserved: 'Ayrılan (depolama + gas)', opId: 'İşlem kimliği', network: 'Ağ',
  expires: 'Bu incelemenin bitmesine', expired: 'Bu inceleme sona erdi. Tekrar inceleyin.',
  authority: 'Ödeme yetkilisi',
  authorityUnavailable: 'Bu sürümde yok. Taply bu hesabın diğer cihazlardaki bekleyen ödemelerini kontrol edemez; bu yüzden hiçbir şey ayrılamaz veya gönderilemez.',
  authoritySimulated: 'SİMÜLE — yalnızca bu tarayıcıda test düzeneği, hesap genelinde değil. Asla gerçek para için değil.',
  authorityHttp: 'Kimliği doğrulanmış ödeme yetkilisi tarafından kontrol edildi (yalıtılmış test yapılandırması — üretim yetkilisi değil).',
  authorityHttpGated: 'Ödeme yetkilisi yanıt verdi, ancak cüzdanınız henüz yetkilendiremez: sürüm incelemesine kadar cüzdan imzası kapalı. Hiçbir şey ayrılamaz veya gönderilemez.',
  authorityHttpUnavailable: 'Ödeme yetkilisine ulaşılamıyor veya bu cihazı reddetti. Hiçbir şey ayrılamaz veya gönderilemez.',
  confirmCommand: (what: string): string => `Bu Taply ödeme güvenliği adımını cüzdanınızla yetkilendirmek istiyor musunuz?\n\n${what}\n\nBu tek başına para göndermez.`,
  confirm: 'Onayla ve gönder',
  gate: 'Sahibin onaylayacağı sürüm incelemesine ve incelenmiş bir ödeme yetkilisine kadar gerçek para göndermek kapalı. Hiçbir şey imzalanmadı.',
  pickSigner: 'Ödeyen', taplyWallet: 'Taply Cüzdan', external: 'Bağlı cüzdan',
  noSigner: 'Taply Cüzdan\'ınızı oluşturun veya açın ya da açık anahtarını bildiren bir NEAR cüzdanı bağlayın.',
  externalNoKey: 'Bağlı cüzdanınız hesap açık anahtarını bildirmiyor; Taply neyi imzalayacağını doğrulayamaz. Taply Cüzdan\'ı kullanın.',
  ledgerTitle: 'Ödeme güvenliği',
  ledgerUnavailable: 'Cihazlar arası sonuç kontrolü ödeme yetkilisi gerektirir; bu sürümde yok. Gönderme kapalı kalır.',
  ledgerSimulated: 'SİMÜLE yetkili (yalnızca bu tarayıcı).',
  ledgerHttpGated: 'Bu hesabın ödeme kaydını okumak cüzdan yetkilendirmesi gerektirir; sürüm incelemesine kadar kapalı. Gönderme kapalı kalır.',
  ledgerHttpUnavailable: 'Ödeme yetkilisine bu sürümden ulaşılamıyor veya bu cihazı reddetti. Gönderme kapalı kalır.',
  ledgerHttpOk: 'Ödeme kaydı kimliği doğrulanmış yetkiliden okundu (yalıtılmış test yapılandırması).',
  pendingTitle: 'Bu hesaptan bir ödemenin sonucu bilinmiyor',
  pendingLead: 'KESİN sonucu zincirden okunana kadar yeni ödemeler engellendi. Tekrar ödemeyin.',
  pendingState: 'Kaydedilen durum', states: { RESERVED: 'İmzadan önce ayrıldı', HANDOFF: 'İmzalayıcıya teslim edildi', UNCERTAIN: 'Sonuç bilinmiyor' },
  txHash: 'İşlem hash\'i', noHash: 'Kaydedilmedi — işlem ağa gönderilmiş de olabilir, gönderilmemiş de.',
  hint: 'Cüzdanınızdaki işlem hash\'i (isteğe bağlı; yalnızca arama ipucu)',
  check: 'KESİN sonucu kontrol et', checking: 'Zincir okunuyor…',
  unresolved: 'Hâlâ bilinmiyor. Bu ödemeyle birebir eşleşen KESİN bir işlem bulunamadı. Tekrar ödemeyin.',
  executed: (ok: boolean) => ok ? 'KESİN blokta yürütüldü (başarılı).' : 'KESİN blokta yürütüldü, ancak zincirde başarısız oldu.',
  settlementNote: 'Bu, işlemin yürütüldüğünü kanıtlar; ödemenin tamamlandığını değil. Bu işlem bir daha asla gönderilemez.',
  ownerOther: 'Bu hesabın ödemeleri başka bir cihaza ait. Bu cihaz sonuçları kontrol edebilir ama gönderemez.',
  ownerThis: 'Bu hesabın ödemeleri bu cihaza ait.',
  history: 'Bu hesapta yürütülenler (kalıcı kayıt)', none: 'Bu hesap için kayıtlı ödeme denemesi yok.',
  errors: {
    OUTCOME_UNRESOLVED: 'Önceki bir ödemenin sonucu bilinmiyor. Aşağıdan kontrol edin. Tekrar ödemeyin.',
    AUTHORITY_POLICY_MISMATCH: 'Ödeme yetkilisi bu uygulamanın beklediğinden farklı bir hesap, anahtar veya sözleşme politikasıyla yanıt verdi. Hiçbir şey imzalanmadı.',
    LEGACY_OUTCOME_UNRESOLVED: 'Bu cihazdaki eski bir ödeme kaydının sonucu bilinmiyor. Otomatik taşınmaz; gönderme engelli kalır.',
    JOURNAL_UNAVAILABLE: 'Bu tarayıcının ödeme güvenlik kaydı kullanılamıyor. Gönderme engellendi.',
    OTHER_DEVICE_READ_ONLY: 'Bu hesabın ödemeleri başka bir cihaza ait. Bu cihaz salt okunur.',
    OPERATION_ALREADY_CONSUMED: 'Bu ödeme zaten yürütüldü. Tekrar ödemek için yeni bir ödeme başlatın.',
    ACCOUNT_NOT_ACTIVATED: 'Bu hesap henüz Mainnet\'te etkin değil. Önce NEAR alın.',
    WALLET_NOT_CREATED: 'Önce Taply Cüzdan\'ınızı oluşturun veya açın.',
    EXTERNAL_IDENTITY_MISMATCH: 'Cüzdanınız artık bu hesabı ve anahtarı bildirmiyor. Yeniden bağlayın.',
    TOKEN_CODE_PIN_REQUIRED: 'Bu sürümde USDC açık değil: USDC sözleşme kodu sabitlenmedi.',
    TOKEN_BALANCE_OR_STORAGE: 'Yeterli USDC yok veya bir hesap USDC sözleşmesine kayıtlı değil.',
    INSUFFICIENT_AVAILABLE_BALANCE: 'Depolama ve gas ayrıldıktan sonra yeterli NEAR yok.',
    SELF_TRANSFER: 'Kendi hesabınıza gönderemezsiniz.',
    CONTRACT_NOT_CONFIGURED: 'Bu işlem için sözleşme bu sürümde yapılandırılmamış veya onaylanmamış.',
    PROFILE_REQUIRED: 'Bu işlem için sözleşme bu sürümde yapılandırılmamış veya onaylanmamış.',
    GIFT_ID_CONSUMED: 'Bu hediye kimliği zaten kullanılmış. Yeniden başlayın.',
    BAD_LINK_SIGNATURE: 'Hediye bağlantı anahtarı bu hediyeyle eşleşmiyor.',
    REQUEST_MISMATCH: 'Sözleşme farklı bir talep döndürdü. Hiçbir şey hazırlanmadı.',
    CONFIG_MISMATCH: 'Sözleşme yapılandırması sabitlenen profille eşleşmiyor. Hiçbir şey hazırlanmadı.',
    WRONG_CONTRACT: 'Sözleşme yapılandırması sabitlenen profille eşleşmiyor. Hiçbir şey hazırlanmadı.',
    EVIDENCE_MISMATCH: 'Ağ yanıtı tutarsızdı. Hiçbir şey hazırlanmadı.',
    NETWORK_MISMATCH: 'Yanlış ağ.',
    ACCOUNT_NOT_FOUND: 'Alıcı hesap Mainnet\'te yok.',
    ALREADY_REGISTERED: 'Bu hesap zaten USDC\'ye kayıtlı.',
    ARCHIVE_REQUIRED: 'Bu hesabın ödeme kaydı dolu ve incelenmiş bir arşiv gerektiriyor. Gönderme engellendi.',
    INVALID_ARGUMENT: 'İncelenmiş oluşturucu bu işlemi mevcut durumda reddetti. Hiçbir şey hazırlanmadı.',
    UNKNOWN: 'Bir şeyler ters gitti. Hiçbir şey imzalanmadı veya gönderilmedi.',
  },
};
export const OPERATION_COPY = { en, tr };
export function useOperationCopy(): Copy { return useMainnetLocale().locale === 'tr' ? tr : en; }

export function operationErrorCode(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') return (e as { code: string }).code;
  if (e instanceof Error && /^[A-Z_]+$/.test(e.message)) return e.message;
  return 'UNKNOWN';
}

/** Which contract profile an operation needs; checked before calling the planner. */
export function profileFor(op: MainnetOperation): 'instant' | 'escrow' | 'gift' | 'usdc' | null {
  if (op.kind.startsWith('instant') || op.kind === 'registerUsdc') return 'instant';
  if (op.kind.startsWith('escrow')) return 'escrow';
  if (op.kind.startsWith('gift')) return 'gift';
  return op.kind === 'usdcSend' ? 'usdc' : null;
}

export type SignerChoice = { kind: 'ok'; signer: WalletSigner; accountId: string } | { kind: 'none' } | { kind: 'external-no-key' };

/** Taply Wallet first; a connected external wallet only if it reports its account public key. */
export function useSigner(): SignerChoice {
  const { identity } = useMainnetVault();
  const external = useMainnetWallet();
  if (identity !== null) return { kind: 'ok', signer: { kind: 'internal', vault: vault() }, accountId: identity.accountId };
  if (external.accountId !== null) {
    const w = external.signerWallet?.();
    if (external.publicKey && w) return { kind: 'ok', signer: { kind: 'near-connect', wallet: w, accountId: external.accountId, publicKey: external.publicKey }, accountId: external.accountId };
    return { kind: 'external-no-key' };
  }
  return { kind: 'none' };
}

function useEnv(): { authority: AuthorityState; device: string | null } {
  const [env, setEnv] = useState<{ authority: AuthorityState; device: string | null }>({ authority: { kind: 'unavailable' }, device: null });
  useEffect(() => {
    queueMicrotask(() => {
      let device: string | null = null;
      try { device = deviceId(window.localStorage); } catch { device = null; }
      setEnv({ authority: currentAuthority(), device });
    });
  }, []);
  return env;
}

/** The wallet is asked to authorize an authority command only after the person sees exactly which step it is. */
async function confirmCommand(command: MainnetAuthorityCommand): Promise<boolean> {
  const c = document.documentElement.lang === 'tr' ? tr : en;
  const what = command.method === 'reserve' ? `Reserve payment ${command.args[0].slice(0, 12)}… (blocks other payments until its outcome is known)`
    : command.method === 'handoff' ? 'Record that the signed transaction is being handed to the network'
    : command.method === 'uncertain' ? 'Record that the outcome is not known yet'
    : command.method === 'bindCommerce' ? 'Freeze this sale\'s terms for this merchant session'
    : command.method === 'reconcile' ? 'Check the FINAL outcome on chain' : 'Read this account\'s payment record';
  return window.confirm(c.confirmCommand(what));
}

/** Prepare one operation through Codex's planner/backend. */
export function useOperation() {
  const signer = useSigner();
  const env = useEnv();
  const [state, setState] = useState<{ busy: boolean; error: string; prepared: PreparedOperation | null }>({ busy: false, error: '', prepared: null });
  const reset = useCallback(() => setState({ busy: false, error: '', prepared: null }), []);
  const run = useCallback(async (operation: MainnetOperation) => {
    setState({ busy: true, error: '', prepared: null });
    try {
      const profiles = signingProfiles();
      if (profiles === null) throw new Error('UNKNOWN');
      if (signer.kind !== 'ok') throw new Error(signer.kind === 'external-no-key' ? 'EXTERNAL_KEY_UNKNOWN' : 'WALLET_NOT_CREATED');
      const need = profileFor(operation);
      if ((need === 'instant' && !profiles.instant) || (need === 'escrow' && !profiles.escrow) || (need === 'gift' && !profiles.gift)) throw new Error('CONTRACT_NOT_CONFIGURED');
      if (need === 'usdc' && !profiles.usdcCodeHash) throw new Error('TOKEN_CODE_PIN_REQUIRED');
      if (env.device === null) throw new Error('JOURNAL_UNAVAILABLE');
      const prepared = await prepareOperation({ operation, signer: signer.signer, profiles, authority: env.authority, deviceId: env.device, confirm: confirmCommand });
      setState({ busy: false, error: '', prepared });
      return prepared;
    } catch (e) {
      setState({ busy: false, error: operationErrorCode(e), prepared: null });
      return null;
    }
  }, [signer, env]);
  return { ...state, run, reset, signer, authority: env.authority };
}

export function OperationError({ code }: { readonly code: string }) {
  const c = useOperationCopy();
  if (!code) return null;
  const text = code === 'EXTERNAL_KEY_UNKNOWN' ? c.externalNoKey : c.errors[code] ?? c.errors['UNKNOWN']!;
  return <Notice tone="danger" live testId="op-error"><span data-code={code}>{text}</span></Notice>;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return now;
}

/** The exact transaction a wallet would sign, from Codex's review. Confirm stays disabled. */
export function OperationReview({ prepared, title, children }: { readonly prepared: PreparedOperation; readonly title: string; readonly children?: React.ReactNode }) {
  const c = useOperationCopy();
  const { locale } = useMainnetLocale();
  const now = useNow();
  const r: MainnetWalletReview = prepared.review;
  const a = r.action;
  const remaining = r.expiresAtMs - now;
  let args: Record<string, unknown> | null = null;
  if (a.kind === 'call') { try { args = JSON.parse(a.argsJson) as Record<string, unknown>; } catch { args = null; } }
  const usdcAmount = a.kind === 'call' && r.receiverId === MAINNET_USDC && typeof args?.['amount'] === 'string' ? (args['amount'] as string) : null;
  return (
    <Card>
      <div data-testid="op-review" data-kind={a.kind} data-method={a.kind === 'call' ? a.methodName : 'transfer'} data-authority={prepared.authority} className="flex flex-col gap-2">
        <h2 className="font-semibold">{title}</h2>
        {children}
        <dl>
          <Row label={c.from} mono>{r.accountId}</Row>
          <Row label={c.receiver} mono><span data-testid="op-receiver">{r.receiverId}</span></Row>
          {a.kind === 'transfer' ? (
            <Row label={c.transfer}><span data-testid="op-amount">{formatMainnetAmount(a.depositYocto, MAINNET_ASSETS.NEAR, locale)}</span></Row>
          ) : (
            <>
              <Row label={c.method} mono><span data-testid="op-method">{a.methodName}</span></Row>
              {usdcAmount !== null && <Row label="USDC"><span data-testid="op-amount">{formatMainnetAmount(usdcAmount, MAINNET_ASSETS.USDC, locale)}</span></Row>}
              <Row label={c.deposit}><span data-testid="op-deposit">{a.depositYocto === '1' ? '1 yoctoNEAR' : formatMainnetAmount(a.depositYocto, MAINNET_ASSETS.NEAR, locale)}</span></Row>
              <Row label={c.gas}>{(BigInt(a.gas) / 1_000_000_000_000n).toString()} Tgas</Row>
            </>
          )}
          <Row label={c.key} mono>{r.publicKey}</Row>
          <Row label={c.nonce} mono><span data-testid="op-nonce">{r.nonce ?? c.nonceExternal(r.minimumNonce)}</span></Row>
          <Row label={c.block} mono>{r.blockHash}</Row>
          <Row label={c.reserved}>{formatMainnetAmount((BigInt(r.gasReserveYocto) + BigInt(r.storageReserveYocto)).toString(), MAINNET_ASSETS.NEAR, locale)}</Row>
          <Row label={c.opId} mono><span data-testid="op-hash">{r.operationHash}</span></Row>
          <Row label={c.network}>NEAR Mainnet</Row>
          <Row label={c.authority}><span data-testid="op-authority" className="text-[var(--tone-caution-fg)]">{prepared.authority === 'simulated' ? c.authoritySimulated : prepared.authority === 'http' ? c.authorityHttp : prepared.authority === 'http-gated' ? c.authorityHttpGated : prepared.authority === 'http-unavailable' ? c.authorityHttpUnavailable : c.authorityUnavailable}</span></Row>
        </dl>
        {a.kind === 'call' && (
          <details className="rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] p-3 text-[12px]">
            <summary className="cursor-pointer text-[13px] font-semibold">{c.args}</summary>
            <pre data-testid="op-args" className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-[var(--text-secondary)]">{a.argsJson}</pre>
          </details>
        )}
        <p className="text-[12px] text-[var(--text-muted)]" data-testid="op-expiry">{remaining > 0 ? `${c.expires} ${Math.ceil(remaining / 1000)} s` : c.expired}</p>
        <Button variant="primary" size="lg" disabled data-testid="op-confirm">{c.confirm}</Button>
        <p className="text-[13px] text-[var(--tone-caution-fg)]">{MAINNET_SIGNING_RELEASE_APPROVED ? '' : c.gate}</p>
      </div>
    </Card>
  );
}

type Ledger = Awaited<ReturnType<NonNullable<ReturnType<typeof walletBackend>>['readAttempt']>>;
type Reconciled = Awaited<ReturnType<NonNullable<ReturnType<typeof walletBackend>>['reconcile']>>;

/** Unknown-outcome UI: pending attempt, device ownership, FINAL reconciliation, permanent record. */
export function LedgerPanel() {
  const c = useOperationCopy();
  const signer = useSigner();
  const env = useEnv();
  const [ledger, setLedger] = useState<{ key: string; value: Ledger | 'error' } | null>(null);
  const [hint, setHint] = useState('');
  const [result, setResult] = useState<Reconciled | 'checking' | 'error' | null>(null);
  const [tick, setTick] = useState(0);
  const profiles = signingProfiles();
  const backend = signer.kind === 'ok' && profiles && env.device ? walletBackend({ signer: signer.signer, profiles, authority: env.authority, deviceId: env.device }) : null;
  const key = `${signer.kind === 'ok' ? signer.accountId : ''}|${env.device ?? ''}|${env.authority.kind}|${tick}`;
  useEffect(() => {
    if (backend === null) return;
    let live = true;
    backend.readAttempt().then((v) => live && setLedger({ key, value: v }), () => live && setLedger({ key, value: 'error' }));
    return () => { live = false; };
    // backend is rebuilt each render; the key captures every input it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (signer.kind !== 'ok') return null;
  if (env.authority.kind === 'unavailable') return <Notice tone="muted" testId="ledger-unavailable">{c.ledgerUnavailable}</Notice>;
  if (env.authority.kind === 'http') return <HttpLedgerStatus signer={signer.signer} accountId={signer.accountId} />;
  const l = ledger?.key === key ? ledger.value : null;
  async function check() {
    if (backend === null) return;
    setResult('checking');
    try { setResult(await backend.reconcile(hint.trim() === '' ? undefined : hint.trim())); setTick((t) => t + 1); }
    catch { setResult('error'); }
  }
  return (
    <Card>
      <div className="flex flex-col gap-2" data-testid="ledger" data-pending={l && l !== 'error' && l.pending ? l.pending.state : 'none'}>
        <h2 className="font-semibold">{c.ledgerTitle}</h2>
        <p className="text-[12px] font-semibold text-[var(--tone-caution-fg)]">{c.ledgerSimulated}</p>
        {l === 'error' && <Notice tone="danger">{c.errors['UNKNOWN']}</Notice>}
        {l && l !== 'error' && (
          <p data-testid="ledger-owner" data-owner={l.ownerDeviceId === env.device ? 'this' : 'other'} className="text-[13px]">{l.ownerDeviceId === env.device ? c.ownerThis : c.ownerOther}</p>
        )}
        {l === null && ledger?.key === key && <p className="text-[13px] text-[var(--text-secondary)]" data-testid="ledger-empty">{c.none}</p>}
        {l && l !== 'error' && l.pending && (
          <div className="flex flex-col gap-2" data-testid="ledger-pending">
            <Notice tone="caution" live><span className="font-semibold">{c.pendingTitle}</span> {c.pendingLead}</Notice>
            <dl>
              <Row label={c.pendingState}><span data-testid="ledger-state">{c.states[l.pending.state]}</span></Row>
              <Row label={c.txHash} mono>{l.pending.transactionHash ?? c.noHash}</Row>
              <Row label={c.opId} mono>{l.pending.operationHash}</Row>
            </dl>
            {l.pending.transactionHash === null && (
              <>
                <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="ledger-hint">{c.hint}</label>
                <input id="ledger-hint" className="min-h-[var(--tap-target)] w-full rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] px-3 font-mono text-[13px]" value={hint} onChange={(e) => setHint(e.target.value)} />
              </>
            )}
            <Button data-testid="ledger-check" onClick={() => void check()} disabled={result === 'checking'}>{result === 'checking' ? c.checking : c.check}</Button>
          </div>
        )}
        {result !== null && result !== 'checking' && (
          result === 'error' || result.kind !== 'FINAL_EXECUTION'
            ? <Notice tone="caution" live testId="ledger-result"><span data-kind="OUTCOME_UNRESOLVED">{c.unresolved}</span></Notice>
            : <Notice tone="muted" live testId="ledger-result"><span data-kind="FINAL_EXECUTION" data-execution={result.execution}>{c.executed(result.execution === 'SUCCESS')}</span> <span className="block text-[12px]">{c.settlementNote}</span></Notice>
        )}
        {l && l !== 'error' && l.completed.length > 0 && (
          <div>
            <h3 className="text-[13px] font-semibold">{c.history}</h3>
            <ul className="mt-1 flex flex-col gap-1" data-testid="ledger-history">
              {[...l.completed].reverse().slice(0, 10).map((x) => (
                <li key={x.attempt.attemptId} data-execution={x.proof.execution} className="flex flex-col gap-1 break-all font-mono text-[11px] text-[var(--text-secondary)]">
                  <span>{x.proof.execution} · nonce {x.proof.nonce} · {x.proof.transactionHash}</span>
                  {x.proof.execution === 'SUCCESS' && <DirectTransferCheck from={x.attempt.expectation.accountId} transactionHash={x.proof.transactionHash} receiverId={x.attempt.expectation.receiverId} action={x.attempt.expectation.action} />}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Authenticated authority mode: reading the record needs a wallet authorization (gated → fail closed). */
function HttpLedgerStatus({ signer, accountId }: { readonly signer: WalletSigner; readonly accountId: string }) {
  const c = useOperationCopy();
  const [state, setState] = useState<{ key: string; value: 'checking' | 'gated' | 'unavailable' | 'policy' | 'ok' } | null>(null);
  useEffect(() => {
    let live = true;
    const profiles = signingProfiles();
    const run = async () => {
      if (profiles === null) return 'unavailable' as const;
      try {
        await createHttpMainnetAuthority({ signer: authoritySignerFor(signer, confirmCommand), profiles }).read(accountId);
        return 'ok' as const;
      } catch (e) {
        if (e instanceof AuthorityError) return e.code === 'SIGNING_DISABLED' ? 'gated' as const : e.code === 'INVALID_AUTHORITY_CHALLENGE' || e.code === 'IDENTITY_MISMATCH' ? 'policy' as const : 'unavailable' as const;
        return 'unavailable' as const;
      }
    };
    void run().then((value) => { if (live) setState({ key: accountId, value }); });
    return () => { live = false; };
  }, [signer, accountId]);
  const v = state?.key === accountId ? state.value : 'checking';
  if (v === 'checking') return null;
  return (
    <Notice tone={v === 'ok' ? 'muted' : 'caution'} testId="ledger-http" >
      <span data-state={v}>{v === 'gated' ? c.ledgerHttpGated : v === 'ok' ? c.ledgerHttpOk : v === 'policy' ? c.errors['AUTHORITY_POLICY_MISMATCH'] : c.ledgerHttpUnavailable}</span>
    </Notice>
  );
}
