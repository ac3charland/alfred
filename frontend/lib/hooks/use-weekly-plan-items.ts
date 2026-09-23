'use client';

import * as React from 'react';

import { fetchWeeklyPlanItems } from '@/lib/api-client';
import type { WeeklyPlanItemsPayload } from '@/lib/weekly-plan-items/payload';

/**
 * The three states the plan's item cohort can be in, as a discriminated union so the section
 * that renders it has an exhaustive, type-checked branch for each — "loading" can never be
 * confused with "error" (a muted note, no retry: the doc above it stays fully usable either
 * way, same posture as `usePrRatio`).
 */
export type WeeklyPlanItemsState =
  | { status: 'loading' }
  | { status: 'ready'; payload: WeeklyPlanItemsPayload }
  | { status: 'error' };

/** The last fetch's outcome, tagged with the `planId` it answers — so a render can tell a
 * fresh result from a stale one left over from the previous id without an extra effect-driven
 * "reset to loading" write (`react-hooks/set-state-in-effect` forbids that). */
type Result =
  | { planId: string; status: 'ready'; payload: WeeklyPlanItemsPayload }
  | { planId: string; status: 'error' };

/**
 * Fetch a plan's item cohort — the tasks and code stories a review created against it —
 * whenever `planId` changes.
 *
 * Deliberately uncached, unlike the plan document itself (`WeeklyPlanProvider`'s read-through
 * cache): a row's `done`/`state` can move while the tab is open (completing a task in the
 * Inbox, a story shipping), so re-fetching on every mount/switch is what keeps the cohort from
 * answering with yesterday's state. `planId === undefined` (nothing uploaded yet) fetches
 * nothing and reports `loading` forever, matching the caller not rendering this section at all
 * in that case.
 */
export function useWeeklyPlanItems(planId: string | undefined): WeeklyPlanItemsState {
  const [result, setResult] = React.useState<Result | undefined>();

  React.useEffect(() => {
    if (planId === undefined) return;
    let active = true;

    fetchWeeklyPlanItems(planId)
      .then((payload) => {
        if (active) setResult({ planId, status: 'ready', payload });
      })
      .catch(() => {
        if (active) setResult({ planId, status: 'error' });
      });

    return () => {
      active = false;
    };
  }, [planId]);

  // A result for a DIFFERENT id is one left over from before `planId` changed — the fetch for
  // the new id is in flight but hasn't landed, so this renders as loading rather than flashing
  // the previous plan's cohort under the new plan's heading.
  if (result === undefined || result.planId !== planId) return { status: 'loading' };
  return result;
}
