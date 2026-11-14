'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { fill } from '@/lib/i18n/fill';
import { useT } from '@/lib/i18n/provider';
import { checkContactAccount, findSimilarContacts, normalizeLabel } from '@/lib/contacts/contacts';
import type { Contact, ContactInput } from '@/lib/contacts/contacts';
import type { SaveResult } from '@/lib/contacts/use-contacts';

/**
 * Add / edit form. Validation runs as the person types; saving re-validates
 * against the stored list (another tab may have changed it).
 *
 * Two explicit confirmations exist and are never pre-ticked:
 *  - an account that looks like another saved contact's account;
 *  - changing the account of an existing contact (old -> new shown in full).
 */
export function ContactForm({
  contacts,
  editing,
  initialAccount = '',
  onSave,
  onCancel,
}: {
  readonly contacts: ReadonlyArray<Contact>;
  readonly editing: Contact | null;
  readonly initialAccount?: string;
  readonly onSave: (input: ContactInput) => SaveResult;
  readonly onCancel: () => void;
}) {
  const t = useT();
  const c = t.tools.contacts;
  const labelId = useId();
  const accountId = useId();
  const [label, setLabel] = useState(editing?.label ?? '');
  const [account, setAccount] = useState(editing?.accountId ?? initialAccount);
  const [similarOk, setSimilarOk] = useState(false);
  const [changeOk, setChangeOk] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const labelCheck = normalizeLabel(label);
  const accountCheck = checkContactAccount(account);
  const labelError = !touched && label === '' ? null : labelCheck.ok ? null : c.errors[`label_${labelCheck.problem}`];
  const accountError = !touched && account === '' ? null : accountCheck.ok ? null : c.errors[`account_${accountCheck.problem}`];
  const similar = accountCheck.ok ? findSimilarContacts(accountCheck.accountId, contacts, editing?.id) : [];
  const accountChanges = editing !== null && accountCheck.ok && accountCheck.accountId !== editing.accountId;
  const canSave = labelCheck.ok && accountCheck.ok && (similar.length === 0 || similarOk) && (!accountChanges || changeOk);

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      data-testid="contact-form"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!canSave) return;
        const result = onSave({ label, accountId: account, similarConfirmed: similarOk });
        if (result.ok) return;
        const error = result.error;
        setSaveError(
          error.kind === 'duplicate_account'
            ? fill(c.errors.duplicate_account, { label: error.existing.label })
            : error.kind === 'duplicate_label'
              ? fill(c.errors.duplicate_label, { account: error.existing.accountId })
              : error.kind === 'label'
                ? c.errors[`label_${error.problem}`]
                : error.kind === 'account'
                  ? c.errors[`account_${error.problem}`]
                  : error.kind === 'similar_unconfirmed'
                    ? c.similarTitle
                    : c.errors[error.kind],
        );
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={labelId} className="text-sm font-medium">
          {c.labelField}
        </label>
        <input
          id={labelId}
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setSaveError(null);
          }}
          onBlur={() => setTouched(true)}
          maxLength={80}
          autoComplete="off"
          className="taply-input"
          aria-describedby={`${labelId}-hint`}
          aria-invalid={labelError !== null || undefined}
        />
        <p id={`${labelId}-hint`} className={`text-xs ${labelError ? 'text-[var(--tone-danger-fg)]' : 'text-[var(--text-muted)]'}`} aria-live="polite">
          {labelError ?? c.labelHint}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={accountId} className="text-sm font-medium">
          {c.accountField}
        </label>
        <input
          id={accountId}
          value={account}
          onChange={(e) => {
            setAccount(e.target.value);
            setSimilarOk(false);
            setChangeOk(false);
            setSaveError(null);
          }}
          onBlur={() => setTouched(true)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="text"
          className="taply-input chain-id"
          aria-describedby={`${accountId}-hint`}
          aria-invalid={accountError !== null || undefined}
        />
        <p id={`${accountId}-hint`} className={`text-xs ${accountError ? 'text-[var(--tone-danger-fg)]' : 'text-[var(--text-muted)]'}`} aria-live="polite">
          {accountError ?? c.accountHint}
        </p>
      </div>

      {similar.length > 0 && (
        <div
          role="alert"
          data-testid="contact-similar"
          className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] p-3 text-sm text-[var(--tone-caution-fg)]"
        >
          <p className="font-semibold">{c.similarTitle}</p>
          {similar.map(({ contact, reason }) => (
            <p key={contact.id}>
              {fill(c.similarBody, { label: contact.label, account: contact.accountId })} {c.similarReason[reason]}
            </p>
          ))}
          <label className="tap-target flex items-center gap-2 font-medium">
            <input type="checkbox" checked={similarOk} onChange={(e) => setSimilarOk(e.target.checked)} className="size-5" />
            {c.similarConfirm}
          </label>
        </div>
      )}

      {accountChanges && editing !== null && accountCheck.ok && (
        <div
          role="alert"
          data-testid="contact-account-change"
          className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] p-3 text-sm text-[var(--tone-caution-fg)]"
        >
          <p className="break-all">{fill(c.accountChanged, { old: editing.accountId, new: accountCheck.accountId })}</p>
          <label className="tap-target flex items-center gap-2 font-medium">
            <input type="checkbox" checked={changeOk} onChange={(e) => setChangeOk(e.target.checked)} className="size-5" />
            {c.accountChangedConfirm}
          </label>
        </div>
      )}

      {saveError !== null && (
        <p role="alert" className="text-sm text-[var(--tone-danger-fg)]">
          {saveError}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" size="lg" block disabled={touched && !canSave}>
          {c.save}
        </Button>
        <Button type="button" variant="ghost" size="lg" block onClick={onCancel}>
          {c.cancel}
        </Button>
      </div>
    </form>
  );
}
