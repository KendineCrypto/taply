import { z } from 'zod';
import { classifyAccountId } from '@/lib/near/account';

/**
 * Taply Contacts (E1): a local-first address book on this device.
 *
 * Rules (PRODUCT.md "Contacts", TEST_PLAN T21, SECURITY.md):
 *  - Stored only in this browser's localStorage. No cloud sync, no server, no keys.
 *  - A contact is a label for an exact NEAR Testnet account ID. Choosing one
 *    copies the account ID string into the form; drafts never hold a reference
 *    to the contact, so editing a contact later cannot change a prepared
 *    recipient. The full account ID is always shown before any signature.
 *  - Labels are display-only and never identify anyone. Invisible and
 *    direction-changing characters are refused, so a label cannot hide or
 *    reorder text on screen.
 *  - Address-poisoning defence: an account that looks like a saved one
 *    (same "skeleton", one edit away, or same start and end of a long ID) is
 *    flagged and needs an explicit "I checked every character" to save.
 */

export const CONTACTS_STORAGE_KEY = 'taply.contacts.v1';
export const MAX_CONTACTS = 200;
export const MAX_LABEL_LENGTH = 40;

export interface Contact {
  readonly id: string;
  readonly label: string;
  readonly accountId: string;
  /** ISO 8601 (device clock, display only). */
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type LabelProblem = 'empty' | 'too_long' | 'hidden_characters';
export type AccountProblem = 'empty' | 'invalid' | 'mainnet';

// Control (Cc), format (Cf: bidi overrides/isolates, zero-width, BOM), line (Zl) and paragraph (Zp) separators.
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function normalizeLabel(raw: string): { ok: true; label: string } | { ok: false; problem: LabelProblem } {
  // Ordinary line breaks and tabs are just whitespace; everything else hidden is refused.
  const spaced = raw.replace(/[\t\n\r]+/g, ' ');
  if (HIDDEN.test(spaced)) return { ok: false, problem: 'hidden_characters' };
  const label = spaced.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (label === '') return { ok: false, problem: 'empty' };
  if ([...label].length > MAX_LABEL_LENGTH) return { ok: false, problem: 'too_long' };
  return { ok: true, label };
}

/** Exact account check. NEAR IDs are lowercase; nothing is rewritten for the person. */
export function checkContactAccount(raw: string): { ok: true; accountId: string } | { ok: false; problem: AccountProblem } {
  const accountId = raw.trim();
  if (accountId === '') return { ok: false, problem: 'empty' };
  const hint = classifyAccountId(accountId);
  if (hint === 'invalid') return { ok: false, problem: 'invalid' };
  if (hint === 'likely_mainnet') return { ok: false, problem: 'mainnet' };
  return { ok: true, accountId };
}

/** Case- and width-insensitive label identity, so "Alice" and "ａｌｉｃｅ" cannot both exist. */
export function labelKey(label: string): string {
  return label.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
}

/** Characters people confuse at a glance in an account ID. */
export function accountSkeleton(accountId: string): string {
  return accountId
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/cl/g, 'd')
    .replace(/[0]/g, 'o')
    .replace(/[1il|]/g, 'l')
    .replace(/[5]/g, 's')
    .replace(/[_]/g, '-');
}

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const restA = a.length - i - j;
  const restB = b.length - i - j;
  if (restA <= 1 && restB <= 1) return true;
  // One adjacent transposition.
  return restA === 2 && restB === 2 && a[i] === b[i + 1] && a[i + 1] === b[i];
}

export type SimilarReason = 'looks_alike' | 'one_character' | 'same_start_and_end';

export interface SimilarContact {
  readonly contact: Contact;
  readonly reason: SimilarReason;
}

/**
 * Saved contacts whose account ID is different from `accountId` but easy to
 * mistake for it. Exact matches are not "similar" (they are the same account).
 */
export function findSimilarContacts(accountId: string, contacts: ReadonlyArray<Contact>, ignoreId?: string): SimilarContact[] {
  const out: SimilarContact[] = [];
  const skeleton = accountSkeleton(accountId);
  for (const contact of contacts) {
    if (contact.id === ignoreId || contact.accountId === accountId) continue;
    const other = contact.accountId;
    if (accountSkeleton(other) === skeleton) out.push({ contact, reason: 'looks_alike' });
    else if (accountId.length >= 6 && other.length >= 6 && withinOneEdit(accountId, other)) out.push({ contact, reason: 'one_character' });
    else if (accountId.length >= 16 && other.length >= 16 && accountId.slice(0, 6) === other.slice(0, 6) && accountId.slice(-6) === other.slice(-6)) {
      out.push({ contact, reason: 'same_start_and_end' });
    }
  }
  return out;
}

export function contactForAccount(accountId: string, contacts: ReadonlyArray<Contact>): Contact | null {
  return contacts.find((c) => c.accountId === accountId) ?? null;
}

export type ContactError =
  | { readonly kind: 'label'; readonly problem: LabelProblem }
  | { readonly kind: 'account'; readonly problem: AccountProblem }
  | { readonly kind: 'duplicate_account'; readonly existing: Contact }
  | { readonly kind: 'duplicate_label'; readonly existing: Contact }
  | { readonly kind: 'similar_unconfirmed'; readonly similar: ReadonlyArray<SimilarContact> }
  | { readonly kind: 'limit' }
  | { readonly kind: 'not_found' };

