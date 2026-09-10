'use client';

import * as React from 'react';

/** How often the clock advances by default — fast enough for a freshness dot, cheap enough to leave running. */
export const NOW_TICK_MS = 30_000;

/**
 * A ticking "what time is it" for surfaces whose meaning is a comparison against now — a
 * source's freshness, a row's remaining retention, a relative timestamp. Reading `Date.now()`
 * during render would freeze at first paint and quietly go stale; this re-renders on a tick.
 *
 * Two properties matter and both come from COALESCING the clock to the tick boundary rather
 * than reading it raw:
 *
 * - `useSyncExternalStore` calls `getSnapshot` on every render and loops forever if the value
 *   keeps changing, which a raw `Date.now()` does.
 * - The server and the hydrating client read the clock milliseconds apart, so a raw reading
 *   makes every clock-derived string a hydration coin-flip. Snapped to the same boundary they
 *   agree unless the render straddles one.
 */
export function useNow(intervalMs: number = NOW_TICK_MS): Date {
  const subscribe = React.useCallback(
    (callback: () => void) => {
      const id = setInterval(callback, intervalMs);
      return () => {
        clearInterval(id);
      };
    },
    [intervalMs],
  );

  const getSnapshot = React.useCallback(
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    [intervalMs],
  );

  const millis = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return React.useMemo(() => new Date(millis), [millis]);
}
