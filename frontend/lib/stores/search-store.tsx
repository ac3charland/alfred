'use client';

import * as React from 'react';

import { createContextPair } from '@/lib/stores/create-context-pair';

/**
 * Search store — the tiny shared state behind the top-bar global search: the live `query`
 * and whether the results dropdown is `open`. It's a store (not local `SearchBox` state) so
 * the desktop header field and the mobile hamburger field stay in sync and the ⌘P shortcut has
 * one place to drive. Mounted once in the shell, around `AppShell`.
 *
 * State and actions are split into two contexts (the house pattern) so a mutate-only consumer
 * doesn't re-render when the query changes.
 */
export interface SearchState {
  query: string;
  /** Whether the results dropdown is showing (it opens on focus / typing). */
  open: boolean;
}

export interface SearchActions {
  /** Set the query; typing also opens the dropdown. */
  setQuery: (query: string) => void;
  /** Open the dropdown (on focus) without touching the query. */
  openDropdown: () => void;
  /** Close the dropdown AND clear the query, so each fresh focus starts empty. */
  closeDropdown: () => void;
}

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  SearchState,
  SearchActions
>('a SearchProvider');

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<SearchState>({ query: '', open: false });

  const actions = React.useMemo<SearchActions>(
    () => ({
      setQuery: (query) => {
        setState({ query, open: true });
      },
      openDropdown: () => {
        setState((current) => ({ ...current, open: true }));
      },
      closeDropdown: () => {
        setState({ query: '', open: false });
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

/** Read the search state (query + open). Throws outside a SearchProvider. */
export function useSearch(): SearchState {
  return useStateValue('useSearch');
}

/** Read the search actions. Throws outside a SearchProvider. */
export function useSearchActions(): SearchActions {
  return useActions('useSearchActions');
}
