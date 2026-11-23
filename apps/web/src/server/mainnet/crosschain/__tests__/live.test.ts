// @vitest-environment node
import { expect, it } from 'vitest';
import { createOneClickClient } from '../../oneclick/client';
import { createCrosschainService } from '../service';

// Explicit opt-in. Always dry: no deposit address, transaction, key or money.
it.skipIf(process.env['TAPLY_LIVE_CROSSCHAIN'] !== '1')('accepts a real signed Base → Solana dry quote', async () => {
  const svc = createCrosschainService({ client: createOneClickClient({}), mode: 'dry', store: null, now: Date.now, registered: async () => false, verify: async () => { throw Error('not called'); } });
  const q = await svc.quote({ from: 'base', to: 'sol', amount: '5000000', recipient: '7YttLkHDoNj9wyDur5q1VttZDvVdzgjv7tLdzxPcYh9D', refundTo: '0x1111111111111111111111111111111111111111', slippageBps: 100 }, 'a'.repeat(64), false);
  expect(q.funded).toBe(false); expect(q.deposit).toBeNull(); expect(BigInt(q.minAmountOut)).toBeGreaterThan(0n);
}, 30000);
