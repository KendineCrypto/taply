import { describe, expect, it } from 'vitest';
import {
  CONTACTS_STORAGE_KEY,
  MAX_CONTACTS,
  accountSkeleton,
  addContact,
  checkContactAccount,
  contactForAccount,
  findSimilarContacts,
  loadContacts,
  normalizeLabel,
  removeContact,
  saveContacts,
  searchContacts,
  updateContact,
} from '../contacts';
import type { Contact } from '../contacts';

const NOW = new Date('2026-11-08T09:00:00.000Z');
let seq = 0;
const nextId = () => `contact-${String(++seq).padStart(4, '0')}`;

function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

function book(...entries: Array<[string, string]>): Contact[] {
  let list: Contact[] = [];
  for (const [label, accountId] of entries) {
    const r = addContact(list, { label, accountId, similarConfirmed: true }, NOW, nextId());
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    list = r.contacts;
  }
  return list;
}

describe('labels', () => {
  it('trims and collapses whitespace, keeps Unicode letters', () => {
    expect(normalizeLabel('  Ayşe   Kaya\t')).toEqual({ ok: true, label: 'Ayşe Kaya' });
  });

  it.each([
    ['right-to-left override', 'Bob\u202Etset'],
    ['zero-width space', 'Al\u200Bice'],
    ['zero-width joiner', 'Al\u200Dice'],
    ['BOM', '\uFEFFAlice'],
    ['bidi isolate', 'Alice\u2066x\u2069'],
    ['NUL', 'Ali\u0000ce'],
  ])('refuses hidden or reordering characters (%s)', (_name, label) => {
    expect(normalizeLabel(label)).toEqual({ ok: false, problem: 'hidden_characters' });
  });

  it('refuses empty and over-long labels', () => {
    expect(normalizeLabel('   ')).toEqual({ ok: false, problem: 'empty' });
    expect(normalizeLabel('x'.repeat(41))).toEqual({ ok: false, problem: 'too_long' });
    expect(normalizeLabel('ç'.repeat(40)).ok).toBe(true);
  });
});

describe('accounts', () => {
  it('accepts exact Testnet and implicit IDs without rewriting them', () => {
    expect(checkContactAccount(' taplytest.testnet ')).toEqual({ ok: true, accountId: 'taplytest.testnet' });
    expect(checkContactAccount('a'.repeat(64)).ok).toBe(true);
  });

  it('refuses invalid, uppercase and mainnet-looking IDs', () => {
    expect(checkContactAccount('')).toEqual({ ok: false, problem: 'empty' });
    expect(checkContactAccount('Alice.testnet')).toEqual({ ok: false, problem: 'invalid' });
    expect(checkContactAccount('alice..testnet')).toEqual({ ok: false, problem: 'invalid' });
    expect(checkContactAccount('alice.near')).toEqual({ ok: false, problem: 'mainnet' });
  });
});

describe('adding, editing and deleting', () => {
  it('adds a contact with exact fields', () => {
    const r = addContact([], { label: 'Shop', accountId: 'taplytest.testnet' }, NOW, 'contact-abc12345');
    expect(r).toMatchObject({
      ok: true,
      contact: { id: 'contact-abc12345', label: 'Shop', accountId: 'taplytest.testnet', createdAt: NOW.toISOString() },
    });
  });

  it('refuses a second contact for the same account and duplicate labels (case/width-insensitive)', () => {
    const list = book(['Alice', 'alice.testnet']);
    expect(addContact(list, { label: 'Other', accountId: 'alice.testnet' }, NOW, nextId())).toMatchObject({
      ok: false,
      error: { kind: 'duplicate_account' },
    });
    for (const label of ['alice', 'ALICE', ' Alice ', 'ａｌｉｃｅ']) {
      expect(addContact(list, { label, accountId: 'bob.testnet' }, NOW, nextId())).toMatchObject({
        ok: false,
        error: { kind: 'duplicate_label' },
      });
    }
  });

  it('T21: editing a contact changes only that contact; it cannot touch an already copied recipient', () => {
    const list = book(['Alice', 'alice.testnet']);
    const id = list[0]!.id;
    const draftRecipient = contactForAccount('alice.testnet', list)!.accountId; // what a form holds: a string
    const later = new Date('2026-11-09T09:00:00.000Z');
    const r = updateContact(list, id, { label: 'Alice', accountId: 'alice-new.testnet' }, later);
    expect(r.ok && r.contact).toMatchObject({ accountId: 'alice-new.testnet', createdAt: NOW.toISOString(), updatedAt: later.toISOString() });
    expect(draftRecipient).toBe('alice.testnet');
  });

  it('editing may keep its own label and account; deleting removes only the chosen one', () => {
    const list = book(['Alice', 'alice.testnet'], ['Bob', 'bob.testnet']);
    expect(updateContact(list, list[0]!.id, { label: 'Alice', accountId: 'alice.testnet' }, NOW).ok).toBe(true);
    expect(removeContact(list, list[0]!.id).map((c) => c.label)).toEqual(['Bob']);
    expect(updateContact(list, 'missing-id-0000', { label: 'X', accountId: 'x.testnet' }, NOW)).toMatchObject({ ok: false, error: { kind: 'not_found' } });
  });

  it('stops at the device limit', () => {
    let list: Contact[] = [];
    for (let i = 0; i < MAX_CONTACTS; i++) {
      const r = addContact(list, { label: `c${i}`, accountId: `user-${i}-zz.testnet`, similarConfirmed: true }, NOW, `contact-${i}-limit`);
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      list = r.contacts;
    }
    expect(addContact(list, { label: 'one more', accountId: 'more.testnet' }, NOW, nextId())).toMatchObject({ ok: false, error: { kind: 'limit' } });
  });
});

