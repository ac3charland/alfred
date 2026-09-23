'use client';

import * as React from 'react';

import { isCommsLive } from '@/lib/comms';

/**
 * Whether the Comms view is a live reflection of the server, checked on a 1s interval — unlike
 * `useNow`'s clock, which is snapped to a 30s bucket for display. That coalescing is fine for a
 * relative timestamp like "2h ago", but the live/not-live flip is a boundary a viewer can watch
 * cross, so it gets its own frequent, boolean-only check instead of riding the display clock.
 *
 * Built on `useSyncExternalStore`, not `useState` + an effect: `subscribe` arms one
 * `setInterval(onChange, 1000)`, unconditionally and for the life of the mount, and
 * `getSnapshot` recomputes `isCommsLive` against `Date.now()` on every call. React only
 * re-renders when that boolean actually changes, so the 1s cadence costs a re-check, not a
 * re-render, the rest of the time — and it catches a real sleep/suspend too: a `setTimeout`
 * deadline is monotonic and doesn't run while the machine is asleep, but this interval fires
 * within a second of waking regardless (its own schedule was already due), and the very next
 * `getSnapshot` reads the post-sleep `Date.now()` honestly. That subsumes the `visibilitychange`
 * / `pageshow` re-check this used to need — this notices a wake whether or not either event
 * fires.
 */
export function useCommsLive(loaded: boolean, lastReadAt: string | null): boolean {
  const subscribe = React.useCallback((onChange: () => void) => {
    const id = setInterval(onChange, 1000);
    return () => {
      clearInterval(id);
    };
  }, []);

  const getSnapshot = React.useCallback(
    () => isCommsLive(loaded, lastReadAt, new Date()),
    [loaded, lastReadAt],
  );

  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