export interface ContactInput {
  readonly label: string;
  readonly accountId: string;
  /** The person confirmed every character of an account that looks like a saved one. */
  readonly similarConfirmed?: boolean;
}

type Result = { readonly ok: true; readonly contacts: Contact[]; readonly contact: Contact } | { readonly ok: false; readonly error: ContactError };

function validate(contacts: ReadonlyArray<Contact>, input: ContactInput, selfId?: string) {
  const label = normalizeLabel(input.label);
  if (!label.ok) return { ok: false as const, error: { kind: 'label', problem: label.problem } as ContactError };
  const account = checkContactAccount(input.accountId);
  if (!account.ok) return { ok: false as const, error: { kind: 'account', problem: account.problem } as ContactError };
  const sameAccount = contacts.find((c) => c.id !== selfId && c.accountId === account.accountId);
  if (sameAccount !== undefined) return { ok: false as const, error: { kind: 'duplicate_account', existing: sameAccount } as ContactError };
  const key = labelKey(label.label);
  const sameLabel = contacts.find((c) => c.id !== selfId && labelKey(c.label) === key);
  if (sameLabel !== undefined) return { ok: false as const, error: { kind: 'duplicate_label', existing: sameLabel } as ContactError };
  const similar = findSimilarContacts(account.accountId, contacts, selfId);
  if (similar.length > 0 && input.similarConfirmed !== true) {
    return { ok: false as const, error: { kind: 'similar_unconfirmed', similar } as ContactError };
  }
  return { ok: true as const, label: label.label, accountId: account.accountId };
}

export function addContact(contacts: ReadonlyArray<Contact>, input: ContactInput, now: Date, id: string): Result {
  if (contacts.length >= MAX_CONTACTS) return { ok: false, error: { kind: 'limit' } };
  const checked = validate(contacts, input);
  if (!checked.ok) return checked;
  const at = now.toISOString();
  const contact: Contact = { id, label: checked.label, accountId: checked.accountId, createdAt: at, updatedAt: at };
  return { ok: true, contacts: [...contacts, contact], contact };
}

export function updateContact(contacts: ReadonlyArray<Contact>, id: string, input: ContactInput, now: Date): Result {
  const current = contacts.find((c) => c.id === id);
  if (current === undefined) return { ok: false, error: { kind: 'not_found' } };
  const checked = validate(contacts, input, id);
  if (!checked.ok) return checked;
  const contact: Contact = { ...current, label: checked.label, accountId: checked.accountId, updatedAt: now.toISOString() };
  return { ok: true, contacts: contacts.map((c) => (c.id === id ? contact : c)), contact };
}

export function removeContact(contacts: ReadonlyArray<Contact>, id: string): Contact[] {
  return contacts.filter((c) => c.id !== id);
}

/** Search by label or account substring, case-insensitive. Sorted by label. */
export function searchContacts(contacts: ReadonlyArray<Contact>, query: string): Contact[] {
  const q = labelKey(query);
  const list = q === '' ? [...contacts] : contacts.filter((c) => labelKey(c.label).includes(q) || c.accountId.includes(q));
  return list.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) || a.accountId.localeCompare(b.accountId));
}

// ---------------------------------------------------------------------------
// Storage: strict, versioned, never silently overwritten when unreadable.

const ContactSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  label: z.string().min(1).max(MAX_LABEL_LENGTH * 4),
  accountId: z.string().min(2).max(64),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const EnvelopeSchema = z.strictObject({ version: z.literal(1), contacts: z.array(ContactSchema).max(MAX_CONTACTS) });

export type ContactStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type LoadedContacts =
  | { readonly status: 'ok'; readonly contacts: Contact[] }
  | { readonly status: 'unavailable' }
  /** Stored data is not a valid contact list. It is kept untouched until the person resets it. */
  | { readonly status: 'corrupt' };

export function loadContacts(storage: ContactStorage | null): LoadedContacts {
  if (storage === null) return { status: 'unavailable' };
  let raw: string | null;
  try {
    raw = storage.getItem(CONTACTS_STORAGE_KEY);
  } catch {
    return { status: 'unavailable' };
  }
  if (raw === null) return { status: 'ok', contacts: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'corrupt' };
  }
  const envelope = EnvelopeSchema.safeParse(parsed);
  if (!envelope.success) return { status: 'corrupt' };
  const contacts = envelope.data.contacts;
  // Every stored entry must still pass today's rules, and IDs/accounts must be unique.
  for (const c of contacts) {
    const label = normalizeLabel(c.label);
    if (!label.ok || label.label !== c.label || !checkContactAccount(c.accountId).ok) return { status: 'corrupt' };
  }
  if (new Set(contacts.map((c) => c.id)).size !== contacts.length) return { status: 'corrupt' };
  if (new Set(contacts.map((c) => c.accountId)).size !== contacts.length) return { status: 'corrupt' };
  return { status: 'ok', contacts };
}

export function saveContacts(storage: ContactStorage | null, contacts: ReadonlyArray<Contact>): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify({ version: 1, contacts }));
    return true;
  } catch {
    return false;
  }
}

export function resetContacts(storage: ContactStorage | null): boolean {
  if (storage === null) return false;
  try {
    storage.removeItem(CONTACTS_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function newContactId(): string {
  return crypto.randomUUID();
}
