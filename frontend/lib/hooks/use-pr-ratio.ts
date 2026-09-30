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

export interface PrRatio {
  state: PrRatioState;
  /**
   * Ask again — after an exclusion is saved, say. The current state stays on screen until the
   * answer lands (no flash back to the loading bar), and only the latest call's answer is kept.
   */
  refetch: () => void;
}

/**
 * Fetch the last seven days' merged-PR split on mount (and again on `refetch`), tagged with the
 * browser's own timezone so the card's date range reads in the viewer's local days rather than
 * the server's. The window itself is the same seven days wherever it is asked from.
 *
 * Nothing is thrown and nothing is retried: the ratio is an ornament on the Dashboard, never a
 * gate, so every failure resolves to a state the card can render around.
 */
export function usePrRatio(): PrRatio {
  const [state, setState] = React.useState<PrRatioState>({ status: 'loading' });
  // Numbers each request; an answer is applied only if no later request has started since, so a
  // slow first refetch can't overwrite a quicker second one. Bumped on unmount, too.
  const latestRequest = React.useRef(0);

  const load = React.useCallback(() => {
    latestRequest.current += 1;
    const request = latestRequest.current;
    const isLatest = () => request === latestRequest.current;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    getPrRatio(timezone)
      .then((ratio) => {
        if (!isLatest()) return;
        setState(ratio ? { status: 'ready', ratio } : { status: 'unconfigured' });
      })
      .catch(() => {
        if (isLatest()) setState({ status: 'error' });
      });
  }, []);

  React.useEffect(() => {
    load();
    return () => {
      latestRequest.current += 1;
    };
  }, [load]);

  return { state, refetch: load };
}
