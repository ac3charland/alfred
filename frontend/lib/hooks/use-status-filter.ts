'use client';

import * as React from 'react';

import type { CodeFactoryState } from '@/lib/types';

/** The multi-select status filter state shared by the Backlog list and the project board. */
export interface StatusFilter {
  /** The currently-selected factory states (a subset of the caller's option list). */
  statuses: readonly CodeFactoryState[];
  /**
   * Replace the whole selection — for preset "macro" shortcuts (e.g. the Backlog's Human Review)
   * that jump to an exact set rather than toggling one state at a time.
   */
  setStatuses: React.Dispatch<React.SetStateAction<readonly CodeFactoryState[]>>;
  /** Toggle one state in or out of the selection. */
  toggle: (state: CodeFactoryState) => void;
  /**
   * Whether the selection differs from its resting default — drives the trigger's teal + count
   * treatment. `false` at the default (narrower OR wider), `true` for any other selection.
   */
  isFiltering: boolean;
}

/**
 * A "Filter by status" multi-select over factory states, seeded from `defaultStatuses` (the
 * resting selection). Both Code views hold their status filter through this hook: the Backlog
 * defaults to the outstanding states, the board to every happy-path lane. Pass a **referentially
 * stable** default (a module constant) so the initial selection and the `isFiltering` compare stay
 * steady across renders.
 */
export function useStatusFilter(defaultStatuses: readonly CodeFactoryState[]): StatusFilter {
  const [statuses, setStatuses] = React.useState<readonly CodeFactoryState[]>(defaultStatuses);

  const toggle = React.useCallback((state: CodeFactoryState) => {
    setStatuses((current) =>
      current.includes(state)
        ? current.filter((candidate) => candidate !== state)
        : [...current, state],
    );
  }, []);

  // Flag the trigger only when the selection differs from the default. The default is the resting
  // state (neither narrower nor wider), so compare length AND membership: any add or drop flips it.
  const isFiltering =
    statuses.length !== defaultStatuses.length ||
    !defaultStatuses.every((state) => statuses.includes(state));

  return { statuses, setStatuses, toggle, isFiltering };
}