describe('lookalike and address-poisoning protection', () => {
  const list = book(['Shop', 'taplytest.testnet'], ['Store', 'merchant.testnet'], ['Wallet', `${'ab12'.repeat(4)}${'0'.repeat(48)}`]);

  it.each([
    ['digit one for l', 'tap1ytest.testnet', 'looks_alike'],
    ['capital-free i for l', 'tapiytest.testnet', 'looks_alike'],
    ['rn for m', 'rnerchant.testnet', 'looks_alike'],
    ['an unrelated account', 'zeynep.testnet', null],
    ['the exact saved account (same, not similar)', 'taplytest.testnet', null],
    ['one extra letter', 'taplyttest.testnet', 'one_character'],
    ['swapped letters', 'tapyltest.testnet', 'one_character'],
    ['same start and end of a long ID', `${'ab12'.repeat(4)}${'f'.repeat(42)}000000`, 'same_start_and_end'],
  ])('flags %s', (_name, candidate, reason) => {
    const similar = findSimilarContacts(candidate, list);
    if (reason === null) expect(similar).toEqual([]);
    else expect(similar[0]?.reason).toBe(reason);
  });

  it('needs an explicit confirmation to save a lookalike, then saves it', () => {
    expect(addContact(list, { label: 'Fake shop', accountId: 'tap1ytest.testnet' }, NOW, nextId())).toMatchObject({
      ok: false,
      error: { kind: 'similar_unconfirmed' },
    });
    expect(addContact(list, { label: 'Fake shop', accountId: 'tap1ytest.testnet', similarConfirmed: true }, NOW, nextId()).ok).toBe(true);
  });

  it('skeleton maps the usual confusions', () => {
    expect(accountSkeleton('rn0l1_i5')).toBe('moll-ls');
    expect(accountSkeleton('modern.testnet')).toBe(accountSkeleton('modem.testnet'));
  });
});

describe('search', () => {
  it('matches labels (case-insensitively) and account fragments, sorted by label', () => {
    const list = book(['zeynep', 'zeynep.testnet'], ['Ali', 'ali-kaya.testnet'], ['Coffee', 'coffee-shop.testnet']);
    expect(searchContacts(list, '').map((c) => c.label)).toEqual(['Ali', 'Coffee', 'zeynep']);
    expect(searchContacts(list, 'COF').map((c) => c.label)).toEqual(['Coffee']);
    expect(searchContacts(list, 'kaya').map((c) => c.label)).toEqual(['Ali']);
  });
});

describe('storage', () => {
  it('round-trips and survives reload', () => {
    const storage = memory();
    const list = book(['Alice', 'alice.testnet']);
    expect(saveContacts(storage, list)).toBe(true);
    expect(loadContacts(storage)).toEqual({ status: 'ok', contacts: list });
  });

  it('treats a missing key as an empty book and no storage as unavailable', () => {
    expect(loadContacts(memory())).toEqual({ status: 'ok', contacts: [] });
    expect(loadContacts(null)).toEqual({ status: 'unavailable' });
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => undefined, removeItem: () => undefined };
    expect(loadContacts(throwing)).toEqual({ status: 'unavailable' });
  });

  it.each([
    ['not JSON', '{'],
    ['wrong version', JSON.stringify({ version: 2, contacts: [] })],
    ['extra field', JSON.stringify({ version: 1, contacts: [], sync: true })],
    ['hidden label', JSON.stringify({ version: 1, contacts: [{ id: 'contact-0001', label: 'A\u202Eb', accountId: 'a.testnet', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }] })],
    ['invalid account', JSON.stringify({ version: 1, contacts: [{ id: 'contact-0001', label: 'A', accountId: 'A.testnet', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }] })],
    [
      'duplicate account',
      JSON.stringify({
        version: 1,
        contacts: [
          { id: 'contact-0001', label: 'A', accountId: 'a.testnet', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
          { id: 'contact-0002', label: 'B', accountId: 'a.testnet', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
        ],
      }),
    ],
  ])('reports tampered or unreadable data as corrupt (%s) and leaves it untouched', (_name, raw) => {
    const storage = memory();
    storage.setItem(CONTACTS_STORAGE_KEY, raw);
    expect(loadContacts(storage)).toEqual({ status: 'corrupt' });
    expect(storage.getItem(CONTACTS_STORAGE_KEY)).toBe(raw);
  });

  it('reports a failed write', () => {
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => undefined };
    expect(saveContacts(full, [])).toBe(false);
  });
});
