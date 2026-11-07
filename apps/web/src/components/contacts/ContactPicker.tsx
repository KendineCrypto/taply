'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { Sheet } from '@/components/shell/Sheet';
import { fill } from '@/lib/i18n';
import { useT } from '@/lib/i18n/provider';
import { contactForAccount, findSimilarContacts, searchContacts } from '@/lib/contacts/contacts';
import type { Contact } from '@/lib/contacts/contacts';

/**
 * "Choose from contacts" for a recipient field. Choosing copies the exact
 * account ID string into the form (the form never keeps a contact reference).
 */
export function ContactPicker({
  contacts,
  onPick,
}: {
  readonly contacts: ReadonlyArray<Contact>;
  readonly onPick: (accountId: string) => void;
}) {
  const t = useT();
  const c = t.tools.contacts;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchId = useId();
  const visible = searchContacts(contacts, query);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tap-target inline-flex items-center gap-1.5 self-start text-sm font-medium text-[var(--text-secondary)] underline underline-offset-4"
        data-testid="contact-picker-open"
      >
        <Icon name="wallet" size={16} /> {c.pickerOpen}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={c.pickerTitle} description={c.pickerDescription} closeLabel={c.cancel}>
        {contacts.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--text-secondary)]">{c.pickerEmpty}</p>
            <Link href="/contacts" className="tap-target inline-flex items-center text-sm font-medium underline underline-offset-4">
              {c.manage}
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label htmlFor={searchId} className="sr-only">
              {c.searchLabel}
            </label>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={c.searchPlaceholder}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="taply-input"
            />
            <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto" data-testid="contact-picker-list">
              {visible.map((contact) => (
                <li key={contact.id}>
                  <button
                    type="button"
                    className="tap-target flex w-full flex-col items-start gap-0.5 rounded-[var(--radius-control)] border border-[var(--border-subtle)] px-3 py-2.5 text-left hover:bg-[var(--surface-2)]"
                    onClick={() => {
                      onPick(contact.accountId);
                      setOpen(false);
                    }}
                  >
                    <span className="font-semibold">{contact.label}</span>
                    <span className="chain-id break-all text-sm text-[var(--text-secondary)]">{contact.accountId}</span>
                  </button>
                </li>
              ))}
            </ul>
            {visible.length === 0 && <p className="text-sm text-[var(--text-secondary)]">{c.noMatches}</p>}
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {c.cancel}
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
}

/**
 * What the recipient field matches in the contact book: the exact saved
 * contact, or a saved contact it only resembles (possible address poisoning).
 */
export function ContactMatch({ accountId, contacts }: { readonly accountId: string; readonly contacts: ReadonlyArray<Contact> }) {
  const t = useT();
  const c = t.tools.contacts;
  const id = accountId.trim();
  if (id === '') return null;
  const exact = contactForAccount(id, contacts);
  if (exact !== null) {
    return (
      <p className="text-xs text-[var(--text-secondary)]" data-testid="contact-match">
        {fill(c.fromContact, { label: exact.label })}
      </p>
    );
  }
  const similar = findSimilarContacts(id, contacts);
  if (similar.length === 0) return null;
  return (
    <div role="alert" className="flex flex-col gap-1 text-xs text-[var(--tone-danger-fg)]" data-testid="contact-lookalike">
      {similar.map(({ contact, reason }) => (
        <p key={contact.id}>
          {fill(c.notThisContact, { label: contact.label, account: contact.accountId })} {c.similarReason[reason]}
        </p>
      ))}
    </div>
  );
}
