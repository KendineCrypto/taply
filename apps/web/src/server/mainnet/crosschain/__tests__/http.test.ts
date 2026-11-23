// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ quote: vi.fn(), session: vi.fn(), archive: vi.fn(), ingress: vi.fn() }));
vi.mock('@/lib/mainnet/build', () => ({ IS_MAINNET_BUILD: true }));
vi.mock('../../oneclick/rate-limit', () => ({ ingress: mock.ingress }));
vi.mock('../runtime', () => ({ crosschainMode: () => 'dry', crosschainService: () => mock }));
import { availability, post } from '../http';
function req(body: unknown = { secret: 'a'.repeat(64) }, headers: Record<string,string> = {}) { return new Request('https://test.example/api/mainnet/crosschain/session', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://test.example', ...headers }, body: JSON.stringify(body) }); }
beforeEach(() => { vi.resetAllMocks(); mock.ingress.mockResolvedValue(true); mock.session.mockResolvedValue(null); });
it('exposes only the mode, with no-store', async () => { const r = availability(); expect(await r.json()).toEqual({ mode: 'dry' }); expect(r.headers.get('cache-control')).toBe('no-store'); });
it('rejects a cross-origin caller before touching the ledger', async () => { expect((await post(req(undefined, { origin: 'https://evil.example' }), 'session')).status).toBe(403); expect(mock.session).not.toHaveBeenCalled(); expect(mock.ingress).not.toHaveBeenCalled(); });
it('rejects cross-site fetch metadata even without an origin mismatch', async () => expect((await post(req(undefined, { 'sec-fetch-site': 'cross-site' }), 'session')).status).toBe(403));
it('requires JSON', async () => expect((await post(req(undefined, { 'content-type': 'text/plain' }), 'session')).status).toBe(415));
it('requires an unpredictable valid capability', async () => { expect((await post(req({ secret: 'short' }), 'session')).status).toBe(400); expect(mock.session).not.toHaveBeenCalled(); });
it('rejects unknown request fields', async () => expect((await post(req({ secret: 'a'.repeat(64), privateKey: 'never-accepted' }), 'session')).status).toBe(400));
it('fails closed when rate limiter is unavailable', async () => { mock.ingress.mockRejectedValue(Error('STORE_UNAVAILABLE')); expect((await post(req(), 'session')).status).toBe(503); expect(mock.session).not.toHaveBeenCalled(); });
it('does not leak upstream exceptions', async () => { mock.session.mockRejectedValue(Error('provider secret URL')); const r = await post(req(), 'session'); expect(await r.json()).toEqual({ error: 'SERVICE_UNAVAILABLE' }); });
it('rate limits before reading the session', async () => { mock.ingress.mockResolvedValue(false); expect((await post(req(), 'session')).status).toBe(429); expect(mock.session).not.toHaveBeenCalled(); });
