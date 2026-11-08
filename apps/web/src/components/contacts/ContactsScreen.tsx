'use client';

import { useId, useState } from 'react';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Button } from '@/components/primitives/Button';
import { Card, EmptyState, ScreenHeader } from '@/components/primitives/Surface';
import { Icon } from '@/components/shell/Icons';
import { Sheet } from '@/components/shell/Sheet';
import { fill } from '@/lib/i18n';
import { useT } from '@/lib/i18n/provider';
import { MAX_CONTACTS, checkContactAccount, searchContacts } from '@/lib/contacts/contacts';
import type { Contact } from '@/lib/contacts/contacts';
import { useContactBook } from '@/lib/contacts/use-contacts';
import type { ContactStorage } from '@/lib/contacts/contacts';
import { ContactForm } from './ContactForm';

type Mode = { readonly kind: 'list' } | { readonly kind: 'add'; readonly account: string } | { readonly kind: 'edit'; readonly contact: Contact };

/** `/contacts` (UX_FLOWS screen 19). Local-first; nothing leaves this device. */
export function ContactsScreen({ storage }: { readonly storage?: ContactStorage | null }) {
  const t = useT();
  const c = t.tools.contacts;
  const book = useContactBook(storage === undefined ? {} : { storage });
  const searchId = useId();
  const [query, setQuery] = useState('');
  // `/contacts?account=<id>` pre-fills a new contact (never saves by itself). Read once on
  // the client; the first render shows only the header until storage is read, so SSR matches.
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === 'undefined') return { kind: 'list' };
    const account = new URLSearchParams(window.location.search).get('account');
    return account !== null && checkContactAccount(account).ok ? { kind: 'add', account } : { kind: 'list' };
  });
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const header = <ScreenHeader title={c.title} description={c.description} />;
  const state = book.state;
  if (state === null) return header;
  if (state.status === 'unavailable') {
    return (
      <>
        {header}
        <InlineNotice copy={c.unavailable} tone="caution" />
      </>
    );
  }
  if (state.status === 'corrupt') {
    return (
      <>
        {header}
        <InlineNotice
          copy={c.corrupt}
          tone="danger"
          action={
            <Button variant="secondary" onClick={() => setResetting(true)}>
              {c.resetAll}
            </Button>
          }
        />
        <Sheet open={resetting} onClose={() => setResetting(false)} title={c.resetTitle} description={c.resetBody} closeLabel={c.cancel}>
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              block
              onClick={() => {
                book.reset();
                setResetting(false);
              }}
            >
              {c.resetConfirm}
            </Button>
            <Button variant="ghost" size="lg" block onClick={() => setResetting(false)}>
              {c.cancel}
            </Button>
          </div>
        </Sheet>
      </>
    );
  }

  if (mode.kind !== 'list') {
    const editing = mode.kind === 'edit' ? mode.contact : null;
    return (
      <>
        <ScreenHeader title={editing === null ? c.addTitle : c.editTitle} />
        <Card className="p-5">
          <ContactForm
            key={editing?.id ?? `new:${mode.kind === 'add' ? mode.account : ''}`}
            contacts={book.contacts}
            editing={editing}
            initialAccount={mode.kind === 'add' ? mode.account : ''}
            onCancel={() => setMode({ kind: 'list' })}
            onSave={(input) => {
              const result = editing === null ? book.add(input) : book.update(editing.id, input);
              if (result.ok) {
                setMode({ kind: 'list' });
                setNotice(c.saved);
              }
              return result;
            }}
          />
        </Card>
      </>
    );
  }

  const visible = searchContacts(book.contacts, query);
  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full border border-[var(--border-subtle)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
            {c.localOnly} · {fill(c.count, { n: String(book.contacts.length), max: String(MAX_CONTACTS) })}
          </span>
          <Button onClick={() => setMode({ kind: 'add', account: '' })} disabled={book.contacts.length >= MAX_CONTACTS}>
            <Icon name="request" size={16} /> {c.add}
          </Button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {notice ?? ''}
        </p>
        {notice !== null && <p className="px-1 text-sm text-[var(--text-secondary)]">{notice}</p>}

        {book.contacts.length === 0 ? (
          <EmptyState title={c.empty.title} body={c.empty.body} />
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={searchId} className="text-sm font-medium">
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
            </div>
            {visible.length === 0 ? (
              <p className="px-1 text-sm text-[var(--text-secondary)]">{c.noMatches}</p>
            ) : (
              <ul className="flex flex-col gap-2" aria-label={c.title} data-testid="contact-list">
                {visible.map((contact) => (
                  <li key={contact.id} className="surface-card flex flex-col gap-2 p-4" data-testid="contact-row">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold">{contact.label}</span>
                      <span className="chain-id break-all text-sm text-[var(--text-secondary)]">{contact.accountId}</span>
                      {contact.updatedAt !== contact.createdAt && (
                        <span className="text-xs text-[var(--text-muted)]">
                          {fill(c.updatedOn, { date: contact.updatedAt.slice(0, 10) })}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => setMode({ kind: 'edit', contact })} aria-label={`${c.edit}: ${contact.label}`}>
                        {c.edit}
                      </Button>
                      <Button variant="ghost" onClick={() => setDeleting(contact)} aria-label={`${c.delete}: ${contact.label}`}>
                        {c.delete}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <Sheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={c.deleteTitle}
        description={deleting === null ? '' : fill(c.deleteBody, { label: deleting.label, account: deleting.accountId })}
        closeLabel={c.cancel}
      >
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            block
            onClick={() => {
              if (deleting !== null && book.remove(deleting.id)) setNotice(c.deleted);
              setDeleting(null);
            }}
          >
            {c.deleteConfirm}
          </Button>
          <Button variant="ghost" size="lg" block onClick={() => setDeleting(null)}>
            {c.cancel}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
