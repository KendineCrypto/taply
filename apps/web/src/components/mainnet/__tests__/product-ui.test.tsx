import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MainnetLocaleProvider } from '@/lib/mainnet/copy';
import { MainnetProduct } from '../MainnetProduct';
import { productStorageKey } from '@/lib/mainnet/product';
const state = vi.hoisted(() => ({ account: 'alice.near', push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/lib/mainnet/wallet', () => ({ useMainnetWallet: () => ({ status: 'connected', accountId: state.account, connect: async () => {}, disconnect: async () => {} }) }));
const view = (path: string, locale: 'en' | 'tr' = 'en') => <MainnetLocaleProvider locale={locale}><MainnetProduct path={path} /></MainnetLocaleProvider>;
afterEach(() => { cleanup(); localStorage.clear(); state.account = 'alice.near'; });
it('saves contacts only under connected Mainnet owner and hides them immediately on account switch', async () => {
  const ui = render(view('contacts'));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Save on device' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bob' } });
  fireEvent.change(screen.getByLabelText('NEAR account'), { target: { value: 'bob.near' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save on device' }));
  expect(JSON.parse(localStorage.getItem(productStorageKey('alice.near'))!).contacts[0].id).toBe('bob.near');
  state.account = 'carol.near'; ui.rerender(view('contacts'));
  expect(screen.queryByText('Bob')).toBeNull();
  await waitFor(() => expect((screen.getByRole('button', { name: 'Save on device' }) as HTMLButtonElement).disabled).toBe(false));
  expect(localStorage.getItem(productStorageKey('carol.near'))).toBeNull();
});
it('computes exact split shares and invalidates the result when terms change', () => {
  render(view('split')); fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0.000005' } });
  fireEvent.click(screen.getByRole('button', { name: 'Calculate exact shares' }));
  expect(screen.getByText('1. 0.000003 USDC')).toBeTruthy(); expect(screen.getByText('2. 0.000002 USDC')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0.000006' } }); expect(screen.queryByText('1. 0.000003 USDC')).toBeNull();
});
it('Gift envelope preview never creates a secret, transaction or fundable link', () => {
  render(view('gift/new')); fireEvent.change(screen.getByLabelText('Message / memo'), { target: { value: 'Happy birthday' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview envelope' }));
  expect(screen.getByRole('img', { name: 'Draft · no funds sent' }).getAttribute('data-open')).toBe('true');
  expect(document.querySelector('a[href*="#k="]')).toBeNull(); expect(localStorage.length).toBe(0);
});
it('restore never exposes a phrase input, and Send remains disabled in both languages', () => {
  const ui = render(view('wallet/restore')); expect(screen.getByText(/No recovery phrase is collected/)).toBeTruthy();
  expect(document.querySelector('textarea')).toBeNull();
  ui.rerender(view('send', 'tr')); expect((screen.getByRole('button', { name: 'Gönder' }) as HTMLButtonElement).disabled).toBe(true);
});
it('uncertain/unsupported receipt, protected and Handshake screens never claim paid', () => {
  for (const path of ['receipt/' + 'a'.repeat(64), 'protected/new', 'handshake', 'gift/p']) {
    const ui = render(view(path)); expect(screen.queryByRole('button', { name: /claim|release|refund|pay now/i })).toBeNull(); ui.unmount();
  }
});
