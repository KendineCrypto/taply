'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  createMainnetAccountReader,
  createMainnetAttemptJournal,
  createMainnetWalletChain,
  ed25519PublicKeyFromHex,
  EncryptedMainnetVault,
  mainnetSpendingBudget,
  MainnetVaultError,
  openMainnetAttemptStore,
} from '@taply/near-client';
import type { MainnetAttempt, MainnetReadProfile, MainnetWalletIdentity, MainnetWalletSnapshot } from '@taply/near-client';
import { MainnetAccountSchema } from '@taply/shared';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Surface';
import { QrCode } from '@/components/payments/QrCode';
import { formatMainnetAmount, MAINNET_ASSETS, parseMainnetAmount } from '@/lib/mainnet/assets';
import { newBusinessId, stableBusinessId } from '@/lib/mainnet/wallet-ops';
import { LedgerPanel, OperationError, OperationReview, OPERATION_COPY, useOperation } from './Operation';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { walletEn, walletTr } from '@/lib/mainnet/wallet-copy';
import type { WalletCopy } from '@/lib/mainnet/wallet-copy';
import { Notice, Row } from './bits';
import { NoWalletCard } from './NoWalletCard';
import { useT } from '@/lib/i18n/provider';

/**
 * Taply Wallet on NEAR Mainnet, wired to Codex's reviewed primitives
 * (docs/MAINNET_PROTOCOL_PHASE2.md "Wallet"):
 *  - EncryptedMainnetVault: 12-word phrase, password, separate Mainnet storage,
 *    Testnet backups rejected; never activates an account;
 *  - createMainnetWalletChain: final-block account + FullAccess key evidence =
 *    the only source of "activated";
 *  - Send: Codex's unified planner/backend via ./Operation (exact 60-second
 *    review; submit closed while MAINNET_PROTOCOL_SIGNING_RELEASED is false);
 *  - legacy v1 attempt journal: never migrated; any entry still blocks sending.
 * No key, phrase or password is stored by this component.
 */
export function useWalletCopy(): WalletCopy {
  return useMainnetLocale().locale === 'tr' ? walletTr : walletEn;
}

