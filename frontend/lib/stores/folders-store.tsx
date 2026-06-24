'use client';

import * as React from 'react';

import { createFolder, deleteFolder, updateFolder } from '@/lib/api-client';
import { assertNever } from '@/lib/stores/assert-never';
import { createContextPair } from '@/lib/stores/create-context-pair';
import { runOptimisticMutation } from '@/lib/stores/optimistic-mutation';
import { insertAt } from '@/lib/stores/reducer-actions';
import { useToastActions } from '@/lib/stores/toast-store';
import { makeOptimisticFolder } from '@/lib/tree';
import type { Folder } from '@/lib/types';

/**
 * Folders store — the central, optimistic source of truth for the folder list.
 *
 * Folders are global across the (tasks) group, so this provider lives in the layout
 * and is seeded ONCE from server-fetched data; it is then authoritative for the
 * session (single-user, no realtime — a hard reload re-seeds). Mutations update the
 * list instantly and reconcile with the server row, rolling back on error.
 *
 * State and actions are split into two contexts so components that only mutate
 * (and never read the list) don't re-render when the list changes.
 */

interface FolderActions {
  /** Optimistically add a folder, then reconcile with the saved row. */
  addFolder: (name: string) => Promise<void>;
  /** Optimistically rename a folder, rolling back the name on failure. */
  renameFolder: (id: string, name: string) => Promise<void>;
  /** Optimistically remove a folder, restoring it at its position on failure. */
  removeFolder: (id: string) => Promise<void>;
}

type FolderAction =
  | { type: 'insert'; folder: Folder }
  | { type: 'insertAt'; folder: Folder; index: number }
  | { type: 'replace'; id: string; folder: Folder }
  | { type: 'patch'; id: string; patch: Partial<Folder> }
  | { type: 'remove'; id: string };

/**
 * Pure reducer over the folder list. `replace`/`patch` are no-ops when the id is
 * absent — the race rule: a reconcile for a folder already removed adds nothing back.
 */
export function foldersReducer(state: Folder[], action: FolderAction): Folder[] {
  switch (action.type) {
    case 'insert': {
      return [...state, action.folder];
    }
    case 'insertAt': {
      return insertAt(state, action.folder, action.index);
    }
    case 'replace': {
      return state.map((folder) => (folder.id === action.id ? action.folder : folder));
    }
    case 'patch': {
      return state.map((folder) =>
        folder.id === action.id ? { ...folder, ...action.patch } : folder,
      );
    }
    case 'remove': {
      return state.filter((folder) => folder.id !== action.id);
    }
    default: {
      return assertNever(action, 'folder action');
    }
  }
}

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  Folder[],
  FolderActions
>('a FoldersProvider');

export function FoldersProvider({
  initialFolders,
  children,
}: {
  initialFolders: Folder[];
  children: React.ReactNode;
}) {
  const [folders, dispatch] = React.useReducer(foldersReducer, initialFolders);

  // Latest state, readable inside the stable (never-rebuilt) action closures so they
  // can capture pre-mutation values for rollback without going stale. Synced via an
  // effect (not a render-body write, which react-hooks/refs forbids); actions fire
  // from user events after commit, so the ref is current by the time they run.
  const foldersRef = React.useRef(folders);
  React.useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);

  // Surface a failed write as a toast (ALF-33). Captured through a ref synced by an effect so
  // the stable (`[]`) action closures can fire it without it being a dep — mirrors `foldersRef`.
  // ToastProvider is mounted above this store in the shell layout, so the hook resolves here.
  const { showToast } = useToastActions();
  const showToastRef = React.useRef(showToast);
  React.useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const actions = React.useMemo<FolderActions>(
    () => ({
      async addFolder(name) {
        const optimistic = makeOptimisticFolder(name);
        await runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'insert', folder: optimistic });
          },
          apiCall: () => createFolder(name),
          reconcile: (saved) => {
            dispatch({ type: 'replace', id: optimistic.id, folder: saved });
          },
          rollback: () => {
            dispatch({ type: 'remove', id: optimistic.id });
          },
          onError: () => {
            showToastRef.current("Couldn't create folder");
          },
        });
      },
      async renameFolder(id, name) {
        const previous = foldersRef.current.find((folder) => folder.id === id);
        await runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'patch', id, patch: { name } });
          },
          apiCall: () => updateFolder(id, name),
          reconcile: (saved) => {
            dispatch({ type: 'replace', id, folder: saved });
          },
          rollback: () => {
            if (previous) dispatch({ type: 'patch', id, patch: { name: previous.name } });
          },
          onError: () => {
            showToastRef.current("Couldn't rename folder");
          },
        });
      },
      async removeFolder(id) {
        const current = foldersRef.current;
        const index = current.findIndex((folder) => folder.id === id);
        const previous = current[index];
        // No reconcile — the folder is gone on success.
        await runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'remove', id });
          },
          apiCall: () => deleteFolder(id),
          rollback: () => {
            if (previous) dispatch({ type: 'insertAt', folder: previous, index });
          },
          onError: () => {
            showToastRef.current("Couldn't delete folder");
          },
        });
      },
    }),
    // Stryker disable next-line ArrayDeclaration: AT_CEILING — a non-empty literal dep array holds a constant string that is Object.is-equal every render, so React never recomputes this memo; identical to [].
    [],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={folders}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

/** Read the current folder list. Throws if used outside a FoldersProvider. */
export function useFolders(): Folder[] {
  return useStateValue('useFolders');
}

/** Read the folder mutation actions. Throws if used outside a FoldersProvider. */
export function useFolderActions(): FolderActions {
  return useActions('useFolderActions');
}
