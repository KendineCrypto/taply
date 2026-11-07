'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CONTACTS_STORAGE_KEY,
  addContact,
  loadContacts,
  newContactId,
  removeContact,
  resetContacts,
  saveContacts,
  updateContact,
} from './contacts';
import type { Contact, ContactError, ContactInput, ContactStorage, LoadedContacts } from './contacts';

/** Same-tab change signal (the `storage` event only fires in other tabs). */
const CHANGED_EVENT = 'taply-contacts-changed';

function browserStorage(): ContactStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export type SaveResult =
  | { readonly ok: true; readonly contact: Contact }
  | { readonly ok: false; readonly error: ContactError | { readonly kind: 'save_failed' } | { readonly kind: 'unreadable' } };

export interface ContactBook {
  /** null until the first client-side read (server render shows nothing). */
  readonly state: LoadedContacts | null;
  readonly contacts: ReadonlyArray<Contact>;
  add(input: ContactInput): SaveResult;
  update(id: string, input: ContactInput): SaveResult;
  remove(id: string): boolean;
  /** Clears an unreadable list after an explicit confirmation. */
  reset(): boolean;
}

/**
 * The device's contact book, re-read on every change from this tab or another.
 * Writes are refused while the stored list is unreadable, so nothing is lost
 * by accident; the screen offers an explicit reset instead.
 */
export function useContactBook(options: { readonly storage?: ContactStorage | null; readonly now?: () => Date } = {}): ContactBook {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const now = options.now ?? (() => new Date());
  const [state, setState] = useState<LoadedContacts | null>(null);

  useEffect(() => {
    const reload = () => setState(loadContacts(storage));
    reload();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === CONTACTS_STORAGE_KEY) reload();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGED_EVENT, reload);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGED_EVENT, reload);
    };
  }, [storage]);

  const commit = useCallback(
    (next: Contact[]) => {
      if (!saveContacts(storage, next)) return false;
      setState({ status: 'ok', contacts: next });
      window.dispatchEvent(new Event(CHANGED_EVENT));
      return true;
    },
    [storage],
  );

  // Always act on the stored list, not a possibly stale render.
  const current = (): Contact[] | null => {
    const fresh = loadContacts(storage);
    return fresh.status === 'ok' ? fresh.contacts : null;
  };

  return {
    state,
    contacts: state?.status === 'ok' ? state.contacts : [],
    add(input) {
      const list = current();
      if (list === null) return { ok: false, error: { kind: 'unreadable' } };
      const result = addContact(list, input, now(), newContactId());
      if (!result.ok) return result;
      return commit(result.contacts) ? { ok: true, contact: result.contact } : { ok: false, error: { kind: 'save_failed' } };
    },
    update(id, input) {
      const list = current();
      if (list === null) return { ok: false, error: { kind: 'unreadable' } };
      const result = updateContact(list, id, input, now());
      if (!result.ok) return result;
      return commit(result.contacts) ? { ok: true, contact: result.contact } : { ok: false, error: { kind: 'save_failed' } };
    },
    remove(id) {
      const list = current();
      return list !== null && commit(removeContact(list, id));
    },
    reset() {
      if (!resetContacts(storage)) return false;
      setState({ status: 'ok', contacts: [] });
      window.dispatchEvent(new Event(CHANGED_EVENT));
      return true;
    },
  };
}
