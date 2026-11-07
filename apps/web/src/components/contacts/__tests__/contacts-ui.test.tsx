import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NearTestnetClient } from '@taply/near-client';
import { ContactsScreen } from '../ContactsScreen';
import { SendFlow } from '@/components/send/SendFlow';
import { I18nProvider } from '@/lib/i18n/provider';
import { CONTACTS_STORAGE_KEY } from '@/lib/contacts/contacts';
import { installChain, readySetup, recordingWallet, renderWithChain } from '@/test/chain';

/** E1 Contacts: real localStorage (jsdom), real components. No chain, nothing signed. */

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

function renderContacts(locale: 'en' | 'tr' = 'en') {
  return render(
    <I18nProvider locale={locale}>
      <ContactsScreen />
    </I18nProvider>,
  );
}

async function change(label: string | RegExp, value: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

async function addViaForm(name: string, account: string) {
  fireEvent.click(await screen.findByRole('button', { name: /Add contact/ }));
  await change('Name', name);
  await change('NEAR Testnet account ID', account);
  fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));
}

describe('/contacts', () => {
  it('starts empty, adds a contact, and keeps it after a reload', async () => {
    const first = renderContacts();
    expect(await screen.findByText('No contacts yet')).toBeTruthy();
    await addViaForm('Coffee shop', 'taplytest.testnet');
    expect(await screen.findByText('Contact saved.', { selector: 'p:not(.sr-only)' })).toBeTruthy();
    const row = screen.getByTestId('contact-row');
    expect(within(row).getByText('Coffee shop')).toBeTruthy();
    expect(within(row).getByText('taplytest.testnet')).toBeTruthy();

    first.unmount();
    renderContacts();
    expect(await screen.findByText('taplytest.testnet')).toBeTruthy();
    const stored = JSON.parse(window.localStorage.getItem(CONTACTS_STORAGE_KEY) ?? '{}') as { version: number; contacts: unknown[] };
    expect(stored.version).toBe(1);
    expect(stored.contacts).toHaveLength(1);
  });

  it('validates as you type: mainnet, invalid, hidden characters and duplicates', async () => {
    renderContacts();
    await addViaForm('Alice', 'alice.testnet');
    await screen.findByTestId('contact-row');

    fireEvent.click(screen.getByRole('button', { name: /Add contact/ }));
    await change('NEAR Testnet account ID', 'alice.near');
    fireEvent.blur(screen.getByLabelText('NEAR Testnet account ID'));
    expect(screen.getByText(/looks like a mainnet/)).toBeTruthy();
    await change('NEAR Testnet account ID', 'Alice.testnet');
    expect(screen.getByText(/not a valid NEAR account ID/)).toBeTruthy();
    await change('Name', 'Bo\u202Eb');
    expect(screen.getByText(/hidden or direction-changing/)).toBeTruthy();

    await change('Name', 'Second Alice');
    await change('NEAR Testnet account ID', 'alice.testnet');
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    expect(await screen.findByText('This account is already saved as \u201CAlice\u201D.')).toBeTruthy();
  });

  it('a lookalike account needs an explicit "checked every character" before it can be saved', async () => {
    renderContacts();
    await addViaForm('Shop', 'taplytest.testnet');
    await screen.findByTestId('contact-row');

    fireEvent.click(screen.getByRole('button', { name: /Add contact/ }));
    await change('Name', 'Shop 2');
    await change('NEAR Testnet account ID', 'tap1ytest.testnet');
    const warning = screen.getByTestId('contact-similar');
    expect(warning.textContent).toContain('taplytest.testnet');
    const save = screen.getByRole('button', { name: 'Save contact' }) as HTMLButtonElement;
    fireEvent.click(save);
    expect(screen.queryByText('Contact saved.', { selector: 'p:not(.sr-only)' })).toBeNull();
    fireEvent.click(within(warning).getByRole('checkbox'));
    fireEvent.click(save);
    expect(await screen.findByText('Contact saved.', { selector: 'p:not(.sr-only)' })).toBeTruthy();
    expect(screen.getAllByTestId('contact-row')).toHaveLength(2);
  });

  it('changing the account of a contact shows old and new in full and needs confirmation', async () => {
    renderContacts();
    await addViaForm('Alice', 'alice.testnet');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit: Alice' }));
    await change('NEAR Testnet account ID', 'alice-new.testnet');
    const change1 = screen.getByTestId('contact-account-change');
    expect(change1.textContent).toContain('alice.testnet');
    expect(change1.textContent).toContain('alice-new.testnet');
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    expect(JSON.parse(window.localStorage.getItem(CONTACTS_STORAGE_KEY) ?? '{}').contacts[0].accountId).toBe('alice.testnet');
    fireEvent.click(within(change1).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    expect(await screen.findByText('alice-new.testnet')).toBeTruthy();
  });

  it('searches, and deletes only after confirming in a sheet', async () => {
    renderContacts();
    await addViaForm('Ali', 'ali.testnet');
    await screen.findByTestId('contact-row');
    await addViaForm('Zeynep', 'zeynep.testnet');
    await screen.findByText('zeynep.testnet');
    await change('Search contacts', 'zey');
    expect(screen.getAllByTestId('contact-row')).toHaveLength(1);
    await change('Search contacts', 'nobody');
    expect(screen.getByText('No contact matches this search.')).toBeTruthy();
    await change('Search contacts', '');

    fireEvent.click(screen.getByRole('button', { name: 'Delete: Ali' }));
    expect(screen.getAllByTestId('contact-row')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Delete contact' }));
    expect(await screen.findByText('Contact deleted.', { selector: 'p:not(.sr-only)' })).toBeTruthy();
    expect(screen.getAllByTestId('contact-row')).toHaveLength(1);
  });

  it('a damaged list is left untouched until the person clears it', async () => {
    window.localStorage.setItem(CONTACTS_STORAGE_KEY, '{"version":1,"contacts":"oops"}');
    renderContacts();
    expect(await screen.findByText('Saved contacts could not be read')).toBeTruthy();
    expect(window.localStorage.getItem(CONTACTS_STORAGE_KEY)).toBe('{"version":1,"contacts":"oops"}');
    fireEvent.click(screen.getByRole('button', { name: 'Clear contacts on this device' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear contacts' }));
    expect(await screen.findByText('No contacts yet')).toBeTruthy();
    expect(window.localStorage.getItem(CONTACTS_STORAGE_KEY)).toBeNull();
  });

  it('pre-fills a new contact from ?account= but never saves by itself', async () => {
    window.history.replaceState(null, '', '/contacts?account=bob.testnet');
    renderContacts();
    expect(((await screen.findByLabelText('NEAR Testnet account ID')) as HTMLInputElement).value).toBe('bob.testnet');
    expect(window.localStorage.getItem(CONTACTS_STORAGE_KEY)).toBeNull();
  });

  it('works in Turkish', async () => {
    renderContacts('tr');
    expect(await screen.findByText('Henüz kişi yok')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Kişi ekle/ })).toBeTruthy();
  });
});

type Client = Pick<NearTestnetClient, 'readAccount' | 'readNativeBalance'>;
function client(existing: ReadonlyArray<string>): Client {
  const block = { hash: '11111111111111111111111111111113', height: '100', timestampNs: '1793476890000000000' };
  const obs = <T,>(data: T) => ({ source: 'rpc' as const, assurance: 'verified_final' as const, data, observedBlock: block, checkedAt: '2026-11-01T10:00:00.000Z', stale: false, rpcAvailable: true });
  return {
    readAccount: vi.fn(async (accountId: string) =>
      existing.includes(accountId)
        ? { observation: obs({ accountId, amountYoctoNear: '1', lockedYoctoNear: '0', storageUsageBytes: '182', codeHash: '11111111111111111111111111111111' }), error: null }
        : {
            observation: { ...obs(null), observedBlock: null, assurance: 'unknown' as const },
            error: { code: 'ACCOUNT_NOT_FOUND' as const, messageKey: 'nearClient.errors.ACCOUNT_NOT_FOUND' as const, retry: 'NONE' as const, providerId: 'test' },
          },
    ) as unknown as Client['readAccount'],
    readNativeBalance: vi.fn(async (accountId: string) => ({
      observation: obs({ accountId, assetId: 'near:native' as const, amountYoctoNear: '5000000000000000000000000', lockedYoctoNear: '0', storageUsageBytes: '182' }),
      error: null,
    })) as unknown as Client['readNativeBalance'],
  };
}

describe('/send with contacts', () => {
  function seed() {
    window.localStorage.setItem(
      CONTACTS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        contacts: [{ id: 'contact-0001', label: 'Coffee shop', accountId: 'taplytest.testnet', createdAt: '2026-11-08T09:00:00.000Z', updatedAt: '2026-11-08T09:00:00.000Z' }],
      }),
    );
  }

  async function renderSend(c: Client) {
    const chain = installChain({ contractId: 'pay.testnet' });
    const wallet = recordingWallet('alice.testnet');
    renderWithChain(<SendFlow client={c} />, { setup: readySetup(chain, true), adapter: wallet.adapter });
    await screen.findByLabelText('To');
    return wallet;
  }

  it('choosing a contact copies the exact account ID; the review shows name and full ID; nothing is signed', async () => {
    seed();
    const { signed } = await renderSend(client(['taplytest.testnet']));
    fireEvent.click(screen.getByTestId('contact-picker-open'));
    fireEvent.click(within(screen.getByTestId('contact-picker-list')).getByRole('button', { name: /Coffee shop/ }));
    expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('taplytest.testnet');
    expect(await screen.findByText('Saved contact: Coffee shop')).toBeTruthy();
    expect(await screen.findByText('Account exists on NEAR Testnet', {}, { timeout: 2000 })).toBeTruthy();
    await change('Amount', '0.1');
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('taplytest.testnet')).toBeTruthy();
    expect(within(screen.getByTestId('review-contact')).getByText('Coffee shop')).toBeTruthy();
    expect(signed).toEqual([]);
  });

  it('a typed lookalike of a saved contact is flagged as NOT that contact', async () => {
    seed();
    await renderSend(client(['tap1ytest.testnet']));
    await change('To', 'tap1ytest.testnet');
    const warning = await screen.findByTestId('contact-lookalike');
    expect(warning.textContent).toContain('Not your saved contact \u201CCoffee shop\u201D (taplytest.testnet)');
    expect(screen.queryByTestId('contact-match')).toBeNull();
  });

  it('offers to save a found recipient as a contact (a link, no automatic save)', async () => {
    await renderSend(client(['bob.testnet']));
    await change('To', 'bob.testnet');
    await screen.findByText('Account exists on NEAR Testnet', {}, { timeout: 2000 });
    expect(screen.getByRole('link', { name: 'Save as contact' }).getAttribute('href')).toBe('/contacts?account=bob.testnet');
    expect(window.localStorage.getItem(CONTACTS_STORAGE_KEY)).toBeNull();
  });
});
