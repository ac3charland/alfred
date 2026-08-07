'use client';

import * as React from 'react';

import { type KeyedFilter, useKeyedFilter } from '@/lib/hooks/use-keyed-filter';
import { useCodeFilterActions, useCodeFilters } from '@/lib/stores/code-filter-store';
import type { Project } from '@/lib/types';

/** The multi-select project filter behind the Backlog's "Filter by project" control. */
export interface ProjectFilter extends Pick<KeyedFilter<string>, 'toggle' | 'isFiltering'> {
  /** The ids of the projects currently shown. */
  projectIds: readonly string[];
  /** Replace the whole selection at once (the counterpart to `toggle`). */
  setProjectIds: React.Dispatch<React.SetStateAction<readonly string[]>>;
}

/**
 * A "Filter by project" multi-select over `projects`, resting at **every project selected** — the
 * Backlog is cross-project by default, so the filter only ever narrows it. Like `useStatusFilter`,
 * the selection lives in the layout-mounted `CodeFilterProvider` keyed by `key`, so it survives
 * SPA navigation away from the view and back.
 *
 * The default tracks the live project list, so a project created while the filter is untouched
 * shows up straight away. Once the owner has made an explicit selection, though, it is theirs: a
 * project created afterwards stays unchecked until they check it, rather than being folded in
 * behind their back.
 */
export function useProjectFilter(key: string, projects: Project[]): ProjectFilter {
  const { projectsByKey } = useCodeFilters();
  const { setProjectIds: setStored } = useCodeFilterActions();

  // Memoized so the resting selection (which IS this array) stays referentially stable and
  // `useBacklog`'s memo doesn't rerun on every render.
  const defaultProjectIds = React.useMemo(() => projects.map((project) => project.id), [projects]);

  const store = React.useCallback<React.Dispatch<React.SetStateAction<readonly string[]>>>(
    (update) => {
      setStored(key, defaultProjectIds, update);
    },
    [setStored, key, defaultProjectIds],
  );

  const { selected, setSelected, toggle, isFiltering } = useKeyedFilter(
    projectsByKey.get(key),
    store,
    defaultProjectIds,
  );

  return { projectIds: selected, setProjectIds: setSelected, toggle, isFiltering };
}
