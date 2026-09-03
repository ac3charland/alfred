'use client';

import * as React from 'react';

import { type KeyedFilter, useKeyedFilter } from '@/lib/hooks/use-keyed-filter';
import { useCodeFilterActions, useCodeFilters } from '@/lib/stores/code-filter-store';

/** The multi-select project filter behind the Backlog's "Filter by project" control. */
export interface ProjectFilter extends Pick<KeyedFilter<string>, 'toggle' | 'isFiltering'> {
  /** The ids of the projects the owner has picked out; empty means "no filter" (ALF-201). */
  projectIds: readonly string[];
  /** Replace the whole selection at once (the counterpart to `toggle`). */
  setProjectIds: React.Dispatch<React.SetStateAction<readonly string[]>>;
}

/** The resting selection: nothing picked out. A module constant, so it stays referentially stable. */
const NO_PROJECTS: readonly string[] = [];

/**
 * A "Filter by project" multi-select for the Backlog, resting at **nothing selected** — which the
 * Backlog reads as "every project", so the list starts cross-project and each tap *includes* one
 * more project rather than excluding it (ALF-201: narrowing to one project is one tap, not one tap
 * per project you don't want). A project created later needs no special handling: it simply isn't
 * in the selection until the owner picks it.
 *
 * Like `useStatusFilter`, the selection lives in the layout-mounted `CodeFilterProvider` keyed by
 * `key`, so it survives SPA navigation away from the view and back.
 */
export function useProjectFilter(key: string): ProjectFilter {
  const { projectsByKey } = useCodeFilters();
  const { setProjectIds: setStored } = useCodeFilterActions();

  const store = React.useCallback<React.Dispatch<React.SetStateAction<readonly string[]>>>(
    (update) => {
      setStored(key, NO_PROJECTS, update);
    },
    [setStored, key],
  );

  const { selected, setSelected, toggle, isFiltering } = useKeyedFilter(
    projectsByKey.get(key),
    store,
    NO_PROJECTS,
  );

  return { projectIds: selected, setProjectIds: setSelected, toggle, isFiltering };
}
