'use client';

import { useId, useState } from 'react';
import { prepareCreateProtectedRequest } from '@taply/near-client';
import type { ProtectedReader } from '@taply/near-client';
import { Button, ButtonLink, Spinner } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Surface';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Icon } from '@/components/shell/Icons';
import { ConnectWalletButton } from '@/components/wallet/WalletConnect';
import { SubmitResultNotice } from '@/components/payments/PaymentParts';
import { useT } from '@/lib/i18n/provider';
import { usePayments } from '@/lib/payments/context';
import { newCreationNonce, validateRequestForm } from '@/lib/payments/create';
import type { RequestFormError } from '@/lib/payments/create';
import { submitCall } from '@/lib/payments/submit';
import type { SubmitResult } from '@/lib/payments/submit';
import { CANCEL_WINDOWS, buildProtectedTerms } from '@/lib/protected/create';
import type { CancelWindow } from '@/lib/protected/create';
import { PROTECTED_SETUP, defaultProtectedReader, useProtectedContract } from '@/lib/protected/hooks';
import type { ProtectedSetup } from '@/lib/protected/setup';
import { useWallet } from '@/lib/wallet/provider';
import { ContactMatch, ContactPicker } from '@/components/contacts/ContactPicker';
import { FLAGS } from '@/lib/flags/features';
import { useContactBook } from '@/lib/contacts/use-contacts';
import { ProtectedSetupNotice, windowLabel } from './ProtectedScreen';

/**
 * `/protected/new`: the recipient signs one immutable Protected request with
 * its cancellation window. Chain time (a fresh final block from the config
 * check) anchors the funding deadline; the creation nonce is journaled with the
 * terms before the wallet opens.
 */
export function ProtectedCreate({
  setup = PROTECTED_SETUP,
  reader,
}: {
  readonly setup?: ProtectedSetup;
  readonly reader?: ProtectedReader | null;
}) {
  if (setup.status !== 'ready') return <ProtectedSetupNotice setup={setup} />;
  return <CreateLive setup={setup} reader={reader === undefined ? defaultProtectedReader(setup) : reader} />;
}

type Ready = Extract<ProtectedSetup, { status: 'ready' }>;

function CreateLive({ setup, reader }: { readonly setup: Ready; readonly reader: ProtectedReader | null }) {
  const t = useT();
  const c = t.protectedFlow;
  const ids = { amount: useId(), window: useId(), payer: useId() };
  const { journal } = usePayments();
  const { state: wallet, signAndSend } = useWallet();
  const accountId = wallet.status === 'connected' ? wallet.session.accountId : null;
  const { check, ensureFresh } = useProtectedContract(setup, reader);
  const [amount, setAmount] = useState('');
  const [cancelWindow, setCancelWindow] = useState<CancelWindow>('60s');
  const [payer, setPayer] = useState('');
  const [errors, setErrors] = useState<ReadonlyArray<RequestFormError>>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'stale' | 'quote' | 'refused' | null>(null);
  const [created, setCreated] = useState<{ readonly id: string; readonly result: SubmitResult } | null>(null);
  const gate = check.status === 'verified' ? check.gate : null;
  // Local address book: choosing copies the exact account ID; nothing is trusted by name.
  const contactsOn = FLAGS.contacts.enabled;
  const book = useContactBook();
  const contacts = contactsOn ? book.contacts : [];

  const submit = async () => {
    if (accountId === null || busy || reader === null) return;
    setProblem(null);
    const form = validateRequestForm({ amount, memo: '', payer }, accountId);
    if (!form.ok) {
      setErrors(form.errors);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      const fresh = await ensureFresh();
      if (fresh === null || !fresh.gate.allowed) {
        setProblem('stale');
        return;
      }
      const { terms, termsHash } = buildProtectedTerms({
        contractId: setup.contractId,
        creatorAccountId: accountId,
        creationNonce: newCreationNonce(),
        form: form.value,
        chainNowNs: fresh.observedAtNs,
        window: cancelWindow,
      });
      const quote = await reader.client.quoteCreateRequest(terms);
      if (quote.error !== null || quote.observation.data === null) {
        setProblem('quote');
        return;
      }
      let call;
      try {
        call = prepareCreateProtectedRequest({
          contractId: setup.contractId,
          config: fresh.config,
          terms,
          quote: quote.observation.data,
          signerAccountId: accountId,
        });
      } catch {
        setProblem('refused');
        return;
      }
      const result = await submitCall({ journal, call, signerAccountId: accountId, requestId: terms.id, termsHash, terms, signAndSend });
      setCreated({ id: terms.id, result });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">{c.intro}</p>
      {gate !== null && gate.allowed && gate.unreviewed && <InlineNotice copy={c.unreviewed} />}
      {check.status === 'checking' && <p className="px-1 text-xs text-[var(--text-muted)]">{c.contractChecking}</p>}
      {(check.status === 'unreachable' || (gate !== null && !gate.allowed)) && <InlineNotice copy={c.contractBlocked} tone="neutral" />}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.amount} className="text-sm font-medium">{c.create.amountLabel}</label>
          <input
            id={ids.amount}
            className="taply-input"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-describedby={`${ids.amount}-hint`}
          />
          <p id={`${ids.amount}-hint`} className="text-xs text-[var(--text-muted)]">{c.create.amountHint}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.window} className="text-sm font-medium">{c.create.windowLabel}</label>
          <select id={ids.window} className="taply-input" value={cancelWindow} onChange={(e) => setCancelWindow(e.target.value as CancelWindow)}>
            {(Object.keys(CANCEL_WINDOWS) as CancelWindow[]).map((key) => (
              <option key={key} value={key}>
                {windowLabel(CANCEL_WINDOWS[key].toString(), c.duration)}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--text-muted)]">{c.create.windowHint}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.payer} className="text-sm font-medium">{c.create.payerLabel}</label>
          <input
            id={ids.payer}
            className="taply-input chain-id"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            value={payer}
            onChange={(e) => setPayer(e.target.value)}
          />
          <p className="text-xs text-[var(--text-muted)]">{c.create.payerHint}</p>
          {contactsOn && <ContactPicker contacts={contacts} onPick={setPayer} />}
          {contactsOn && <ContactMatch accountId={payer} contacts={contacts} />}
        </div>
        {errors.length > 0 && (
          <ul role="alert" className="flex flex-col gap-1 text-sm text-[var(--tone-danger-fg)]">
            {errors.map((e) => (
              <li key={e}>{c.create.errors[e]}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-[var(--text-muted)]">{c.create.storageNote}</p>
        {accountId === null ? (
          <ConnectWalletButton />
        ) : (
          <Button size="lg" block disabled={busy || gate === null || !gate.allowed} onClick={() => void submit()}>
            {busy ? <Spinner /> : <Icon name="shield" size={18} />} {c.create.createAction}
          </Button>
        )}
      </Card>
      {problem === 'stale' && <InlineNotice copy={c.staleReview} />}
      {problem === 'quote' && <InlineNotice copy={c.create.quoteFailed} />}
      {problem === 'refused' && <InlineNotice copy={c.refused} />}
      {created !== null && (
        <>
          <SubmitResultNotice result={created.result} />
          <InlineNotice
            copy={{ title: c.newTitle, body: c.create.created }}
            tone="neutral"
            action={<ButtonLink href={`/protected/${created.id}`}>{c.create.openRequest}</ButtonLink>}
          />
        </>
      )}
    </div>
  );
}
