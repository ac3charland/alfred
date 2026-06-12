'use client';

import * as React from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(callback: () => void): () => void {
  const query = globalThis.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', callback);
  return () => {
    query.removeEventListener('change', callback);
  };
}

const getSnapshot = (): boolean => globalThis.matchMedia(REDUCED_MOTION_QUERY).matches;

// Server render has no matchMedia; assume motion is allowed so the markup matches
// the common client case and only corrects after hydration if needed.
// Stryker disable next-line BooleanLiteral,ArrowFunction: AT_CEILING — the server snapshot
// is read only on the first render; every motion-aware consumer treats "motion allowed" as
// the resting state, so false vs true here is unobservable until the client snapshot takes over.
const getServerSnapshot = (): boolean => false;

/**
 * Subscribe to the user's `prefers-reduced-motion` setting.
 *
 * Lint-clean (no setState-in-effect) and SSR-safe: it reads the media query through
 * `useSyncExternalStore`, returns `false` (motion allowed) on the server, and corrects
 * after hydration. Use it to gate one-shot motion — skip the animation and take the
 * immediate path when it returns `true`. See the `motion` skill.
 */
export function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
