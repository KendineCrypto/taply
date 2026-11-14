'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { calculateMainnetRequestId, calculateMainnetTermsHash, MainnetIntentTermsSchema } from '@taply/shared';
import type { MainnetIntentTerms } from '@taply/shared';
import { prepareMainnetCreateRequest, prepareMainnetTokenStorageDeposit } from '@taply/near-client';
import type { MainnetCall } from '@taply/near-client';
import { Button } from '@/components/primitives/Button';
import { Card, ScreenHeader } from '@/components/primitives/Surface';
import { QrCode } from '@/components/payments/QrCode';
import type { SubmitOutcome } from '@/lib/mainnet/wallet-ops';
import { MAINNET_ASSETS, formatMainnetAmount, parseMainnetAmount } from '@/lib/mainnet/assets';
import type { MainnetAsset } from '@/lib/mainnet/assets';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { FIXTURE_CODE_HASH, FIXTURE_CONTRACT, FIXTURE_MERCHANT, FIXTURE_STORAGE_BOND_YOCTO } from '@/lib/mainnet/fixtures';
import { readerOrNull, useUsdcRegistration } from '@/lib/mainnet/hooks';
import { useMainnetWallet } from '@/lib/mainnet/wallet';
import { CallPreview, Notice } from './bits';
import { readPrefill } from '@/lib/mainnet/prefill';
import { WalletPanel } from './WalletPanel';
import { OperationError, OperationReview, useOperation, useSigner } from './Operation';
import { bindSale, displayMemo, encodeSale, newCommerceSession, rememberSale } from '@/lib/mainnet/commerce';
import { AuthorityError, createHttpMainnetAuthority } from '@/lib/mainnet/authority-client';
import { authoritySignerFor, currentAuthority, signingProfiles } from '@/lib/mainnet/wallet-ops';
import { canonicalJson } from '@taply/shared';
import type { MainnetCommerceSession } from '@taply/near-client';
import { fill, useMainnetCopy, useMainnetLocale as useLocale } from '@/lib/mainnet/copy';

const HOUR_NS = 3_600_000_000_000n;

