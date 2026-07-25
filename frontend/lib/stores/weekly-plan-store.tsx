'use client';

import * as React from 'react';

import { fetchWeeklyPlan } from '@/lib/api-client';
import { createContextPair } from '@/lib/stores/create-context-pair';
import { useToastActions } from '@/lib/stores/toast-store';
import type { WeeklyPlan, WeeklyPlanSummary } from '@/lib/types';

/**
 * Weekly plan store — the archive index plus whichever plan the view is showing.
 *
 * It breaks the house "fetch everything at the shell and filter client-side" default on
 * purpose: a plan is tens of KB of HTML and the archive grows weekly, so seeding all of them
 * would inflate every page load in the app, including the ones that never open the plan view.
 * The shell seeds the index (no documents) and the latest plan's document; picking an older
 * week fetches that one document and caches it here, so a second visit is instant.
 *
 * There is no optimistic-mutation machinery: nothing in the app writes a plan (uploads arrive
 * through the keyed ingress endpoint), so this is seeded data plus a read-through cache.
 */

export interface WeeklyPlanState {
  /** Every archived plan, newest first — the picker's list. */
  index: WeeklyPlanSummary[];
  /** The plan currently rendered, or undefined when nothing has been uploaded. */
  selected: WeeklyPlan | undefined;
}

export interface WeeklyPlanActions {
  /**
   * Show the plan with this id, fetching its document first if it isn't cached. The selection
   * only moves once the document is in hand, so the view never blanks mid-switch; a failed
   * fetch toasts and leaves the current plan showing.
   */
  selectPlan: (id: string) => Promise<void>;
}

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  WeeklyPlanState,
  WeeklyPlanActions
>('a WeeklyPlanProvider');

export function WeeklyPlanProvider({
  initialIndex,
  initialLatest,
  children,
}: {
  initialIndex: WeeklyPlanSummary[];
  initialLatest: WeeklyPlan | undefined;
  children: React.ReactNode;
}) {
  const [state, setState] = React.useState<WeeklyPlanState>({
    index: initialIndex,
    selected: initialLatest,
  });

  // The read-through document cache, keyed by plan id and seeded with the plan the shell
  // already sent. A ref (not state): it never affects rendering on its own — the selection does.
  const cacheRef = React.useRef<Map<string, WeeklyPlan>>(
    new Map(initialLatest === undefined ? [] : [[initialLatest.id, initialLatest]]),
  );

  // Captured through a ref synced by an effect so the stable (`[]`) action closure can toast
  // without it being a dep — the same pattern the optimistic stores use.
  const { showToast } = useToastActions();
  const showToastRef = React.useRef(showToast);
  React.useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const actions = React.useMemo<WeeklyPlanActions>(
    () => ({
      async selectPlan(id) {
        const cached = cacheRef.current.get(id);
        if (cached !== undefined) {
          setState((current) => ({ ...current, selected: cached }));
          return;
        }
        try {
          const plan = await fetchWeeklyPlan(id);
          cacheRef.current.set(id, plan);
          setState((current) => ({ ...current, selected: plan }));
        } catch {
          // Nothing cached, nothing selected — the current plan stays on screen.
          showToastRef.current("Couldn't load that week's plan");
        }
      },
    }),
    [],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

/** The archive index, newest first. Throws outside a WeeklyPlanProvider. */
export function useWeeklyPlanIndex(): WeeklyPlanSummary[] {
  return useStateValue('useWeeklyPlanIndex').index;
}

/** The plan currently being shown, or undefined when none has been uploaded. */
export function useSelectedWeeklyPlan(): WeeklyPlan | undefined {
  return useStateValue('useSelectedWeeklyPlan').selected;
}

/** The weekly plan actions. Throws outside a WeeklyPlanProvider. */
export function useWeeklyPlanActions(): WeeklyPlanActions {
  return useActions('useWeeklyPlanActions');
}
