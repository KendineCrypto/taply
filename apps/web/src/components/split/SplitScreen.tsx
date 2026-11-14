'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Button, ButtonLink, Spinner } from '@/components/primitives/Button';
import { Card, EmptyState, ScreenHeader } from '@/components/primitives/Surface';
import { Icon } from '@/components/shell/Icons';
import { Sheet } from '@/components/shell/Sheet';
import { ConnectWalletButton } from '@/components/wallet/WalletConnect';
import { InvalidAmountError, formatBaseUnits, toBaseUnits } from '@/lib/format/amount';
import { fill } from '@/lib/i18n/fill';
import { useLocale, useT } from '@/lib/i18n/provider';
import { usePayments } from '@/lib/payments/context';
import { buildPaymentView } from '@/lib/payments/intent';
import { NEAR_NATIVE } from '@/lib/protocol';
import type { ContractRequest } from '@/lib/protocol';
import {
  MAX_GROUPS,
  MAX_PARTICIPANTS,
  childMemo,
  childStatusFromChain,
  createSplit,
  equalShares,
  groupStatus,
  isLocked,
  verifiedAmount,
} from '@/lib/split/split';
import type { ChildStatus, SplitGroup, SplitInput, SplitProblem, SplitStorage } from '@/lib/split/split';
import { useSplits } from '@/lib/split/use-splits';
import { buildPrefillLink } from '@/lib/tools/handoff';
import { collectReferences } from '@/lib/verify/references';
import { useFundingLocator } from '@/lib/verify/use-funding-locator';
import { useReceiptVerification } from '@/lib/verify/use-receipt-verification';
import { useWallet } from '@/lib/wallet/provider';

// Readable by default ("≈" when digits were dropped); the exact value is one tap away.
const near = (units: bigint | string, locale: 'en' | 'tr') => {
  const f = formatBaseUnits(units.toString(), NEAR_NATIVE.decimals, { locale });
  return `${f.truncated ? '≈ ' : ''}${f.display} NEAR`;
};
const exactNear = (units: bigint | string, locale: 'en' | 'tr') => `${formatBaseUnits(units.toString(), NEAR_NATIVE.decimals, { locale }).exact} NEAR`;

/** `/split` (UX_FLOWS screen 20). */
export function SplitScreen({ storage }: { readonly storage?: SplitStorage | null }) {
  const t = useT();
  const s = t.tools.split;
  const { state: wallet } = useWallet();
  const store = useSplits(storage === undefined ? undefined : storage);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<SplitGroup | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const account = wallet.status === 'connected' ? wallet.session.accountId : null;

  const header = (
    <>
      <ScreenHeader title={s.title} description={s.description} />
    </>
  );
  const state = store.state;
  if (state === null) return header;
  if (state.status !== 'ok') {
    return (
      <>
        {header}
        <InlineNotice copy={state.status === 'unavailable' ? s.unavailable : s.corrupt} tone={state.status === 'unavailable' ? 'caution' : 'danger'} />
      </>
    );
  }
  if (adding && account !== null) {
    return (
      <>
        <ScreenHeader title={s.addTitle} />
        <Card className="p-5">
          <SplitForm
            recipient={account}
            onCancel={() => setAdding(false)}
            onSave={(input) => {
              const result = createSplit(input, {
                recipientAccountId: account,
                now: new Date(),
                id: crypto.randomUUID(),
                participantId: () => crypto.randomUUID(),
              });
              if (!result.ok) return result.problems;
              if (!store.mutate((list) => (list.length >= MAX_GROUPS ? null : [result.group, ...list]))) return ['save_failed'];
              setAdding(false);
              setNotice(s.saved);
              return [];
            }}
          />
        </Card>
      </>
    );
  }
  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        {account === null ? (
          <Card className="flex flex-col gap-3 p-5">
            <p className="text-sm text-[var(--text-secondary)]">{s.connectFirst}</p>
            <ConnectWalletButton />
          </Card>
        ) : (
          <div className="flex justify-end">
            <Button onClick={() => setAdding(true)} disabled={store.groups.length >= MAX_GROUPS}>
              <Icon name="request" size={16} /> {s.add}
            </Button>
          </div>
        )}
        <p className="sr-only" role="status" aria-live="polite">
          {notice ?? ''}
        </p>
        {notice !== null && <p className="px-1 text-sm text-[var(--text-secondary)]">{notice}</p>}
        {store.groups.length === 0 ? (
          <EmptyState title={s.empty.title} body={s.empty.body} />
        ) : (
          <ul className="flex flex-col gap-4">
            {store.groups.map((group) => (
              <GroupCard key={group.id} group={group} account={account} onDelete={() => setDeleting(group)} />
            ))}
          </ul>
        )}
        <details className="disclosure px-1">
          <summary className="flex min-h-[var(--tap-target)] cursor-pointer items-center text-sm text-[var(--text-secondary)]">{s.howItWorksTitle}</summary>
          <p className="pb-2 text-sm text-[var(--text-secondary)]">{s.howItWorks}</p>
        </details>
      </div>
      <Sheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={s.deleteTitle}
        description={deleting === null ? '' : fill(s.deleteBody, { name: deleting.name })}
        closeLabel={s.cancel}
      >
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            block
            onClick={() => {
              if (deleting !== null) store.mutate((list) => list.filter((g) => g.id !== deleting.id));
              setDeleting(null);
            }}
          >
            {s.deleteConfirm}
          </Button>
          <Button variant="ghost" size="lg" block onClick={() => setDeleting(null)}>
            {s.cancel}
          </Button>
        </div>
      </Sheet>
    </>
  );
}

