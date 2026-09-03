'use client';

import * as React from 'react';

import type { ClassificationOrigin } from '@/lib/tasks/classification';

/** How long the just-classified ring lingers — the same dwell as the search-jump highlight. */
const FLASH_MS = 1600;

/**
 * Flag a brief highlight when a classifier verdict lands on a row that is already on screen.
 *
 * The signal is a TRANSITION, not a state: `unjudged → model` is the one change the sweep's live
 * push can make to a row the owner is looking at, and it is the only one worth announcing. A row
 * that mounts already judged says nothing (a reload seeds hundreds of them), and `→ claimed` says
 * nothing either — the owner's own edit made that, and they were there for it.
 *
 * Driven entirely by the row's own data, so nothing has to be told a verdict arrived: the store's
 * patch changes the origin, the origin changes here. That also means a verdict landing while the
 * Inbox is closed is silent, which is right — there is nothing on screen to announce it to.
 *
 * `null` is a row that asks no provenance question at all (a subtask, a dispatched row, the
 * Completed view) — it is tracked like any other value, so it simply never makes the transition.
 */
export function useClassifiedFlash(origin: ClassificationOrigin | null): boolean {
  const previous = React.useRef(origin);
  const [flashing, setFlashing] = React.useState(false);

  React.useEffect(() => {
    const arrived = previous.current === 'unjudged' && origin === 'model';
    previous.current = origin;
    if (arrived) setFlashing(true);
  }, [origin]);

  React.useEffect(() => {
    if (!flashing) return;
    const timer = globalThis.setTimeout(() => {
      setFlashing(false);
    }, FLASH_MS);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [flashing]);

  return flashing;
}
