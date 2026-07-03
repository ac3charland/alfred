'use client';

import * as React from 'react';

import { createContextPair } from '@/lib/stores/create-context-pair';
import type { CodeFactoryState } from '@/lib/types';

/**
 * Code filter store — the single source of truth for each Code view's "Filter by status"
 * selection.
 *
 * A view's status filter is a cross-navigation invariant: the Backlog and the project boards
 * are unmounted and remounted as `CodeView` re-derives the active view from the URL, so a
 * selection held in the view's own `useState` would reset the moment you leave and come back
 * (Backlog → a board → Backlog). Lifting it here — into a provider mounted once in the shell
 * layout, above the view router — keeps each view's selection alive across those SPA switches.
 *
 * Selections are keyed per view: the Backlog under `'backlog'`, each board under its project id
 * (route-guaranteed never to be the literal `'backlog'`). A key absent from the map means the
 * view is still at its own default; the default is owned by the caller (`useStatusFilter`) and
 * never stored here, so a first read falls through to it.
 *
 * Like the other coordination stores (ExpansionProvider / ActiveEditorProvider) it is seeded
 * with NO server data (the filter is ephemeral session UI, not DB-backed), and splits state +
 * actions into two contexts so an actions-only caller doesn't re-render on every change.
 */

export interface CodeFilterState {
  /** Selected statuses per view key; a key absent from the map means "still at the default". */
  byKey: ReadonlyMap<string, readonly CodeFactoryState[]>;
}

interface CodeFilterActions {
  /**
   * Set the selection for `key`. `defaults` seeds the base a functional `update` builds on the
   * first time a view is touched (before any entry exists for its key), so a toggle from the
   * resting default starts from that default rather than an empty list.
   */
  setStatuses: (
    key: string,
    defaults: readonly CodeFactoryState[],
    update: React.SetStateAction<readonly CodeFactoryState[]>,
  ) => void;
}

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  CodeFilterState,
  CodeFilterActions
>('a CodeFilterProvider');

export function CodeFilterProvider({ children }: { children: React.ReactNode }) {
  const [byKey, setByKey] = React.useState<ReadonlyMap<string, readonly CodeFactoryState[]>>(
    () => new Map(),
  );

  const state = React.useMemo<CodeFilterState>(() => ({ byKey }), [byKey]);

  const actions = React.useMemo<CodeFilterActions>(
    () => ({
      setStatuses(key, defaults, update) {
        setByKey((current) => {
          const previous = current.get(key) ?? defaults;
          const next = typeof update === 'function' ? update(previous) : update;
          const map = new Map(current);
          map.set(key, next);
          return map;
        });
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

/** Read every view's stored status selection. Throws outside a provider. */
export function useCodeFilters(): CodeFilterState {
  return useStateValue('useCodeFilters');
}

/** Read the set-selection action. Throws outside a provider. */
export function useCodeFilterActions(): CodeFilterActions {
  return useActions('useCodeFilterActions');
}