function GroupCard({ group, account, onDelete }: { readonly group: SplitGroup; readonly account: string | null; readonly onDelete: () => void }) {
  const t = useT();
  const s = t.tools.split;
  const { locale } = useLocale();
  const { signingBlock } = usePayments();
  const [statuses, setStatuses] = useState<Readonly<Record<string, ChildStatus>>>({});
  const [checkTick, setCheckTick] = useState(0);
  const children = group.participants.map((p) => (p.requestId === null ? 'not_created' : (statuses[p.id] ?? 'checking')));
  const aggregate = groupStatus(children);
  const mine = account === group.recipientAccountId;
  const tone = aggregate === 'settled_verified' ? 'success' : aggregate === 'needs_attention' ? 'danger' : 'neutral';
  return (
    <li className="surface-card flex flex-col gap-3 p-4" data-testid="split-group" data-group-status={aggregate}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{group.name}</p>
          <p className="text-sm text-[var(--text-secondary)]">
            {near(group.totalBaseUnits, locale)} · {s.mode[group.mode]} · {group.participants.length}
          </p>
          <p className="chain-id break-all text-xs text-[var(--text-muted)]">{fill(s.toYou, { account: group.recipientAccountId })}</p>
        </div>
      </div>
      <InlineNotice copy={s.group[aggregate]} tone={tone === 'success' ? 'neutral' : tone} />
      <p className="text-xs text-[var(--text-secondary)]" data-testid="split-verified-sum">
        {fill(s.verifiedOf, { verified: near(verifiedAmount(group, children), locale), total: near(group.totalBaseUnits, locale) })}
      </p>
      {mine && signingBlock !== null && group.participants.some((p) => p.requestId === null) && (
        <p className="rounded-[var(--radius-control)] border border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] p-2.5 text-xs text-[var(--tone-caution-fg)]" data-testid="split-signing-off">
          {s.signingOff}
        </p>
      )}
      {isLocked(group) && <p className="text-xs text-[var(--text-muted)]">{s.locked}</p>}
      <ol className="flex flex-col gap-2" data-testid="split-children">
        {group.participants.map((p, index) => (
          <ChildRow
            key={p.id}
            group={group}
            index={index}
            mine={mine}
            checkTick={checkTick}
            status={children[index] ?? 'unknown'}
            onStatus={(status) => setStatuses((prev) => (prev[p.id] === status ? prev : { ...prev, [p.id]: status }))}
          />
        ))}
      </ol>
      {!mine && account !== null && <p className="text-xs text-[var(--tone-caution-fg)]">{fill(s.otherAccount, { account: group.recipientAccountId })}</p>}
      <div className="flex flex-wrap gap-2">
        {group.participants.some((p) => p.requestId !== null) && (
          <Button variant="secondary" onClick={() => setCheckTick((n) => n + 1)}>
            <Icon name="refresh" size={16} /> {s.checkStatus}
          </Button>
        )}
        <Button variant="ghost" onClick={onDelete} aria-label={`${s.delete}: ${group.name}`}>
          {s.delete}
        </Button>
      </div>
    </li>
  );
}

