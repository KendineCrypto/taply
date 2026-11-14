import { afterEach, expect, it, vi } from 'vitest';
const factory = vi.hoisted(() => vi.fn(() => ({ save: vi.fn(), load: vi.fn(), clear: vi.fn() })));
vi.mock('@/lib/wallet/session-store', () => ({ createIndexedDbSessionStore: factory }));
import { createMainnetVaultSessionStore } from '../vault-session';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); factory.mockClear(); });
it('reload reuses the tab row in an isolated Mainnet database; a fresh tab gets a different row', () => {
  vi.stubGlobal('indexedDB', {});
  createMainnetVaultSessionStore(); const first = factory.mock.calls[0];
  createMainnetVaultSessionStore(); expect(factory.mock.calls[1]).toEqual(first);
  expect(first).toEqual([{ databaseName: 'taply.mainnet-wallet-session.v1', sessionKey: expect.any(String) }]);
  expect(sessionStorage.length).toBe(1);
  sessionStorage.clear(); createMainnetVaultSessionStore();
  expect(factory.mock.calls[2]).not.toEqual(first);
});
it('blocked tab storage keeps page-only unlock instead of leaking into a shared session', () => {
  vi.stubGlobal('indexedDB', {}); vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('blocked'); });
  expect(createMainnetVaultSessionStore()).toBeNull(); expect(factory).not.toHaveBeenCalled();
});
it('without IndexedDB the existing page-only behavior remains', () => {
  vi.stubGlobal('indexedDB', undefined); expect(createMainnetVaultSessionStore()).toBeNull(); expect(factory).not.toHaveBeenCalled();
});

it('Lock now immediately revokes the tab even while IndexedDB deletion is pending', async () => {
  vi.stubGlobal('indexedDB', {});
  let finish: () => void = () => {};
  const base = { save: vi.fn(), load: vi.fn(), clear: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) };
  factory.mockReturnValueOnce(base);
  const session = createMainnetVaultSessionStore()!;
  const oldId = sessionStorage.getItem('taply.mainnet-unlock-tab.v1');
  const clearing = session.clear();
  expect(sessionStorage.getItem('taply.mainnet-unlock-tab.v1')).toBeNull();
  expect(await session.load()).toBeNull(); expect(base.load).not.toHaveBeenCalled();
  createMainnetVaultSessionStore(); expect(sessionStorage.getItem('taply.mainnet-unlock-tab.v1')).not.toBe(oldId);
  finish(); await clearing;
});