function randomNonce(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function buildTerms(input: {
  contractId: 'taply-pay.kendinecrypto.near' | 'devkendinecrypto.near';
  creator: string;
  asset: MainnetAsset;
  amountBaseUnits: string;
  memo: string;
  nowMs: number;
  nonce: string;
}): MainnetIntentTerms {
  const id = calculateMainnetRequestId({ contractId: input.contractId, creationNonce: input.nonce, creatorAccountId: input.creator, network: 'near-mainnet' });
  return MainnetIntentTermsSchema.parse({
    schemaVersion: 'taply.intent.v1',
    id,
    network: 'near-mainnet',
    contractId: input.contractId,
    creationNonce: input.nonce,
    creatorAccountId: input.creator,
    assetId: input.asset.id,
    amountBaseUnits: input.amountBaseUnits,
    mode: 'instant',
    cancelDurationNs: null,
    fundingExpiresAtNs: (BigInt(input.nowMs) * 1_000_000n + HOUR_NS).toString(),
    permittedPayerAccountId: null,
    merchantAccountId: null,
    memo: input.memo,
    sessionBinding: null,
  });
}

type CreateQuote = Parameters<typeof prepareMainnetCreateRequest>[0]['quote'];
type Bond = ({ kind: 'fixture' | 'quoted' } & CreateQuote) | { kind: 'unknown' };

type FreezeStatus = 'frozen' | 'gated' | 'unavailable' | 'mismatch';
/** Ask the authority to freeze the sale; the returned commitment must equal the locally bound one. */
async function freezeSale(signer: ReturnType<typeof useSigner>, session: MainnetCommerceSession, terms: MainnetIntentTerms): Promise<FreezeStatus> {
  const profiles = signingProfiles();
  if (profiles === null || signer.kind !== 'ok' || signer.accountId !== session.merchantAccountId) return 'unavailable';
  // The draft is the bound terms with the commitment line removed (bindCommerce binds the draft itself).
  const draft = { ...terms, memo: displayMemo(terms.memo) };
  try {
    const http = createHttpMainnetAuthority({ signer: authoritySignerFor(signer.signer, async () => window.confirm('Freeze this sale?')), profiles });
    const out = await http.bindCommerce('instant', draft, session);
    return canonicalJson(out.terms) === canonicalJson(terms) ? 'frozen' : 'mismatch';
  } catch (e) {
    return e instanceof AuthorityError && e.code === 'SIGNING_DISABLED' ? 'gated' : 'unavailable';
  }
}

/** `commerce`: merchant register — each instance is one sale bound to a fresh commerce session (Codex binding). */
export function CreateRequest({ commerce = false }: { readonly commerce?: boolean } = {}) {
  const c = useMainnetCopy();
  const { locale } = useLocale();
  const wallet = useMainnetWallet();
  // Personal requests default to NEAR (Taply Wallet balance); merchant sales to USDC.
  const [assetKey, setAssetKey] = useState<'USDC' | 'NEAR'>(commerce ? 'USDC' : 'NEAR');
  const signerChoice = useSigner();
  const [done, setDone] = useState<SubmitOutcome | null>(null);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  // Prefill from Split / Recurring links, re-validated (lib/mainnet/prefill.ts).
  useEffect(() => {
    const p = readPrefill(window.location.search);
    if (p === null) return;
    queueMicrotask(() => {
      setAssetKey(p.asset);
      setAmount(p.amount);
      setMemo(p.memo);
    });
  }, []);
  // Time the merchant pressed Review (event handler), so the 1-hour expiry is fresh.
  const [reviewAtMs, setReviewAtMs] = useState<number | null>(null);
  const reviewing = reviewAtMs !== null;
  const [nonce] = useState(randomNonce);
  const [session, setSession] = useState<MainnetCommerceSession | null>(null);
  const op = useOperation();
  const reg = useOperation();
  const [quotedBond, setQuotedBond] = useState<{ termsHash: string; bond: Bond } | null>(null);
  const [storageBounds, setStorageBounds] = useState<{ account: string; min: string } | null>(null);

  const fixtures = MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures;
  const asset = MAINNET_ASSETS[assetKey];
  // The Taply Wallet (or a connected wallet that reports its key) receives the payment.
  const creator = (signerChoice.kind === 'ok' ? signerChoice.accountId : null) ?? wallet.accountId ?? (fixtures ? FIXTURE_MERCHANT : null);
  const contractId = MAINNET_CONFIG.ok && MAINNET_CONFIG.contract.status === 'configured'
    ? (MAINNET_CONFIG.contract.accountId as 'taply-pay.kendinecrypto.near' | 'devkendinecrypto.near')
    : fixtures ? FIXTURE_CONTRACT : null;
  const registration = useUsdcRegistration(assetKey === 'USDC' ? creator : null);
  const parsed = useMemo(() => amount.trim() === '' ? null : parseMainnetAmount(amount, asset), [amount, asset]);
  const memoOk = new TextEncoder().encode(memo).length <= 256;

  const bound = useMemo(() => {
    if (reviewAtMs === null || parsed === null || !parsed.ok || creator === null || contractId === null || !memoOk) return null;
    try {
      const draft = buildTerms({ contractId, creator, asset, amountBaseUnits: parsed.baseUnits, memo, nowMs: reviewAtMs, nonce });
      if (!commerce || session === null) return { terms: draft, sale: null };
      return bindSale(draft, session);
    } catch {
      return null;
    }
  }, [reviewAtMs, parsed, creator, contractId, asset, memo, nonce, memoOk, commerce, session]);
  const terms = bound?.terms ?? null;
  const saleLink = bound?.sale && terms ? `/m/pay/${terms.id}?m=${terms.creatorAccountId}#c=${encodeSale(bound.sale)}` : null;
  useEffect(() => {
    if (bound?.sale && terms) { try { rememberSale(window.localStorage, terms.id, bound.sale); } catch { /* the sale link still works */ } }
  }, [bound, terms]);
  // Authenticated mode: the authority freezes this session's exact terms (Codex bindCommerce); gated/unreachable → not frozen.
  const freezer = useSigner();
  const freezerRef = useRef(freezer);
  useEffect(() => { freezerRef.current = freezer; });
  const freezerKey = freezer.kind === 'ok' ? freezer.accountId : freezer.kind;
  const [frozen, setFrozen] = useState<{ id: string; status: FreezeStatus } | null>(null);
  const saleKey = commerce && bound?.sale && terms !== null ? `${terms.id}|${bound.sale.termsHash}` : null;
  useEffect(() => {
    // Once per bound sale (keyed by request id + terms hash) — never on every render.
    if (saleKey === null || !bound?.sale || terms === null || currentAuthority().kind !== 'http') return;
    let live = true;
    const draftKey = terms.id;
    void freezeSale(freezerRef.current, bound.sale.session, bound.terms).then((status) => { if (live) setFrozen({ id: draftKey, status }); });
    return () => { live = false; };
    // bound/terms are captured by saleKey; freezer identity changes every render, its account is in freezerKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleKey, freezerKey]);

  // Storage bond: the contract's quote_create_request (real) or the labelled sandbox value (fixture).
  useEffect(() => {
    if (terms === null || fixtures) return;
    const reader = readerOrNull();
    if (reader === null) return;
    let live = true;
    reader
      .quoteCreateRequest(terms)
      .then((r) => {
        const q = r.data as CreateQuote | null;
        if (q && MAINNET_CONFIG.ok && MAINNET_CONFIG.profile) {
          // Validate the ORIGINAL quote, including its hash/version. Never
          // synthesize a current hash around a stale storage deposit.
          prepareMainnetCreateRequest({ profile: MAINNET_CONFIG.profile, terms, signerAccountId: terms.creatorAccountId, quote: q });
          if (live) setQuotedBond({ termsHash: calculateMainnetTermsHash(terms), bond: { ...q, kind: 'quoted' } });
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [terms, fixtures]);

  useEffect(() => {
    if (fixtures || creator === null || registration !== 'not_registered') return;
    const reader = readerOrNull();
    if (reader === null) return;
    let live = true;
    reader.readUsdcStorageBounds().then(r => {
      if (live) setStorageBounds({ account: creator, min: r.data.min });
    }).catch(() => { if (live) setStorageBounds(null); });
    return () => { live = false; };
  }, [creator, fixtures, registration]);

  const bond: Bond = terms === null
    ? { kind: 'unknown' }
    : fixtures
      ? { kind: 'fixture', requestId: terms.id, termsHash: calculateMainnetTermsHash(terms), quoteVersion: '1', depositYocto: FIXTURE_STORAGE_BOND_YOCTO, gas: '30000000000000' }
      : quotedBond !== null && quotedBond.termsHash === calculateMainnetTermsHash(terms) ? quotedBond.bond : { kind: 'unknown' };
  const profile = MAINNET_CONFIG.ok ? MAINNET_CONFIG.profile : null;
  const profileForBuild = profile ?? (fixtures && contractId !== null && MAINNET_CONFIG.ok
    ? { network: 'near-mainnet' as const, rpcUrl: MAINNET_CONFIG.rpcUrl, rpcProviderId: MAINNET_CONFIG.rpcProviderId, contract: { accountId: contractId, expectedCodeHash: FIXTURE_CODE_HASH } }
    : null);

  let createCall: MainnetCall | null = null;
  if (terms !== null && bond.kind !== 'unknown' && profileForBuild !== null && creator !== null) {
    try { createCall = prepareMainnetCreateRequest({ profile: profileForBuild, terms, signerAccountId: creator, quote: bond }); }
    catch { createCall = null; }
  }
  let registerCall: MainnetCall | null = null;
  if (!fixtures && assetKey === 'USDC' && registration === 'not_registered' && profileForBuild !== null && creator !== null && storageBounds?.account === creator) {
    try { registerCall = prepareMainnetTokenStorageDeposit(profileForBuild, creator, storageBounds.min); }
    catch { registerCall = null; }
  }

  useEffect(() => {
    if (terms === null || fixtures || op.prepared !== null || op.busy || op.error !== '') return;
    void op.run({ kind: 'instantCreate', terms });
    // Runs once per bound terms object; op is a fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms, fixtures]);
  const shareOrigin = MAINNET_CONFIG.ok && MAINNET_CONFIG.shareOrigin ? MAINNET_CONFIG.shareOrigin : typeof window === 'undefined' ? '' : window.location.origin;
  const payLink = terms !== null ? `${shareOrigin}/m/pay/${terms.id}` : null;

  if (!MAINNET_CONFIG.ok) return <Notice tone="danger">{c.home.configBroken}</Notice>;

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader title={c.create.title} description={c.create.lead} />

      {creator === null || (fixtures && wallet.accountId === null && signerChoice.kind !== 'ok') ? (
        <Card>
          {fixtures && <Notice tone="muted">{fill(c.create.fixtureMerchant, { account: FIXTURE_MERCHANT })}</Notice>}
          {!fixtures && <p className="mb-2 text-[14px] text-[var(--text-secondary)]">{c.create.connectFirst}</p>}
          <div className="mt-2"><WalletPanel /></div>
        </Card>
      ) : (
        <p className="text-sm text-[var(--text-secondary)]">{c.create.receiveTo}: <span className="chain-id break-all text-[var(--text-primary)]">{creator}</span></p>
      )}

      {!reviewing ? (
        <Card>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (parsed?.ok && creator !== null && memoOk) {
                const at = Date.now();
                // One session per sale; the request's funding expiry (1 h) equals the session expiry.
                if (commerce && contractId !== null) setSession(newCommerceSession(contractId, creator, (BigInt(at) * 1_000_000n + HOUR_NS).toString()));
                setReviewAtMs(at);
                op.reset();
              }
            }}
          >
            <fieldset>
              <legend className="mb-1.5 text-[13px] text-[var(--text-secondary)]">{c.create.assetLabel}</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup">
                {(['USDC', 'NEAR'] as const).map((key) => (
                  <label key={key} className={`pressable flex min-h-[var(--tap-target)] cursor-pointer items-center justify-center rounded-[var(--radius-control)] border text-[15px] font-semibold ${assetKey === key ? 'border-[var(--taply-lime)] bg-[var(--tone-success-bg)]' : 'border-[var(--border-subtle)]'}`}>
                    <input type="radio" name="asset" value={key} checked={assetKey === key} onChange={() => setAssetKey(key)} className="sr-only" />
                    {key}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor="amount" className="text-[13px] text-[var(--text-secondary)]">{c.create.amountLabel} ({asset.symbol})</label>
              <input
                id="amount"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={parsed !== null && !parsed.ok}
                aria-describedby="amount-help"
                className="mt-1 min-h-[52px] w-full rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] px-3 text-[20px] font-semibold tabular-nums"
              />
              <p id="amount-help" className="mt-1 text-[12px] text-[var(--text-muted)]">{fill(c.create.capNote, { cap: formatMainnetAmount(asset.capBaseUnits, asset, locale) })}</p>
              {parsed !== null && !parsed.ok && <p role="alert" className="mt-1 text-[13px] text-[var(--tone-danger-fg)]">{c.create.errors[parsed.reason]}</p>}
            </div>
            <div>
              <label htmlFor="memo" className="text-[13px] text-[var(--text-secondary)]">{c.create.memoLabel}</label>
              <input id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={256} className="mt-1 min-h-[var(--tap-target)] w-full rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] px-3 text-[15px]" />
              <p className="mt-1 text-[12px] text-[var(--text-muted)]">{c.create.memoHint}</p>
            </div>
            <Button type="submit" variant="primary" size="lg" block disabled={!(parsed?.ok && creator !== null && memoOk)}>{c.create.review}</Button>
          </form>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {done !== null && done.kind === 'FINAL_EXECUTION' && done.execution === 'SUCCESS' && payLink !== null ? (
            <Card>
              <div className="flex flex-col items-center gap-3 text-center" data-testid="request-share">
                <p className="display-amount text-[2rem] leading-none">{parsed?.ok ? formatMainnetAmount(parsed.baseUnits, asset, locale) : ''}</p>
                <QrCode value={saleLink !== null ? `${shareOrigin}${saleLink}` : payLink} label={c.create.title} />
                <p className="break-all font-mono text-[12px] text-[var(--text-secondary)]" data-testid="request-link">{saleLink !== null ? `${shareOrigin}${saleLink}` : payLink}</p>
                <Button variant="secondary" onClick={() => { void navigator.clipboard?.writeText(saleLink !== null ? `${shareOrigin}${saleLink}` : payLink); }}>Copy link</Button>
              </div>
            </Card>
          ) : (
            <>
              {fixtures && (
                <Card>
                  <p className="display-amount text-[2rem] leading-none">{parsed?.ok ? formatMainnetAmount(parsed.baseUnits, asset, locale) : '—'}</p>
                  {terms !== null && <p className="mt-2 break-all font-mono text-[11px] text-[var(--text-muted)]" data-testid="create-request-id">{terms.id}</p>}
                </Card>
              )}
              {commerce && reviewing && terms === null && <Notice tone="danger" testId="sale-bind-error">{c.create.saleBindError}</Notice>}
              {!fixtures && op.busy && op.prepared === null && <p role="status" className="text-sm text-[var(--text-secondary)]">…</p>}
              <OperationError code={op.error} />
              {op.prepared !== null && (
                <OperationReview prepared={op.prepared} title={c.create.title} onDone={setDone}>
                  {memo !== '' && <p className="text-sm text-[var(--text-secondary)]">{memo}</p>}
                  {bond.kind === 'quoted' && <p className="text-[12px] text-[var(--text-muted)]">{fill(c.create.storageQuote, { amount: formatMainnetAmount(bond.depositYocto, MAINNET_ASSETS.NEAR, locale).replace(' NEAR', '') })}</p>}
                  {terms !== null && <span className="sr-only" data-testid="create-request-id">{terms.id}</span>}
                </OperationReview>
              )}
              {createCall !== null && (
                <details className="text-[12px] text-[var(--text-muted)]">
                  <summary className="cursor-pointer">{c.create.callTitle}</summary>
                  <CallPreview call={createCall} title={c.create.callTitle} />
                </details>
              )}
              {saleLink !== null && <p data-testid="sale-link" className="break-all font-mono text-[11px] text-[var(--text-muted)]">{saleLink}</p>}
              {terms !== null && frozen?.id === terms.id && <p data-testid="sale-freeze" data-status={frozen.status} className="text-[12px] text-[var(--tone-caution-fg)]">{c.create.saleFreeze[frozen.status]}</p>}
              <Button variant="ghost" onClick={() => { setReviewAtMs(null); setSession(null); setDone(null); op.reset(); }}>{c.create.back}</Button>
            </>
          )}
        </div>
      )}

      {assetKey === 'USDC' && creator !== null && (
        <Card>
          <h2 className="text-[14px] font-semibold">{c.create.usdcRegTitle}</h2>
          <p data-testid="usdc-registration" className="mt-1 text-[14px] text-[var(--text-secondary)]">
            {registration === 'registered' || registration === 'fixture_registered'
              ? c.create.usdcRegistered
              : registration === 'not_registered'
                ? c.create.usdcNotRegistered
                : c.create.usdcRegUnknown}
          </p>
          {registration === 'not_registered' && (
            <div className="mt-2 flex flex-col gap-2">
              {registerCall !== null && <CallPreview call={registerCall} title={c.create.callTitle} />}
              {!fixtures && <Button variant="secondary" data-testid="usdc-register-review" disabled={reg.busy} onClick={() => void reg.run({ kind: 'registerUsdc' })}>{c.create.usdcRegCta}</Button>}
              {fixtures && <Button variant="secondary" disabled>{c.create.usdcRegCta}</Button>}
              <OperationError code={reg.error} />
              {reg.prepared !== null && <OperationReview prepared={reg.prepared} title={c.create.usdcRegCta} />}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