function ChildRow({
  group,
  index,
  mine,
  checkTick,
  status,
  onStatus,
}: {
  readonly group: SplitGroup;
  readonly index: number;
  readonly mine: boolean;
  readonly checkTick: number;
  readonly status: ChildStatus;
  readonly onStatus: (status: ChildStatus) => void;
}) {
  const t = useT();
  const s = t.tools.split;
  const { locale } = useLocale();
  const { setup } = usePayments();
  const p = group.participants[index];
  const [request, setRequest] = useState<ContractRequest | null>(null);
  const [verifyRun, setVerifyRun] = useState(0);
  const requestId = p?.requestId ?? null;

  // One finalized chain read per share, on mount and on "Check status" (no polling).
  useEffect(() => {
    if (requestId === null || p === undefined || setup.status !== 'ready') return;
    let active = true;
    void setup.reader.readPaymentRequest(requestId).then((read) => {
      if (!active) return;
      const view = buildPaymentView({ read, expectedContractId: setup.contractId, accountId: group.recipientAccountId });
      if (view.kind === 'ok') {
        setRequest(view.request);
        onStatus(childStatusFromChain(group, p, view.request, view.observedAtNs, setup.contractId));
      } else {
        setRequest(null);
        onStatus(view.kind === 'inconsistent' || view.kind === 'wrong_contract' ? 'mismatch' : 'unknown');
      }
    });
    return () => {
      active = false;
    };
    // onStatus is stable enough (set-state wrapper); re-read on checkTick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, setup, checkTick]);

  if (p === undefined) return null;
  const paid = status === 'paid_per_contract' || status === 'verified';
  return (
    <li className="flex flex-col gap-1.5 rounded-[var(--radius-control)] border border-[var(--border-subtle)] p-3" data-testid="split-child" data-child-status={status}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{p.label}</p>
          <p className="chain-id break-all text-xs text-[var(--text-secondary)]">
            {p.accountId === null ? s.anyPayer : fill(s.onlyPayer, { account: p.accountId })}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold" title={exactNear(p.amountBaseUnits, locale)}>{near(p.amountBaseUnits, locale)}</p>
          <span className={`text-xs ${status === 'verified' ? 'text-[var(--taply-lime)]' : status === 'mismatch' || status === 'expired' || status === 'payout_failed' ? 'text-[var(--tone-danger-fg)]' : 'text-[var(--text-secondary)]'}`}>
            {status === 'checking' ? (
              <>
                <Spinner /> {s.child.checking}
              </>
            ) : (
              s.child[status]
            )}
          </span>
        </div>
      </div>
      {requestId === null && mine && (
        <ButtonLink
          href={buildPrefillLink({
            amountBaseUnits: p.amountBaseUnits,
            memo: childMemo(group, index),
            payer: p.accountId,
            source: { kind: 'split', id: group.id, key: p.id },
          })}
          variant="secondary"
        >
          {s.prepare}
        </ButtonLink>
      )}
      {requestId !== null && (
        <Link href={`/pay/${requestId}` as never} className="tap-target inline-flex items-center self-start text-xs font-medium underline underline-offset-4">
          {s.openRequest}
        </Link>
      )}
      {status === 'paid_per_contract' && request !== null && verifyRun === 0 && (
        <Button variant="secondary" onClick={() => setVerifyRun(1)}>
          {s.verify}
        </Button>
      )}
      {paid && request !== null && verifyRun > 0 && <ChildVerification request={request} onVerified={() => onStatus('verified')} />}
    </li>
  );
}

/** Runs the read-only funding locator and the independent receipt verifier for one share. */
function ChildVerification({ request, onVerified }: { readonly request: ContractRequest; readonly onVerified: () => void }) {
  const t = useT();
  const s = t.tools.split;
  const { setup, journal } = usePayments();
  const ready = setup.status === 'ready' ? setup : null;
  const entries = journal?.isReadable() ? journal.forRequest(request.terms.id) : [];
  const known = collectReferences(request, entries, { funding: null, retries: [] });
  const located = useFundingLocator({
    rpc: ready?.locatorRpc ?? null,
    fallbackRpc: ready?.locatorFallbackRpc ?? null,
    contractId: ready?.contractId ?? '',
    request,
    enabled: known.funding === null,
    generation: 0,
  });
  const candidate = located.kind === 'found' ? (located.candidates[0] ?? null) : null;
  const references = candidate === null ? known : collectReferences(request, entries, { funding: candidate, retries: [] });
  const view = useReceiptVerification({
    rpc: ready?.verifierRpc ?? null,
    fallbackRpc: ready?.verifierFallbackRpc ?? null,
    contractId: ready?.contractId ?? '',
    approvedCodeHash: ready?.expectedCodeHash ?? '',
    request,
    references,
    generation: 0,
  });
  const verified = view.kind === 'verified' && view.receipt.requestId === request.terms.id && view.receipt.termsHash === request.termsHash;
  useEffect(() => {
    if (verified) onVerified();
  }, [verified, onVerified]);
  if (verified) return <p className="text-xs text-[var(--text-secondary)]">{s.verifiedNote}</p>;
  if (view.kind === 'checking' || located.kind === 'searching') {
    return (
      <p className="flex items-center gap-2 text-xs text-[var(--text-secondary)]" role="status">
        <Spinner /> {s.verifying}
      </p>
    );
  }
  const reason = view.kind === 'failed' ? view.reason : located.kind;
  return (
    <p className="text-xs text-[var(--text-secondary)]" data-testid="split-verify-result">
      {t.payment.verification.failedTransient.title} · <span className="chain-id">{reason}</span>
    </p>
  );
}

function SplitForm({
  recipient,
  onSave,
  onCancel,
}: {
  readonly recipient: string;
  readonly onSave: (input: SplitInput) => ReadonlyArray<SplitProblem | 'save_failed'>;
  readonly onCancel: () => void;
}) {
  const t = useT();
  const s = t.tools.split;
  const { locale } = useLocale();
  const base = useId();
  const [name, setName] = useState('');
  const [total, setTotal] = useState('');
  const [memo, setMemo] = useState('');
  const [mode, setMode] = useState<'equal' | 'custom'>('equal');
  const [people, setPeople] = useState([
    { key: 1, label: '', account: '', share: '' },
    { key: 2, label: '', account: '', share: '' },
  ]);
  const [problems, setProblems] = useState<ReadonlyArray<SplitProblem | 'save_failed'>>([]);

  let totalUnits: bigint | null = null;
  try {
    totalUnits = total.trim() === '' ? null : BigInt(toBaseUnits(total.trim().replace(',', '.'), 24));
  } catch (error) {
    if (!(error instanceof InvalidAmountError)) throw error;
  }
  const preview = totalUnits !== null && totalUnits > 0n && mode === 'equal' ? equalShares(totalUnits, people.length) : null;
  let customSum: bigint | null = null;
  if (mode === 'custom') {
    try {
      customSum = people.reduce((sum, p) => sum + (p.share.trim() === '' ? 0n : BigInt(toBaseUnits(p.share.trim().replace(',', '.'), 24))), 0n);
    } catch (error) {
      if (!(error instanceof InvalidAmountError)) throw error;
      customSum = null;
    }
  }
  const diff = totalUnits !== null && customSum !== null ? totalUnits - customSum : null;
  const message = (p: SplitProblem | 'save_failed') => s.errors[p];

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setProblems(onSave({ name, total, memo, mode, people: people.map(({ label, account, share }) => ({ label, account, share })) }));
      }}
    >
      <p className="chain-id break-all text-sm text-[var(--text-secondary)]">{fill(s.toYou, { account: recipient })}</p>
      <TextField id={`${base}-name`} label={s.nameField} value={name} onChange={setName} />
      <TextField id={`${base}-total`} label={s.totalField} value={total} onChange={setTotal} inputMode="decimal" />
      <TextField id={`${base}-memo`} label={s.memoField} value={memo} onChange={setMemo} />
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">{s.modeField}</legend>
        <div className="flex gap-2">
          {(['equal', 'custom'] as const).map((m) => (
            <label key={m} className="tap-target flex flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-subtle)] px-3">
              <input type="radio" name={`${base}-mode`} checked={mode === m} onChange={() => setMode(m)} />
              {s.mode[m]}
            </label>
          ))}
        </div>
      </fieldset>
      <ol className="flex flex-col gap-3">
        {people.map((person, i) => (
          <li key={person.key} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-[var(--border-subtle)] p-3" data-testid="split-person">
            <TextField id={`${base}-p${person.key}-label`} label={`${s.personLabel} ${i + 1}`} value={person.label} onChange={(v) => setPeople((ps) => ps.map((x) => (x.key === person.key ? { ...x, label: v } : x)))} />
            <TextField
              id={`${base}-p${person.key}-account`}
              label={`${s.personAccount} ${i + 1}`}
              hint={s.personAccountHint}
              mono
              value={person.account}
              onChange={(v) => setPeople((ps) => ps.map((x) => (x.key === person.key ? { ...x, account: v } : x)))}
            />
            {mode === 'custom' ? (
              <TextField id={`${base}-p${person.key}-share`} label={`${s.personShare} ${i + 1}`} inputMode="decimal" value={person.share} onChange={(v) => setPeople((ps) => ps.map((x) => (x.key === person.key ? { ...x, share: v } : x)))} />
            ) : (
              preview !== null && (
                <p className="text-sm font-semibold" data-testid="split-equal-share" data-exact={exactNear(preview[i] ?? 0n, locale)}>
                  {near(preview[i] ?? 0n, locale)}
                </p>
              )
            )}
            {people.length > 2 && (
              <button
                type="button"
                className="tap-target self-start text-xs text-[var(--text-secondary)] underline underline-offset-4"
                onClick={() => setPeople((ps) => ps.filter((x) => x.key !== person.key))}
              >
                {fill(s.removePerson, { name: person.label || String(i + 1) })}
              </button>
            )}
          </li>
        ))}
      </ol>
      {people.length < MAX_PARTICIPANTS && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setPeople((ps) => [...ps, { key: Math.max(...ps.map((x) => x.key)) + 1, label: '', account: '', share: '' }])}
        >
          {s.addPerson}
        </Button>
      )}
      {preview !== null && preview.some((v) => formatBaseUnits(v.toString(), NEAR_NATIVE.decimals).truncated) && (
        <details className="disclosure" data-testid="split-exact">
          <summary className="flex min-h-[var(--tap-target)] cursor-pointer items-center text-sm text-[var(--text-secondary)]">{s.exactTitle}</summary>
          <ol className="flex flex-col gap-1 pb-2 text-xs">
            {preview.map((v, i) => (
              <li key={i} className="chain-id break-all">
                {people[i]?.label || i + 1}: {exactNear(v, locale)}
              </li>
            ))}
          </ol>
          <p className="pb-2 text-xs text-[var(--text-muted)]">{s.exactNote}</p>
        </details>
      )}
      {mode === 'custom' && diff !== null && (
        <p className={`text-sm ${diff === 0n ? 'text-[var(--text-secondary)]' : 'text-[var(--tone-caution-fg)]'}`} data-testid="split-sum" aria-live="polite">
          {diff === 0n ? s.sumOk : fill(s.sumOff, { diff: `${diff < 0n ? '-' : '+'}${formatBaseUnits((diff < 0n ? -diff : diff).toString(), NEAR_NATIVE.decimals, { locale }).display}` })}
        </p>
      )}
      {problems.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 text-sm text-[var(--tone-danger-fg)]" data-testid="split-problems">
          {problems.map((p) => (
            <li key={p}>{message(p)}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" size="lg" block>
          {s.save}
        </Button>
        <Button type="button" variant="ghost" size="lg" block onClick={onCancel}>
          {s.cancel}
        </Button>
      </div>
    </form>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  hint,
  inputMode,
  mono = false,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string;
  readonly inputMode?: 'decimal';
  readonly mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        autoCapitalize={mono ? 'none' : undefined}
        spellCheck={mono ? false : undefined}
        inputMode={inputMode}
        className={`taply-input ${mono ? 'chain-id' : ''}`}
      />
      {hint !== undefined && <p className="text-xs text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}
