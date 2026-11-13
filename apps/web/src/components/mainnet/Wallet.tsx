'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  createMainnetAccountReader,
  createMainnetAttemptJournal,
  createMainnetNativeWalletBackend,
  createMainnetWalletChain,
  ed25519PublicKeyFromHex,
  EncryptedMainnetVault,
  mainnetSpendingBudget,
  MainnetVaultError,
  openMainnetAttemptStore,
} from '@taply/near-client';
import type { MainnetNativeReview, MainnetReadProfile, MainnetWalletIdentity, MainnetWalletSnapshot } from '@taply/near-client';
import { MainnetAccountSchema } from '@taply/shared';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Surface';
import { QrCode } from '@/components/payments/QrCode';
import { formatMainnetAmount, MAINNET_ASSETS } from '@/lib/mainnet/assets';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { MAINNET_SIGNING_RELEASE_APPROVED } from '@/lib/mainnet/release-gates';
import { walletEn, walletTr } from '@/lib/mainnet/wallet-copy';
import type { WalletCopy } from '@/lib/mainnet/wallet-copy';
import { Notice, Row } from './bits';

/**
 * Taply Wallet on NEAR Mainnet, wired to Codex's reviewed primitives
 * (docs/MAINNET_PROTOCOL_PHASE2.md "Wallet"):
 *  - EncryptedMainnetVault: 12-word phrase, password, separate Mainnet storage,
 *    Testnet backups rejected; never activates an account;
 *  - createMainnetWalletChain: final-block account + FullAccess key evidence =
 *    the only source of "activated";
 *  - createMainnetNativeWalletBackend: exact, 60-second native transfer review;
 *    submission throws while MAINNET_PROTOCOL_SIGNING_RELEASED is false;
 *  - durable attempt journal: an unresolved attempt blocks any new payment.
 * No key, phrase or password is stored by this component.
 */
export function useWalletCopy(): WalletCopy {
  return useMainnetLocale().locale === 'tr' ? walletTr : walletEn;
}

let vaultSingleton: EncryptedMainnetVault | null = null;
function vault(): EncryptedMainnetVault {
  vaultSingleton ??= new EncryptedMainnetVault(window.localStorage);
  return vaultSingleton;
}
const subscribe = (cb: () => void) => vault().subscribe(cb);
/** Identity + unlocked state, re-rendered on vault changes. */
export function useMainnetVault(): { identity: MainnetWalletIdentity | null; unlocked: boolean } {
  const snap = useSyncExternalStore(
    subscribe,
    () => {
      const v = vault();
      const id = v.getIdentity();
      return `${id?.accountId ?? ''}|${id?.provisioning ?? ''}|${v.unlocked ? 1 : 0}`;
    },
    () => '||0',
  );
  return useMemo(() => {
    if (typeof window === 'undefined') return { identity: null, unlocked: false };
    void snap;
    const v = vault();
    return { identity: v.getIdentity(), unlocked: v.unlocked };
  }, [snap]);
}

export function readProfile(): MainnetReadProfile | null {
  return MAINNET_CONFIG.ok ? { network: 'near-mainnet', rpcUrl: MAINNET_CONFIG.rpcUrl, rpcProviderId: MAINNET_CONFIG.rpcProviderId } : null;
}

function vaultError(c: WalletCopy, e: unknown): string {
  const code = e instanceof MainnetVaultError ? e.code : e instanceof Error ? e.message : '';
  return (c.errors as Record<string, string>)[code] ?? c.errors.UNKNOWN;
}

const input = 'min-h-[var(--tap-target)] w-full rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] px-3 text-[15px]';

