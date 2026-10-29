import type { ChainObservation } from '@/lib/protocol';

/**
 * Mock containment.
 *
 * NEXT_STEPS.md prompt E: "accurate mock-only presentation under /demo ...
 * No fake chain completion or simulated 'verified' badge outside /demo."
 *
 * Mock data is identified by `observation.source === 'mock'`, which also forces
 * `verifiedRibbon` to false inside mapChainState. This module adds the second
 * layer: mock data may not be rendered on a non-demo route at all.
 */

export const DEMO_ROUTE_PREFIX = '/demo';

export class MockOutsideDemoError extends Error {
  constructor(pathname: string) {
    super(
      `Refused to render mock data on "${pathname}". Mock fixtures are confined to ${DEMO_ROUTE_PREFIX}. ` +
        'If this is real data, its observation.source must not be "mock".',
    );
    this.name = 'MockOutsideDemoError';
  }
}

export function isDemoRoute(pathname: string): boolean {
  return pathname === DEMO_ROUTE_PREFIX || pathname.startsWith(`${DEMO_ROUTE_PREFIX}/`);
}

export function isMock(observation: Pick<ChainObservation<unknown>, 'source'>): boolean {
  return observation.source === 'mock';
}

/**
 * Throws in development so the mistake is impossible to miss; in production it
 * returns false so the caller renders a refusal notice instead of crashing a
 * payment screen. Either way the mock content is never shown.
 */
export function assertMockAllowed(
  observation: Pick<ChainObservation<unknown>, 'source'>,
  pathname: string,
): boolean {
  if (!isMock(observation)) return true;
  if (isDemoRoute(pathname)) return true;

  if (process.env.NODE_ENV !== 'production') {
    throw new MockOutsideDemoError(pathname);
  }
  return false;
}
