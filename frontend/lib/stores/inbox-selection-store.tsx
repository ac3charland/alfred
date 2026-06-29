'use client';

import * as React from 'react';

import { createContextPair } from '@/lib/stores/create-context-pair';

/**
 * Inbox-selection store — the cross-row state for the Inbox's multi-edit mode.
 *
 * Multi-select is a cross-row interaction no single row can own: an action bar must read the
 * whole set at once, and "Done"/"Cancel" must clear every row together. So an explicit
 * `active` flag plus the set of selected ids live here, mirroring ExpansionProvider — mounted
 * once in the shell, seeded with no server data, split into state + actions contexts so the
 * actions-only callers don't re-render on every toggle.
 *
 * The set only ever holds ROOT Inbox item ids (the rows TaskList renders at the inbox scope);
 * subtask selection is out of scope. Rows read `selectedIds.has(id)` from the state context so
 * they re-render on toggle; `prune` drops ids no longer in the Inbox (an item that left it).
 */

export interface InboxSelectionState {
  /** Is select mode on? */
  active: boolean;
  /** The ids of the selected root Inbox items. */
  selectedIds: ReadonlySet<string>;
}

interface InboxSelectionActions {
  /** Turn select mode on, starting from an empty selection (Idle → Selecting·0). */
  enter: () => void;
  /** Turn select mode off and clear the selection (Done / Cancel / Esc). */
  exit: () => void;
  /** Add the id if absent, remove it if present (a row click). */
  toggle: (id: string) => void;
  /** Empty the selection but stay in select mode. */
  clear: () => void;
  /** Keep only the ids still valid (e.g. still in the Inbox); same set when nothing changes. */
  prune: (validIds: Iterable<string>) => void;
}

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  InboxSelectionState,
  InboxSelectionActions
>('an InboxSelectionProvider');

/** A new set with `id` toggled (added if absent, removed if present). */
function withToggled(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** A new set holding only the ids in `keep` — or the SAME set when nothing is dropped. */
function withOnly(set: ReadonlySet<string>, keep: ReadonlySet<string>): ReadonlySet<string> {
  const next = new Set<string>();
  let changed = false;
  for (const id of set) {
    if (keep.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : set;
}

/** The empty set, shared so clearing an already-empty selection keeps a stable reference. */
const EMPTY: ReadonlySet<string> = new Set();

export function InboxSelectionProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(EMPTY);

  const state = React.useMemo<InboxSelectionState>(
    () => ({ active, selectedIds }),
    [active, selectedIds],
  );

  const actions = React.useMemo<InboxSelectionActions>(
    () => ({
      enter() {
        setActive(true);
        setSelectedIds((current) => (current.size === 0 ? current : EMPTY));
      },
      exit() {
        setActive(false);
        setSelectedIds((current) => (current.size === 0 ? current : EMPTY));
      },
      toggle(id) {
        setSelectedIds((current) => withToggled(current, id));
      },
      clear() {
        setSelectedIds((current) => (current.size === 0 ? current : EMPTY));
      },
      prune(validIds) {
        const keep = new Set(validIds);
        setSelectedIds((current) => withOnly(current, keep));
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

/** Read the selection state (active flag + selected ids). Throws outside a provider. */
export function useInboxSelection(): InboxSelectionState {
  return useStateValue('useInboxSelection');
}

/** Read the selection actions. Throws outside a provider. */
export function useInboxSelectionActions(): InboxSelectionActions {
  return useActions('useInboxSelectionActions');
}