function PasswordFields({ c, password, confirm, setPassword, setConfirm }: { c: WalletCopy; password: string; confirm: string; setPassword: (v: string) => void; setConfirm: (v: string) => void }) {
  return (
    <>
      <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="mw-pass">{c.password}</label>
      <input id="mw-pass" type="password" autoComplete="new-password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} />
      <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="mw-pass2">{c.passwordConfirm}</label>
      <input id="mw-pass2" type="password" autoComplete="new-password" className={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <p className="text-[12px] text-[var(--text-muted)]">{c.passwordHelp}</p>
    </>
  );
}

/** 12-word creation with an explicit backup check of three words. */
export function WalletCreate() {
  const c = useWalletCopy();
  const { identity } = useMainnetVault();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [words, setWords] = useState<string[] | null>(null);
  const [check, setCheck] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const positions = useMemo(() => (words ? pick3(words.length) : []), [words]);

  if (identity !== null && words === null) return <ExistingWallet c={c} />;
  async function create() {
    setError('');
    if (password.length < 8 || password !== confirm) { setError(password !== confirm ? c.errors.PASSWORD_MISMATCH : c.errors.WEAK_PASSWORD); return; }
    setBusy(true);
    try {
      await vault().create(password);
      setWords(await vault().revealRecoveryPhrase(password));
      setPassword(''); setConfirm('');
    } catch (e) { setError(vaultError(c, e)); } finally { setBusy(false); }
  }
  if (done) return <Notice tone="success" testId="wallet-created">{c.created} <Link className="underline" href="/m/wallet">{c.openWallet}</Link></Notice>;
  if (words !== null) {
    const ok = positions.every((p) => (check[p] ?? '').trim().toLowerCase() === words[p]);
    return (
      <Card>
        <div className="flex flex-col gap-3" data-testid="phrase-backup">
          <h2 className="font-semibold">{c.backupTitle}</h2>
          <Notice tone="caution">{c.backupWarning}</Notice>
          <ol className="grid grid-cols-3 gap-2 font-mono text-[14px]" data-testid="phrase-words">
            {words.map((w, i) => <li key={i} className="rounded border border-[var(--border-subtle)] px-2 py-1.5"><span className="text-[var(--text-muted)]">{i + 1}.</span> {w}</li>)}
          </ol>
          <p className="text-[13px]">{c.verifyHelp}</p>
          {positions.map((p) => (
            <label key={p} className="flex items-center gap-2 text-[14px]">#{p + 1}
              <input data-testid={`verify-${p}`} className={input} autoCapitalize="none" autoComplete="off" spellCheck={false} value={check[p] ?? ''} onChange={(e) => setCheck({ ...check, [p]: e.target.value })} />
            </label>
          ))}
          <Button data-testid="backup-done" disabled={!ok} onClick={() => { setWords(null); setDone(true); }}>{c.backupDone}</Button>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <p className="text-[14px]">{c.createLead}</p>
        <PasswordFields c={c} password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} />
        <Button type="submit" data-testid="wallet-create" disabled={busy}>{busy ? c.working : c.create}</Button>
        {error && <Notice tone="danger" live testId="wallet-error">{error}</Notice>}
        <p className="text-[12px] text-[var(--text-muted)]">{c.localOnly}</p>
      </form>
    </Card>
  );
}

function pick3(n: number): number[] {
  const all = Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  const r = crypto.getRandomValues(new Uint32Array(3));
  for (let i = 0; i < 3; i++) out.push(all.splice(r[i]! % all.length, 1)[0]!);
  return out.sort((a, b) => a - b);
}

export function WalletRestore() {
  const c = useWalletCopy();
  const { identity } = useMainnetVault();
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (done) return <Notice tone="success" testId="wallet-restored">{c.restored} <Link className="underline" href="/m/wallet">{c.openWallet}</Link></Notice>;
  if (identity !== null) return <ExistingWallet c={c} />;
  async function restore() {
    setError('');
    if (password.length < 8 || password !== confirm) { setError(password !== confirm ? c.errors.PASSWORD_MISMATCH : c.errors.WEAK_PASSWORD); return; }
    setBusy(true);
    try { await vault().restoreFromRecoveryPhrase(phrase, password); setPhrase(''); setPassword(''); setConfirm(''); setDone(true); }
    catch (e) { setError(vaultError(c, e)); } finally { setBusy(false); }
  }
  return (
    <Card>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void restore(); }}>
        <p className="text-[14px]">{c.restoreLead}</p>
        <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="mw-phrase">{c.phrase}</label>
        <textarea id="mw-phrase" rows={3} className={`${input} py-2 font-mono`} autoCapitalize="none" autoComplete="off" spellCheck={false} value={phrase} onChange={(e) => setPhrase(e.target.value)} />
        <PasswordFields c={c} password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} />
        <Button type="submit" data-testid="wallet-restore" disabled={busy}>{busy ? c.working : c.restore}</Button>
        {error && <Notice tone="danger" live testId="wallet-error">{error}</Notice>}
        <p className="text-[12px] text-[var(--text-muted)]">{c.restoreNote}</p>
      </form>
    </Card>
  );
}

function ExistingWallet({ c }: { c: WalletCopy }) {
  return <Notice tone="muted">{c.exists} <Link className="underline" href="/m/wallet">{c.openWallet}</Link></Notice>;
}

type Activation = { kind: 'checking' } | { kind: 'not_activated' } | { kind: 'active'; snapshot: MainnetWalletSnapshot; usdc: string | null } | { kind: 'unreadable' };

function publicKeyOf(identity: MainnetWalletIdentity): string {
  return ed25519PublicKeyFromHex(identity.publicKeyHex);
}

