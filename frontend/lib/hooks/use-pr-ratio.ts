'use client';

import * as React from 'react';

import { getPrRatio } from '@/lib/api-client';
import type { PrRatioResponse } from '@/lib/types';

/**
 * The four states the PR-ratio card can be in, as a discriminated union rather than three
 * loose booleans — so the component's branches are exhaustive and type-checked, and
 * "unconfigured" (render nothing) can never be confused with "error" (render a muted note).
 */
export type PrRatioState =
  | { status: 'loading' }
  | { status: 'ready'; ratio: PrRatioResponse }
  | { status: 'unconfigured' }
  | { status: 'error' };

/**
 * Fetch the last seven days' merged-PR split once on mount, tagged with the browser's own
 * timezone so the card's date range reads in the viewer's local days rather than the
 * server's. The window itself is the same seven days wherever it is asked from.
 *
 * Nothing is thrown and nothing is retried: the ratio is an ornament on the Backlog, never a
 * gate, so every failure resolves to a state the card can render around.
 */
export function usePrRatio(): PrRatioState {
  const [state, setState] = React.useState<PrRatioState>({ status: 'loading' });

  React.useEffect(() => {
    let active = true;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    getPrRatio(timezone)
      .then((ratio) => {
        if (!active) return;
        setState(ratio ? { status: 'ready', ratio } : { status: 'unconfigured' });
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
