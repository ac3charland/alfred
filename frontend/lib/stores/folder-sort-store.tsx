'use client';

import * as React from 'react';

import { createContextPair } from '@/lib/stores/create-context-pair';
import { DEFAULT_TASK_SORT, type TaskSortMode } from '@/lib/tasks/task-sort';

/**
 * Folder sort store — the single source of truth for each folder's task ordering.
 *
 * A folder's sort choice is a cross-navigation invariant: `TaskViews` unmounts and remounts the
 * folder view as it re-derives the active view from the URL, so a mode held in the view's own
 * `useState` would snap back to the default the moment you opened another folder and came back.
 * Lifting it here — into a provider mounted once in the shell layout, above the view router —
 * keeps each folder's choice alive across those SPA switches.
 *
 * Choices are keyed per folder, so one folder can lead on due dates while another leads on
 * priority. A folder absent from the map is still at {@link DEFAULT_TASK_SORT}; the default is
 * never written into the map, so "untouched" and "explicitly set back to priority" stay the same
 * state.
 *
 * Like the other coordination stores it is seeded with NO server data (the choice is ephemeral
 * session UI, not DB-backed), and splits state + actions into two contexts so an actions-only
 * caller doesn't re-render on every change.
 */

export interface FolderSortState {
  /** The chosen mode per folder id; a folder absent from the map is at the default. */
  byFolderId: ReadonlyMap<string, TaskSortMode>;
}

interface FolderSortActions {
  /** Set one folder's ordering. */
  setSortMode: (folderId: string, mode: TaskSortMode) => void;
}

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  FolderSortState,
  FolderSortActions
>('a FolderSortProvider');

export function FolderSortProvider({ children }: { children: React.ReactNode }) {
  const [byFolderId, setByFolderId] = React.useState<ReadonlyMap<string, TaskSortMode>>(
    () => new Map(),
  );

  const state = React.useMemo<FolderSortState>(() => ({ byFolderId }), [byFolderId]);

  const actions = React.useMemo<FolderSortActions>(
    () => ({
      setSortMode(folderId, mode) {
        setByFolderId((current) => new Map(current).set(folderId, mode));
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

/** Read every folder's stored sort choice. Throws outside a provider. */
export function useFolderSorts(): FolderSortState {
  return useStateValue('useFolderSorts');
}

/** Read the set-mode action. Throws outside a provider. */
export function useFolderSortActions(): FolderSortActions {
  return useActions('useFolderSortActions');
}

/** One folder's ordering: the mode it is showing, and the setter that changes it. */
export interface FolderSort {
  mode: TaskSortMode;
  setMode: (mode: TaskSortMode) => void;
}

/**
 * One folder's sort choice, falling through to {@link DEFAULT_TASK_SORT} until it is set. The
 * selector the folder view and its sort menu both read, so neither has to know the map shape.
 */
export function useFolderSort(folderId: string): FolderSort {
  const { byFolderId } = useFolderSorts();
  const { setSortMode } = useFolderSortActions();

  const setMode = React.useCallback(
    (mode: TaskSortMode) => {
      setSortMode(folderId, mode);
    },
    [setSortMode, folderId],
  );

  return { mode: byFolderId.get(folderId) ?? DEFAULT_TASK_SORT, setMode };
}
