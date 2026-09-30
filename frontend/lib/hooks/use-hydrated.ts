'use client';

import * as React from 'react';

/** The end of a subscription to nothing. */
function unsubscribe(): void {
  // Nothing was subscribed, so there is nothing to undo.
}

/** Nothing to subscribe to: the answer changes once, when hydration ends, and React re-renders. */
function subscribe(): () => void {
  return unsubscribe;
}

/**
 * Whether this render is past hydration: `false` on the server and in the hydrating render, which
 * must match the server's markup, then `true` — React re-renders at once when the two differ.
 * Gate anything the server can't know on it (the browser's time zone, say), so the first paint
 * matches the server and the browser's answer follows straight after instead of tripping a
 * hydration mismatch. A render that never hydrated (a client-side navigation) is `true` at once.
 */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
