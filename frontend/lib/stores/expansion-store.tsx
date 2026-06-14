'use client';

import * as React from 'react';

/**
 * Expansion store — the single source of truth for which task rows are expanded.
 *
 * A row's expansion is a cross-row invariant: a "Collapse all" header button must close
 * every open row in a view at once, which no single row's local `useState` can express.
 * So the two child-disclosure flags — a row's subtask tree and its "Show completed"
 * sub-panel — live here instead of per-row. Rows READ their flags from this store
 * (`subtasks.has(id)` / `completed.has(id)`) and CALL its actions to change them; the
 * collapse button calls `collapseAll(viewIds)`.
 *
 * Like ActiveEditorProvider, it is mounted in the layout and seeded with NO server data
 * (expansion is ephemeral session UI, not DB-backed). State and actions are split into
 * two contexts so the actions-only collapse button doesn't re-render on every expand.
 */

export interface ExpansionState {
  /** Ids of rows whose subtask tree is open. */
  subtasks: ReadonlySet<string>;
  /** Ids of rows whose completed-children sub-panel is open. */
  completed: ReadonlySet<string>;
}

interface ExpansionActions {
  /** Flip a row's subtask tree open/closed (the chevron). */
  toggleSubtasks: (id: string) => void;
  /** Ensure a row's subtask tree is open (idempotent) — used when adding a subtask. */
  expandSubtasks: (id: string) => void;
  /** Flip a row's completed-children sub-panel open/closed. */
  toggleCompleted: (id: string) => void;
  /**
   * Collapse the given ids' subtask trees AND completed panels in one move. The collapse
   * button passes the current view's ids, so collapsing in one view leaves others alone.
   */
  collapseAll: (ids: Iterable<string>) => void;
}

const ExpansionStateContext = React.createContext<ExpansionState | undefined>(undefined);
const ExpansionActionsContext = React.createContext<ExpansionActions | undefined>(undefined);

/** A new set with `id` toggled (added if absent, removed if present). */
function withToggled(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** A new set with every id in `remove` dropped — or the SAME set when nothing changes. */
function withoutIds(set: ReadonlySet<string>, remove: ReadonlySet<string>): ReadonlySet<string> {
  const next = new Set<string>();
  let changed = false;
  for (const id of set) {
    if (remove.has(id)) changed = true;
    else next.add(id);
  }
  return changed ? next : set;
}

export function ExpansionProvider({ children }: { children: React.ReactNode }) {
  const [subtasks, setSubtasks] = React.useState<ReadonlySet<string>>(() => new Set());
  const [completed, setCompleted] = React.useState<ReadonlySet<string>>(() => new Set());

  const state = React.useMemo<ExpansionState>(
    () => ({ subtasks, completed }),
    [subtasks, completed],
  );

  const actions = React.useMemo<ExpansionActions>(
    () => ({
      toggleSubtasks(id) {
        setSubtasks((current) => withToggled(current, id));
      },
      expandSubtasks(id) {
        // Idempotent open: return the same set when already open so an open row doesn't
        // re-render (and a no-op add-subtask click doesn't churn the store).
        setSubtasks((current) => (current.has(id) ? current : new Set(current).add(id)));
      },
      toggleCompleted(id) {
        setCompleted((current) => withToggled(current, id));
      },
      collapseAll(ids) {
        const remove = new Set(ids);
        setSubtasks((current) => withoutIds(current, remove));
        setCompleted((current) => withoutIds(current, remove));
      },
    }),
    [],
  );

  return (
    <ExpansionActionsContext.Provider value={actions}>
      <ExpansionStateContext.Provider value={state}>{children}</ExpansionStateContext.Provider>
    </ExpansionActionsContext.Provider>
  );
}

/** Read which rows are expanded. Throws outside a provider. */
export function useExpansion(): ExpansionState {
  const context = React.useContext(ExpansionStateContext);
  if (context === undefined) {
    throw new Error('useExpansion must be used within an ExpansionProvider');
  }
  return context;
}

/** Read the expand/collapse actions. Throws outside a provider. */
export function useExpansionActions(): ExpansionActions {
  const context = React.useContext(ExpansionActionsContext);
  if (context === undefined) {
    throw new Error('useExpansionActions must be used within an ExpansionProvider');
  }
  return context;
}