/** Final-block activation evidence: the account exists AND holds this FullAccess key. */
export function useActivation(identity: MainnetWalletIdentity | null, tick: number): Activation {
  const [state, setState] = useState<{ key: string; value: Activation } | null>(null);
  const key = identity === null ? '' : `${identity.accountId}|${tick}`;
  useEffect(() => {
    const profile = readProfile();
    if (identity === null || profile === null) return;
    let live = true;
    (async () => {
      try {
        const snapshot = await createMainnetWalletChain(profile).snapshot(identity.accountId, publicKeyOf(identity));
        if (snapshot === null) { if (live) setState({ key, value: { kind: 'not_activated' } }); return; }
        let usdc: string | null = null;
        try { usdc = (await createMainnetAccountReader(profile).readBalances(identity.accountId)).usdc; } catch { usdc = null; }
        if (live) setState({ key, value: { kind: 'active', snapshot, usdc } });
      } catch { if (live) setState({ key, value: { kind: 'unreadable' } }); }
    })();
    return () => { live = false; };
  }, [identity, key]);
  return state?.key === key ? state.value : { kind: 'checking' };
}

/** Durable attempt journal state for this account (IndexedDB, strict durability). */
export function useUnresolvedAttempt(accountId: string | null): 'none' | 'unresolved' | 'unavailable' | 'checking' {
  const [state, setState] = useState<{ id: string; value: 'none' | 'unresolved' | 'unavailable' } | null>(null);
  useEffect(() => {
    if (accountId === null) return;
    let live = true;
    openMainnetAttemptStore()
      .then(async (store) => {
        try { const v = await createMainnetAttemptJournal(store).read(accountId); if (live) setState({ id: accountId, value: v === null ? 'none' : 'unresolved' }); }
        finally { store.close(); }
      })
      .catch(() => live && setState({ id: accountId, value: 'unavailable' }));
    return () => { live = false; };
  }, [accountId]);
  return accountId === null ? 'none' : state?.id === accountId ? state.value : 'checking';
}

export function TaplyWalletHome() {
  const c = useWalletCopy();
  const { locale } = useMainnetLocale();
  const { identity, unlocked } = useMainnetVault();
  const [tick, setTick] = useState(0);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const activation = useActivation(identity, tick);
  const attempt = useUnresolvedAttempt(identity?.accountId ?? null);
  if (identity === null) {
    return (
      <Card>
        <div className="flex flex-col gap-2" data-testid="taply-wallet-empty">
          <h2 className="font-semibold">{c.title}</h2>
          <p className="text-[14px] text-[var(--text-secondary)]">{c.emptyLead}</p>
          <div className="flex flex-wrap gap-3"><Link className="underline" href="/m/wallet/create">{c.create}</Link><Link className="underline" href="/m/wallet/restore">{c.restore}</Link></div>
        </div>
      </Card>
    );
  }
  const spendable = activation.kind === 'active' ? mainnetSpendingBudget(activation.snapshot, '0') : null;
  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid="taply-wallet">
        <h2 className="font-semibold">{c.title}</h2>
        <dl>
          <Row label={c.account} mono>{identity.accountId}</Row>
          <Row label={c.status}>
            <span data-testid="activation" data-state={activation.kind}>
              {activation.kind === 'checking' ? c.checking : activation.kind === 'not_activated' ? c.notActivated : activation.kind === 'active' ? c.activated : c.unreadable}
            </span>
          </Row>
          {activation.kind === 'active' && spendable && (
            <>
              <Row label={c.balance}>{formatMainnetAmount(activation.snapshot.amountYocto, MAINNET_ASSETS.NEAR, locale)}</Row>
              <Row label={c.available}><span data-testid="available">{formatMainnetAmount(spendable.availableYocto, MAINNET_ASSETS.NEAR, locale)}</span></Row>
              <Row label={c.reserved}>{formatMainnetAmount((BigInt(spendable.storageReserveYocto) + BigInt(spendable.gasReserveYocto)).toString(), MAINNET_ASSETS.NEAR, locale)}</Row>
              {activation.usdc !== null && <Row label="USDC">{formatMainnetAmount(activation.usdc, MAINNET_ASSETS.USDC, locale)}</Row>}
              <Row label={c.finalBlock} mono>{activation.snapshot.blockHeight}</Row>
            </>
          )}
        </dl>
        {activation.kind === 'not_activated' && (
          <>
            <Notice tone="caution">{c.activationHelp}</Notice>
            <div className="flex justify-center"><QrCode value={identity.accountId} label={c.account} /></div>
          </>
        )}
        {attempt === 'unresolved' && <Notice tone="caution" live testId="attempt-unresolved">{c.unresolved}</Notice>}
        {attempt === 'unavailable' && <Notice tone="danger" live>{c.journalUnavailable}</Notice>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setTick((t) => t + 1)}>{c.refresh}</Button>
          <Link className="tap-target inline-flex items-center underline" href="/m/send">{c.send}</Link>
          <Link className="tap-target inline-flex items-center underline" href="/m/receive">{c.receive}</Link>
        </div>
        {unlocked ? (
          <Button variant="ghost" onClick={() => vault().lock()}>{c.lock}</Button>
        ) : (
          <form className="flex flex-col gap-2" onSubmit={async (e) => { e.preventDefault(); setError(''); try { await vault().unlock(password); setPassword(''); } catch (err) { setError(vaultError(c, err)); } }}>
            <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="mw-unlock">{c.password}</label>
            <input id="mw-unlock" type="password" autoComplete="current-password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button type="submit" variant="secondary" data-testid="wallet-unlock">{c.unlock}</Button>
          </form>
        )}
        {unlocked && <p data-testid="unlocked" className="text-[12px] text-[var(--text-muted)]">{c.unlockedNote}</p>}
        {error && <Notice tone="danger" live testId="wallet-error">{error}</Notice>}
      </div>
    </Card>
  );
}

