'use client';

import * as React from 'react';

/**
 * Subscribe to a CSS media query, lint-clean (no setState-in-effect) and SSR-safe via
 * `useSyncExternalStore` — mirrors `usePrefersReducedMotion`. Returns `false` on the server
 * (no `matchMedia`) and corrects after hydration.
 *
 * Used to decide which global-search surface is the active one for a viewport (the desktop header
 * field vs the mobile full-screen sheet), so only one ever shows results.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (callback: () => void) => {
      const list = globalThis.matchMedia(query);
      list.addEventListener('change', callback);
      return () => {
        list.removeEventListener('change', callback);
      };
    },
    [query],
  );

  const getSnapshot = React.useCallback(() => globalThis.matchMedia(query).matches, [query]);

  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}
