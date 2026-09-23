'use client';

import * as React from 'react';

import { COMMS_LIVE_WINDOW_MS, isCommsLive } from '@/lib/comms';

/**
 * Whether the Comms view is a live reflection of the server, precise to the millisecond — unlike
 * `useNow`'s clock, which is deliberately coalesced to a 30s bucket and only moves when its own
 * (unaligned) interval fires. That coalescing is fine for a relative timestamp like "2h ago", but
 * the live/not-live flip is a boundary a viewer can watch cross, and riding the bucketed clock
 * lets it land tens of seconds late — up to two ticks after `COMMS_LIVE_WINDOW_MS` actually
 * elapses.
 *
 * Built the same way as `useNow` (`useSyncExternalStore`, not `useState` + an effect) so the
 * flip is a subscription, not a manual synchronization: one `setTimeout`, armed for exactly
 * `lastReadAt + COMMS_LIVE_WINDOW_MS`, notifies React when it fires. React itself re-arms it
 * whenever `lastReadAt` moves (a new read landed) or `loaded` changes — `subscribe`'s identity
 * changing is what triggers that — and tears it down on unmount. A delay that is already in the
 * past — the tab was asleep well past the window — is clamped to 0 by `setTimeout` itself, so a
 * wake finds the flip firing on the very next tick rather than waiting out a window it already
 * missed.
 *
 * That deadline timer alone doesn't survive an actual sleep/suspend, though: `setTimeout` is
 * monotonic and doesn't run while the machine is asleep, while `Date.now()` jumps by the whole
 * gap the instant it wakes — so the armed timer can sit pending for hours past its real deadline,
 * and nothing re-renders to notice until some unrelated trigger does. `subscribe` also listens
 * for `visibilitychange` and `pageshow` — the same signals `CommsProvider` re-reads a snapshot
 * on — and calls `onChange` on either, forcing `getSnapshot` to re-check against the current
 * `Date.now()` the moment the tab is plausibly back, whether or not that read has landed yet.
 */
export function useCommsLive(loaded: boolean, lastReadAt: string | null): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      // No timer to arm while nothing has loaded yet — `getSnapshot` already reads `false` in
      // that case, and this hook re-subscribes (with a real `id`) the moment `loaded`/
      // `lastReadAt` change. `clearTimeout(undefined)` below is a harmless no-op either way.
      //
      // The +1ms lands the timer just PAST the window rather than exactly on it: `isCommsLive`
      // treats an elapsed time equal to `COMMS_LIVE_WINDOW_MS` as still live (`<=`), and nothing
      // else would re-check afterwards to catch that up — this is the one moment the flip has to
      // happen on its own trigger rather than a re-render.
      const id =
        loaded && lastReadAt !== null
          ? setTimeout(onChange, Date.parse(lastReadAt) + COMMS_LIVE_WINDOW_MS - Date.now() + 1)
          : undefined;
      // Sleep/suspend freezes this timer's monotonic clock while the wall clock keeps moving, so
      // it can wake arbitrarily late relative to `Date.now()` — see the doc comment above. These
      // are the browser's own "time may have jumped" signals: re-check the moment either fires,
      // rather than trusting the deadline timer to still be honest.
      document.addEventListener('visibilitychange', onChange);
      window.addEventListener('pageshow', onChange);
      return () => {
        clearTimeout(id);
        document.removeEventListener('visibilitychange', onChange);
        window.removeEventListener('pageshow', onChange);
      };
    },
    [loaded, lastReadAt],
  );

  const getSnapshot = React.useCallback(
    () => isCommsLive(loaded, lastReadAt, new Date()),
    [loaded, lastReadAt],
  );

  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