let vaultSingleton: EncryptedMainnetVault | null = null;
export function vault(): EncryptedMainnetVault {
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
  // Derived from the store snapshot only, so the hydration render matches the server render.
  return useMemo(() => {
    const [accountId, , unlocked] = snap.split('|');
    if (!accountId) return { identity: null, unlocked: false };
    return { identity: vault().getIdentity(), unlocked: unlocked === '1' };
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

  if (done) return <Notice tone="success" testId="wallet-created">{c.created} <Link className="underline" href="/m/wallet">{c.openWallet}</Link></Notice>;
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
  return useAttemptRecord(accountId).status;
}

/** The durable journal entry itself, so a pending/unknown outcome shows its recorded state and hash. */
export function useAttemptRecord(accountId: string | null): { status: 'none' | 'unresolved' | 'unavailable' | 'checking'; attempt: MainnetAttempt | null } {
  const [state, setState] = useState<{ id: string; value: 'none' | 'unresolved' | 'unavailable'; attempt: MainnetAttempt | null } | null>(null);
  useEffect(() => {
    if (accountId === null) return;
    let live = true;
    openMainnetAttemptStore()
      .then(async (store) => {
        try { const v = await createMainnetAttemptJournal(store).read(accountId); if (live) setState({ id: accountId, value: v === null ? 'none' : 'unresolved', attempt: v }); }
        finally { store.close(); }
      })
      .catch(() => live && setState({ id: accountId, value: 'unavailable', attempt: null }));
    return () => { live = false; };
  }, [accountId]);
  if (accountId === null) return { status: 'none', attempt: null };
  return state?.id === accountId ? { status: state.value, attempt: state.attempt } : { status: 'checking', attempt: null };
}

/** Pending/unknown outcome: what the journal recorded. Never offers to pay again. */
export function AttemptDetails({ c, attempt }: { c: WalletCopy; attempt: MainnetAttempt }) {
  return (
    <dl data-testid="attempt-details" data-state={attempt.state}>
      <Row label={c.attemptState}>{c.attemptStates[attempt.state]}</Row>
      <Row label={c.attemptTx} mono>{attempt.transactionHash ?? c.attemptNoTx}</Row>
    </dl>
  );
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
const AMOUNT_ERROR = { invalid: 'AMOUNT_INVALID', precision: 'AMOUNT_PRECISION', zero: 'AMOUNT_INVALID', cap: 'AMOUNT_CAP' } as const;

/**
 * Send NEAR / USDC through Codex's unified planner (`nativeSend` / `usdcSend`).
 * The business ID is stable for this user payment across reload and review and
 * changes ONLY when the user explicitly starts a new payment. USDC evidence
 * (balance, both registrations, pinned token code) is read by the planner at
 * the snapshot block; the app no longer has its own token reader.
 */
export function WalletSend() {
  const c = useWalletCopy();
  const t = useT();
  const { locale } = useMainnetLocale();
  const op = useOperation();
  const [asset, setAsset] = useState<'NEAR' | 'USDC'>('NEAR');
  const [receiver, setReceiver] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const accountId = op.signer.kind === 'ok' ? op.signer.accountId : null;
  const legacy = useAttemptRecord(accountId);
  const { unlocked } = useMainnetVault();
  const [password, setPassword] = useState('');
  const locked = op.signer.kind === 'ok' && op.signer.signer.kind === 'internal' && !unlocked;
  if (op.signer.kind !== 'ok') {
    return op.signer.kind === 'external-no-key'
      ? <Notice tone="caution" testId="external-no-key">{OPERATION_COPY[locale].externalNoKey}</Notice>
      : <NoWalletCard text={t.walletUx.send.connectFirst} />;
  }
  const from = op.signer.accountId;
  const edit = (f: () => void) => { f(); op.reset(); setError(''); };

  async function prepare() {
    setError('');
    const to = receiver.trim();
    if (!MainnetAccountSchema.safeParse(to).success) { setError(c.errors.BAD_RECIPIENT); return; }
    const parsed = parseMainnetAmount(amount, asset === 'USDC' ? MAINNET_ASSETS.USDC : MAINNET_ASSETS.NEAR);
    if (!parsed.ok && !(asset === 'NEAR' && parsed.reason === 'cap')) { setError(c.errors[AMOUNT_ERROR[parsed.reason]]); return; }
    let businessId: string;
    try { businessId = stableBusinessId(window.localStorage, from, 'send'); } catch { setError(c.errors.UNKNOWN); return; }
    await op.run(asset === 'USDC' && parsed.ok
      ? { kind: 'usdcSend', receiverId: to, amountBaseUnits: parsed.baseUnits, businessId }
      : { kind: 'nativeSend', receiverId: to, amountNear: amount.trim(), businessId });
  }
  function startNew() {
    try { newBusinessId(window.localStorage, from, 'send'); } catch { /* storage unavailable: prepare will fail closed */ }
    setReceiver(''); setAmount(''); setError(''); op.reset();
  }
  return (
    <div className="flex flex-col gap-3">
      {legacy.status === 'unresolved' && (
        <Notice tone="caution" live testId="attempt-unresolved">
          {c.unresolved}
          {legacy.attempt !== null && <AttemptDetails c={c} attempt={legacy.attempt} />}
        </Notice>
      )}
      {legacy.status === 'unavailable' && <Notice tone="danger" live testId="attempt-unavailable">{c.journalUnavailable}</Notice>}
      <LedgerPanel />
      {locked && (
        <Card>
          <form className="flex flex-col gap-2" data-testid="send-unlock" onSubmit={async (e) => { e.preventDefault(); setError(''); try { await vault().unlock(password); setPassword(''); } catch (err) { setError(vaultError(c, err)); } }}>
            <p className="text-[14px] font-medium">{OPERATION_COPY[locale].errors['WALLET_LOCKED']}</p>
            <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="mw-send-unlock">{c.password}</label>
            <input id="mw-send-unlock" type="password" autoComplete="current-password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button type="submit" variant="secondary">{c.unlock}</Button>
          </form>
        </Card>
      )}
      <Card>
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void prepare(); }}>
          <p className="text-[13px] text-[var(--text-secondary)]">{c.from}: <span className="break-all font-mono">{from}</span></p>
          <fieldset className="flex gap-2" data-testid="send-asset">
            <legend className="mb-1 text-[13px] text-[var(--text-secondary)]">{c.asset}</legend>
            {(['NEAR', 'USDC'] as const).map((a) => (
              <label key={a} className="flex min-h-[var(--tap-target)] cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-subtle)] px-3 has-[:checked]:border-[var(--accent)]">
                <input type="radio" name="mw-asset" value={a} checked={asset === a} onChange={() => edit(() => setAsset(a))} />
                {a}
              </label>
            ))}
          </fieldset>
          <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="mw-to">{c.recipient}</label>
          <input id="mw-to" className={input} autoCapitalize="none" spellCheck={false} value={receiver} onChange={(e) => edit(() => setReceiver(e.target.value))} />
          <label className="text-[13px] text-[var(--text-secondary)]" htmlFor="mw-amount">{asset === 'USDC' ? c.amountUsdc : c.amountNear}</label>
          <input id="mw-amount" inputMode="decimal" className={input} value={amount} onChange={(e) => edit(() => setAmount(e.target.value))} />
          <Button type="submit" data-testid="send-review" disabled={op.busy || legacy.status !== 'none'}>{op.busy ? c.working : c.reviewSend}</Button>
          {error && <Notice tone="danger" live testId="wallet-error">{error}</Notice>}
          <OperationError code={op.error} />
          {op.error === 'OPERATION_ALREADY_CONSUMED' && <Button variant="secondary" data-testid="send-new" onClick={startNew}>{c.startNew}</Button>}
        </form>
      </Card>
      {op.prepared !== null && (
        <div data-testid="send-review-card" data-asset={asset}>
          <OperationReview prepared={op.prepared} title={c.reviewTitle} />
          <Button className="mt-2" variant="ghost" data-testid="send-new" onClick={startNew}>{c.startNew}</Button>
        </div>
      )}
    </div>
  );
}
