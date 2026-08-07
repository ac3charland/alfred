'use client';

import * as React from 'react';

import { type KeyedFilter, useKeyedFilter } from '@/lib/hooks/use-keyed-filter';
import { useCodeFilterActions, useCodeFilters } from '@/lib/stores/code-filter-store';
import type { CodeFactoryState } from '@/lib/types';

/** The multi-select status filter state shared by the Backlog list and the project board. */
export interface StatusFilter extends Pick<
  KeyedFilter<CodeFactoryState>,
  'toggle' | 'isFiltering'
> {
  /** The currently-selected factory states (a subset of the caller's option list). */
  statuses: readonly CodeFactoryState[];
  /**
   * Replace the whole selection at once — jump to an exact set rather than toggling one state at a
   * time (the counterpart to `toggle`).
   */
  setStatuses: React.Dispatch<React.SetStateAction<readonly CodeFactoryState[]>>;
}

/**
 * A "Filter by status" multi-select over factory states, seeded from `defaultStatuses` (the
 * resting selection). Both Code views hold their status filter through this hook: the Backlog
 * defaults to the outstanding states, the board to every happy-path lane. Pass a **referentially
 * stable** default (a module constant) so the initial selection and the `isFiltering` compare stay
 * steady across renders.
 *
 * The selection is held in the layout-mounted `CodeFilterProvider`, keyed by `key` (the Backlog
 * passes `'backlog'`, a board its project id), so it **survives SPA navigation** between the
 * views — leaving a view and returning restores its filter rather than resetting it to the
 * default. Keep `key` stable per view.
 */
export function useStatusFilter(
  key: string,
  defaultStatuses: readonly CodeFactoryState[],
): StatusFilter {
  const { byKey } = useCodeFilters();
  const { setStatuses: setStored } = useCodeFilterActions();

  const store = React.useCallback<
    React.Dispatch<React.SetStateAction<readonly CodeFactoryState[]>>
  >(
    (update) => {
      setStored(key, defaultStatuses, update);
    },
    [setStored, key, defaultStatuses],
  );

  const { selected, setSelected, toggle, isFiltering } = useKeyedFilter(
    byKey.get(key),
    store,
    defaultStatuses,
  );

  return { statuses: selected, setStatuses: setSelected, toggle, isFiltering };
}
