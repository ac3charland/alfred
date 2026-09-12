'use client';

import * as React from 'react';

import { getLocVelocity } from '@/lib/api-client';
import type { LocVelocityResponse } from '@/lib/types';

/**
 * The five states the lines-changed card can be in, as a discriminated union rather than four
 * loose booleans — so the component's branches are exhaustive and type-checked, and the three
 * non-happy outcomes can never be confused with each other: `unconfigured` renders nothing at
 * all, `computing` invites a refresh, `error` shows a muted note.
 */
export type LocVelocityState =
  | { status: 'loading' }
  | { status: 'ready'; velocity: LocVelocityResponse }
  | { status: 'computing' }
  | { status: 'unconfigured' }
  | { status: 'error' };

/**
 * Fetch the weekly lines-changed series once on mount. No timezone is sent: GitHub buckets
 * these statistics on Sunday-UTC weeks itself, so there is nothing for a local zone to shift.
 *
 * Nothing is thrown and nothing is retried: the chart is an ornament on the Dashboard, never a
 * gate, so every failure resolves to a state the card can render around.
 */
export function useLocVelocity(): LocVelocityState {
  const [state, setState] = React.useState<LocVelocityState>({ status: 'loading' });

  React.useEffect(() => {
    let active = true;

    getLocVelocity()
      .then((result) => {
        if (active) setState(result);
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });

    return () => {
      active = false;
    };
  }, []);

  return state;
}
