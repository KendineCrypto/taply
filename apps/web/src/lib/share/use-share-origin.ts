'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { configuredShareOrigin, resolveShareOrigin } from './origin';
import type { ShareOrigin } from './origin';

const noSubscription = () => () => undefined;

/** The share origin for this page, or null during the server render (no origin known yet). */
export function useShareOrigin(): ShareOrigin | null {
  const current = useSyncExternalStore(
    noSubscription,
    () => window.location.origin,
    () => null,
  );
  return useMemo(
    () => (current === null ? null : resolveShareOrigin({ configured: configuredShareOrigin(), current })),
    [current],
  );
}
