'use client';

import * as React from 'react';

import { getLocVelocity } from '@/lib/api-client';
import type { LocVelocityResponse } from '@/lib/types';

/**
 * The five states the lines-changed card can be in, as a discriminated union rather than four
 * loose booleans — so the component's branches are exhaustive and type-checked, and the three
 * non-happy outcomes can never be confused with each other: `unconfigured` renders nothing at
 * all, `computing` polls quietly in the background, `error` shows a muted note.
 */
export type LocVelocityState =
  | { status: 'loading' }
  | { status: 'ready'; velocity: LocVelocityResponse }
  | { status: 'computing' }
  | { status: 'unconfigured' }
  | { status: 'error' };

/**
 * How often to re-poll while GitHub is still computing the statistics (a bodyless 202). GitHub's
 * own guidance is "usually done within a minute", so a bar every fifteen seconds notices that
 * without hammering the endpoint while a bigger repo takes longer.
 */
export const COMPUTING_POLL_MS = 15_000;

/**
 * Fetch the weekly lines-changed series on mount, and keep polling on a timer for as long as
 * GitHub answers "still computing" — so the card lands on the real chart by itself once the
 * numbers are ready, and nobody has to reload the page to find out. No timezone is sent: GitHub
 * buckets these statistics on Sunday-UTC weeks itself, so there is nothing for a local zone to
 * shift.
 *
 * Nothing is thrown: the chart is an ornament on the Dashboard, never a gate, so every failure
 * resolves to a state the card can render around. Only `computing` schedules another fetch —
 * `ready`, `unconfigured` and `error` are all resting states.
 */
export function useLocVelocity(): LocVelocityState {
  const [state, setState] = React.useState<LocVelocityState>({ status: 'loading' });

  React.useEffect(() => {
    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    function load() {
      getLocVelocity()
        .then((result) => {
          if (!active) return;
          setState(result);
          if (result.status === 'computing') {
            timeoutId = setTimeout(load, COMPUTING_POLL_MS);
          }
        })
        .catch(() => {
          if (active) setState({ status: 'error' });
        });
    }

    load();

    return () => {
      active = false;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, []);

  return state;
}
