'use client';

import * as React from 'react';

/**
 * A phone-sized viewport: Tailwind v4's `max-md` (below `md`, 48rem = 768px). The query is the
 * *mobile* one on purpose — jsdom stubs every `matchMedia` to `false`, so a mobile-positive query
 * leaves a component test on its desktop layout unless it opts in by matching this query.
 */
export const MOBILE_QUERY = '(width < 48rem)';

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
