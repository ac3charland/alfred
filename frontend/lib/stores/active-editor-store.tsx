'use client';

import * as React from 'react';

import { createContextPair } from '@/lib/stores/create-context-pair';

/**
 * Active-editor store — the single source of truth for which inline input is open.
 *
 * Across all task rows only ONE inline input may be open at a time: either the
 * title-edit text box on an item or the add-subtask entry box on a parent. They are
 * mutually exclusive, so opening one closes whatever was open before (any in-progress
 * title edit is abandoned without saving — only an explicit Save/Enter persists). The
 * Inbox hero capture box is exempt: it is never registered here and stays always-on.
 *
 * State and actions are split into two contexts so components that only open/close
 * (none today, but matching the folders/tasks stores) don't re-render on every change.
 */

/** Identifies one inline input: an item plus which of its inputs. `null` = none open. */
export interface ActiveEditor {
  itemId: string;
  kind: 'title' | 'subtask';
}

interface ActiveEditorActions {
  /** Open `editor` as the sole input, closing whatever was previously open. */
  openEditor: (editor: ActiveEditor) => void;
  /** Close `editor`, but only if it is the one currently open (a stale close no-ops). */
  closeEditor: (editor: ActiveEditor) => void;
}

/** True when `a` points at the same item + input as `b`. */
export function sameEditor(a: ActiveEditor | null, b: ActiveEditor): boolean {
  return a !== null && a.itemId === b.itemId && a.kind === b.kind;
}

// `undefined` is the "no provider" sentinel; `null` is the valid "nothing open" state.
const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  ActiveEditor | null,
  ActiveEditorActions
>('an ActiveEditorProvider');

export function ActiveEditorProvider({ children }: { children: React.ReactNode }) {
  const [activeEditor, setActiveEditor] = React.useState<ActiveEditor | null>(null);

  const actions = React.useMemo<ActiveEditorActions>(
    () => ({
      openEditor(editor) {
        setActiveEditor(editor);
      },
      closeEditor(editor) {
        // Functional update so a save resolving after another input already took over
        // (an out-of-order close) leaves the new input untouched.
        setActiveEditor((current) => (sameEditor(current, editor) ? null : current));
      },
    }),
    [],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={activeEditor}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

/** Read the active editor (or null when none is open). Throws outside a provider. */
export function useActiveEditor(): ActiveEditor | null {
  return useStateValue('useActiveEditor');
}

/** Read the open/close actions. Throws outside a provider. */
export function useActiveEditorActions(): ActiveEditorActions {
  return useActions('useActiveEditorActions');
}