/** Native send with the exact review from the reviewed backend. Confirmation is gated off. */
export function WalletSend() {
  const c = useWalletCopy();
  const { locale } = useMainnetLocale();
  const { identity } = useMainnetVault();
  const [receiver, setReceiver] = useState('');
  const [amount, setAmount] = useState('');
  const [review, setReview] = useState<MainnetNativeReview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const attempt = useUnresolvedAttempt(identity?.accountId ?? null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (identity === null) return <Notice tone="muted">{c.noWallet} <Link className="underline" href="/m/wallet/create">{c.create}</Link></Notice>;

  async function prepare() {
    setError(''); setReview(null);
    const profile = readProfile();
    if (!MainnetAccountSchema.safeParse(receiver.trim()).success) { setError(c.errors.BAD_RECIPIENT); return; }
    if (profile === null) { setError(c.errors.UNKNOWN); return; }
    setBusy(true);
    let store: Awaited<ReturnType<typeof openMainnetAttemptStore>> | null = null;
    try {
      store = await openMainnetAttemptStore();
      const backend = createMainnetNativeWalletBackend({ profile, store, signer: { kind: 'internal', vault: vault() } });
      setReview(await backend.prepare(receiver.trim(), amount.trim()));
    } catch (e) { setError(vaultError(c, e)); }
    finally { store?.close(); setBusy(false); }
  }
  const remaining = review === null ? 0 : review.expiresAtMs - now;
  return (
    <div className="flex flex-col gap-3">
      {attempt === 'unresolved' && <Notice tone="caution" live testId="attempt-unresolved">{c.unresolved}</Notice>}
      <Card>
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void prepare(); }}>
          <p className="text-[13px] text-[var(--text-secondary)]">{c.from}: <span className="font-mono">{identity.accountId}</span></p>
          <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="mw-to">{c.recipient}</label>
          <input id="mw-to" className={input} autoCapitalize="none" spellCheck={false} value={receiver} onChange={(e) => setReceiver(e.target.value)} />
          <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="mw-amount">{c.amountNear}</label>
          <input id="mw-amount" inputMode="decimal" className={input} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button type="submit" data-testid="send-review" disabled={busy || attempt === 'unresolved' || attempt === 'unavailable'}>{busy ? c.working : c.reviewSend}</Button>
          {error && <Notice tone="danger" live testId="wallet-error">{error}</Notice>}
        </form>
      </Card>
      {review !== null && (
        <Card>
          <div data-testid="send-review-card" className="flex flex-col gap-2">
            <h2 className="font-semibold">{c.reviewTitle}</h2>
            <dl>
              <Row label={c.recipient} mono>{review.receiverId}</Row>
              <Row label={c.amountNear}><span data-testid="review-amount">{formatMainnetAmount(review.depositYocto, MAINNET_ASSETS.NEAR, locale)}</span></Row>
              <Row label={c.from} mono>{review.signerAccountId}</Row>
              <Row label={c.key} mono>{review.publicKey}</Row>
              <Row label={c.nonce} mono>{review.nonce}</Row>
              <Row label={c.block} mono>{review.blockHash}</Row>
              <Row label={c.reserved}>{formatMainnetAmount((BigInt(review.gasReserveYocto) + BigInt(review.storageReserveYocto)).toString(), MAINNET_ASSETS.NEAR, locale)}</Row>
              <Row label={c.network}>NEAR Mainnet</Row>
            </dl>
            <p className="text-[12px] text-[var(--text-muted)]">{remaining > 0 ? `${c.reviewExpires} ${Math.ceil(remaining / 1000)} s` : c.reviewExpired}</p>
            <Button variant="primary" size="lg" disabled data-testid="send-confirm">{c.confirmSend}</Button>
            <p className="text-[13px] text-[var(--tone-caution-fg)]">{MAINNET_SIGNING_RELEASE_APPROVED ? '' : c.signingOff}</p>
          </div>
        </Card>
      )}
    </div>
  );
}
