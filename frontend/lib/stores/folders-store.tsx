'use client';

import * as React from 'react';

import { createFolder, deleteFolder, updateFolder } from '@/lib/api-client';
import { TEMP_ID_PREFIX } from '@/lib/tree';
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

function assertNever(value: never): never {
  throw new Error(`Unhandled folder action: ${JSON.stringify(value)}`);
}

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
      const at = Math.max(0, Math.min(action.index, state.length));
      return [...state.slice(0, at), action.folder, ...state.slice(at)];
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
      return assertNever(action);
    }
  }
}

function makeOptimisticFolder(name: string): Folder {
  return {
    id: `${TEMP_ID_PREFIX}${crypto.randomUUID()}`,
    name,
    created_at: new Date().toISOString(),
  };
}

const FoldersStateContext = React.createContext<Folder[] | undefined>(undefined);
const FoldersActionsContext = React.createContext<FolderActions | undefined>(undefined);

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

  const actions = React.useMemo<FolderActions>(
    () => ({
      async addFolder(name) {
        const optimistic = makeOptimisticFolder(name);
        dispatch({ type: 'insert', folder: optimistic });
        try {
          const saved = await createFolder(name);
          dispatch({ type: 'replace', id: optimistic.id, folder: saved });
        } catch (error) {
          dispatch({ type: 'remove', id: optimistic.id });
          throw error;
        }
      },
      async renameFolder(id, name) {
        const previous = foldersRef.current.find((folder) => folder.id === id);
        dispatch({ type: 'patch', id, patch: { name } });
        try {
          const saved = await updateFolder(id, name);
          dispatch({ type: 'replace', id, folder: saved });
        } catch (error) {
          if (previous) dispatch({ type: 'patch', id, patch: { name: previous.name } });
          throw error;
        }
      },
      async removeFolder(id) {
        const current = foldersRef.current;
        const index = current.findIndex((folder) => folder.id === id);
        const previous = current[index];
        dispatch({ type: 'remove', id });
        try {
          await deleteFolder(id);
        } catch (error) {
          if (previous) dispatch({ type: 'insertAt', folder: previous, index });
          throw error;
        }
      },
    }),
    [],
  );

  return (
    <FoldersActionsContext.Provider value={actions}>
      <FoldersStateContext.Provider value={folders}>{children}</FoldersStateContext.Provider>
    </FoldersActionsContext.Provider>
  );
}

/** Read the current folder list. Throws if used outside a FoldersProvider. */
export function useFolders(): Folder[] {
  const context = React.useContext(FoldersStateContext);
  if (context === undefined) {
    throw new Error('useFolders must be used within a FoldersProvider');
  }
  return context;
}

/** Read the folder mutation actions. Throws if used outside a FoldersProvider. */
export function useFolderActions(): FolderActions {
  const context = React.useContext(FoldersActionsContext);
  if (context === undefined) {
    throw new Error('useFolderActions must be used within a FoldersProvider');
  }
  return context;
}
