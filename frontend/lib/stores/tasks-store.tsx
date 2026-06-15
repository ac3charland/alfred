'use client';

import * as React from 'react';

import * as api from '@/lib/api-client';
import type { ItemNode } from '@/lib/tree';
import { buildTree, collectSubtree, makeOptimisticItem } from '@/lib/tree';
import type { Item } from '@/lib/types';

/**
 * Tasks store — the central, optimistic source of truth for ALL items.
 *
 * The whole item set is held flat in one provider (mounted once at the layout, like
 * folders) and seeded from `getAllItems()`. Each view derives its own forest by filtering
 * this list (`useScopedTasks`), so there is no per-page fetch or re-seeding. Mutations edit
 * the flat list instantly and reconcile with the server row(s), rolling back on error.
 *
 * State and actions are split into two contexts so components that only mutate don't
 * re-render when the list changes.
 */

interface AddTaskInput {
  text: string;
  // Explicit `| undefined` so callers may pass through an absent folder/parent prop
  // directly under exactOptionalPropertyTypes.
  folderId?: string | null | undefined;
  parentId?: string | null | undefined;
}

/** The inline-editable scalar fields of a task (title, due date, notes). */
type TaskFieldPatch = Pick<api.UpdateItemInput, 'title' | 'due_date' | 'notes'>;

interface TaskActions {
  /** Optimistically add a task (root or subtask), then reconcile with the saved row. */
  addTask: (input: AddTaskInput) => Promise<void>;
  /** Complete a task and its subtree (status → completed), then reconcile. */
  completeTask: (id: string) => Promise<void>;
  /** Reactivate a completed task (status → active). */
  uncompleteTask: (id: string) => Promise<void>;
  /** Optimistically patch a task's editable fields, rolling back on failure. */
  updateTask: (id: string, patch: TaskFieldPatch) => Promise<void>;
  /**
   * Classify an inbox item by flipping its `item_type` (the §7.1 inbox-triage gate).
   * Its own action — not part of `TaskFieldPatch` — so only this deliberate control may
   * change the type. An `unclassified` row is always free of task-only fields (the §4.6
   * DB CHECK), so the flip is a bare `item_type` patch that clears nothing; reconciles /
   * rolls back exactly like `updateTask`.
   */
  classifyItem: (id: string, itemType: 'task' | 'code') => Promise<void>;
  /** Move a task (and its subtree) to a folder, or to the Inbox when null. */
  moveTask: (id: string, folderId: string | null) => Promise<void>;
  /**
   * Re-parent a task. With a `newParentId`, nest it under that task and have its whole
   * subtree adopt the new parent's folder (a subtree shares one folder bucket). With
   * `null`, promote it to a top-level task (clear `parent_id`, keep its current folder).
   * No-ops on any move that would create a cycle (onto itself or one of its descendants).
   */
  reparentTask: (id: string, newParentId: string | null) => Promise<void>;
  /** Delete a task and its subtree (the DB cascades the children). */
  deleteTask: (id: string) => Promise<void>;
}

type TaskAction =
  | { type: 'insert'; item: Item }
  | { type: 'replace'; id: string; item: Item }
  | { type: 'patch'; ids: string[]; patch: Partial<Item> }
  | { type: 'upsert'; items: Item[] }
  | { type: 'remove'; ids: string[] };

function assertNever(value: never): never {
  throw new Error(`Unhandled task action: ${JSON.stringify(value)}`);
}

/**
 * Pure reducer over the flat item list.
 * - `replace` swaps a single item by id (temp → server); no-op if absent.
 * - `patch` shallow-merges `patch` into every item in `ids` (single edit or cascade); the
 *   race rule falls out for free — ids no longer present are skipped.
 * - `upsert` replaces present items by id and appends any missing ones: it serves both
 *   reconcile-many (server rows) and rollback (re-apply the captured originals).
 * - `remove` drops every item in `ids`.
 */
export function tasksReducer(state: Item[], action: TaskAction): Item[] {
  switch (action.type) {
    case 'insert': {
      return [...state, action.item];
    }
    case 'replace': {
      return state.map((item) => (item.id === action.id ? action.item : item));
    }
    case 'patch': {
      const ids = new Set(action.ids);
      return state.map((item) => (ids.has(item.id) ? { ...item, ...action.patch } : item));
    }
    case 'upsert': {
      const byId = new Map(action.items.map((item) => [item.id, item] as const));
      const replaced = state.map((item) => byId.get(item.id) ?? item);
      const presentIds = new Set(state.map((item) => item.id));
      const added = action.items.filter((item) => !presentIds.has(item.id));
      return [...replaced, ...added];
    }
    case 'remove': {
      const ids = new Set(action.ids);
      return state.filter((item) => !ids.has(item.id));
    }
    default: {
      return assertNever(action);
    }
  }
}

const TasksStateContext = React.createContext<Item[] | undefined>(undefined);
const TasksActionsContext = React.createContext<TaskActions | undefined>(undefined);

export function TasksProvider({
  initialTasks,
  children,
}: {
  initialTasks: Item[];
  children: React.ReactNode;
}) {
  const [tasks, dispatch] = React.useReducer(tasksReducer, initialTasks);

  // Latest list, readable inside the stable action closures so they can capture the
  // pre-mutation rows for rollback without going stale. Synced via an effect (not a
  // render-body write, which react-hooks/refs forbids); actions fire from user events
  // after commit, so the ref is current by the time they run.
  const tasksRef = React.useRef(tasks);
  React.useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const actions = React.useMemo<TaskActions>(
    () => ({
      async addTask(input) {
        const folderId = input.folderId ?? undefined;
        const parentId = input.parentId ?? undefined;
        const createInput: api.CreateItemInput = {
          text: input.text,
          raw_capture: input.text,
          item_type: 'unclassified',
          ...(folderId !== undefined && { folder_id: folderId }),
          ...(parentId !== undefined && { parent_id: parentId }),
        };
        const optimistic = makeOptimisticItem(createInput);
        dispatch({ type: 'insert', item: optimistic });
        try {
          const saved = await api.createItem(createInput);
          dispatch({ type: 'replace', id: optimistic.id, item: saved });
        } catch (error) {
          dispatch({ type: 'remove', ids: [optimistic.id] });
          throw error;
        }
      },
      async completeTask(id) {
        const affected = collectSubtree(tasksRef.current, id);
        if (affected.length === 0) return;
        const ids = affected.map((item) => item.id);
        dispatch({
          type: 'patch',
          ids,
          patch: { status: 'completed', completed_at: new Date().toISOString() },
        });
        try {
          const rows = await api.completeTask(id);
          dispatch({ type: 'upsert', items: rows });
        } catch (error) {
          dispatch({ type: 'upsert', items: affected });
          throw error;
        }
      },
      async uncompleteTask(id) {
        // Reactivate this task AND its contiguous chain of completed ancestors: a completed
        // parent can't have an active child (the inverse of cascade completion). Walk up
        // while each ancestor is completed, stopping at the first active ancestor (or root).
        const byId = new Map(tasksRef.current.map((item) => [item.id, item] as const));
        const affected: Item[] = [];
        let current = byId.get(id);
        while (current?.status === 'completed') {
          affected.push(current);
          current = current.parent_id === null ? undefined : byId.get(current.parent_id);
        }
        if (affected.length === 0) return;
        const ids = affected.map((item) => item.id);
        dispatch({ type: 'patch', ids, patch: { status: 'active', completed_at: null } });
        try {
          const rows = await Promise.all(
            ids.map((itemId) => api.updateItem(itemId, { status: 'active' })),
          );
          dispatch({ type: 'upsert', items: rows });
        } catch (error) {
          dispatch({ type: 'upsert', items: affected });
          throw error;
        }
      },
      async updateTask(id, patch) {
        const previous = tasksRef.current.find((item) => item.id === id);
        dispatch({ type: 'patch', ids: [id], patch });
        try {
          const saved = await api.updateItem(id, patch);
          dispatch({ type: 'upsert', items: [saved] });
        } catch (error) {
          if (previous) dispatch({ type: 'upsert', items: [previous] });
          throw error;
        }
      },
      async classifyItem(id, itemType) {
        const previous = tasksRef.current.find((item) => item.id === id);
        dispatch({ type: 'patch', ids: [id], patch: { item_type: itemType } });
        try {
          const saved = await api.updateItem(id, { item_type: itemType });
          dispatch({ type: 'upsert', items: [saved] });
        } catch (error) {
          if (previous) dispatch({ type: 'upsert', items: [previous] });
          throw error;
        }
      },
      async moveTask(id, folderId) {
        const affected = collectSubtree(tasksRef.current, id);
        // Stryker disable next-line ConditionalExpression: AT_CEILING — empty subtree → ids=[], so Promise.all maps over [] (zero API calls) and the dispatches are no-ops; identical to the early return. (completeTask/deleteTask call the API unconditionally, so their guards stay killable.)
        if (affected.length === 0) return;
        const ids = affected.map((item) => item.id);
        dispatch({ type: 'patch', ids, patch: { folder_id: folderId } });
        try {
          const rows = await Promise.all(
            ids.map((itemId) =>
              folderId === null
                ? api.moveToInbox(itemId)
                : api.updateItem(itemId, { folder_id: folderId }),
            ),
          );
          dispatch({ type: 'upsert', items: rows });
        } catch (error) {
          dispatch({ type: 'upsert', items: affected });
          throw error;
        }
      },
      async reparentTask(id, newParentId) {
        const current = tasksRef.current;
        const dragged = current.find((item) => item.id === id);
        if (dragged === undefined) return;
        const affected = collectSubtree(current, id);
        // A task can't become its own parent, nor a child of one of its own descendants —
        // either makes a cycle that buildTree drops, so the subtree silently vanishes (and
        // the bad parent_id persists). `affected` is the dragged item PLUS its descendants,
        // so one membership check rejects both self and descendant targets. Guarding here,
        // at the source of truth, keeps any caller (a stale drag target, a future feature)
        // from corrupting the tree regardless of UI-level checks.
        if (newParentId !== null && affected.some((item) => item.id === newParentId)) return;

        // Promote to a top-level task: clear parent_id, keep the current folder.
        if (newParentId === null) {
          if (dragged.parent_id === null) return; // already a root — nothing to do
          dispatch({ type: 'patch', ids: [id], patch: { parent_id: null } });
          try {
            const saved = await api.updateItem(id, { parent_id: null });
            dispatch({ type: 'upsert', items: [saved] });
          } catch (error) {
            dispatch({ type: 'upsert', items: [dragged] });
            throw error;
          }
          return;
        }

        const newParent = current.find((item) => item.id === newParentId);
        // The target may have just been deleted/reconciled away.
        if (newParent === undefined) return;
        const newFolderId = newParent.folder_id;
        // Moving under a parent in a different folder drags the whole subtree's folder
        // along; staying in the same folder is a pure parent change (no descendant writes).
        const folderChanged = dragged.folder_id !== newFolderId;
        const descendantIds = affected.filter((item) => item.id !== id).map((item) => item.id);

        dispatch({
          type: 'patch',
          ids: [id],
          patch: { parent_id: newParentId, folder_id: newFolderId },
        });
        if (folderChanged && descendantIds.length > 0) {
          dispatch({ type: 'patch', ids: descendantIds, patch: { folder_id: newFolderId } });
        }
        try {
          const requests = [api.updateItem(id, { parent_id: newParentId, folder_id: newFolderId })];
          if (folderChanged) {
            for (const descId of descendantIds) {
              requests.push(api.updateItem(descId, { folder_id: newFolderId }));
            }
          }
          const rows = await Promise.all(requests);
          dispatch({ type: 'upsert', items: rows });
        } catch (error) {
          dispatch({ type: 'upsert', items: affected });
          throw error;
        }
      },
      async deleteTask(id) {
        const affected = collectSubtree(tasksRef.current, id);
        if (affected.length === 0) return;
        dispatch({ type: 'remove', ids: affected.map((item) => item.id) });
        try {
          await api.deleteItem(id);
        } catch (error) {
          dispatch({ type: 'upsert', items: affected });
          throw error;
        }
      },
    }),
    // Stryker disable next-line ArrayDeclaration: AT_CEILING — a non-empty literal dep array holds a constant string that is Object.is-equal every render, so React never recomputes this memo; identical to [].
    [],
  );

  return (
    <TasksActionsContext.Provider value={actions}>
      <TasksStateContext.Provider value={tasks}>{children}</TasksStateContext.Provider>
    </TasksActionsContext.Provider>
  );
}

/** The view a TaskList renders. Serializable so Server Components can pass it as a prop. */
export type TaskScope =
  | { type: 'inbox' }
  | { type: 'folder'; folderId: string }
  | { type: 'completed' };

/** Read the full (flat) item list. Throws if used outside a TasksProvider. */
export function useTasks(): Item[] {
  const context = React.useContext(TasksStateContext);
  if (context === undefined) {
    throw new Error('useTasks must be used within a TasksProvider');
  }
  return context;
}

/** Derive the forest for one view by filtering the store, then building the tree. */
export function useScopedTasks(scope: TaskScope): ItemNode[] {
  const items = useTasks();
  const scopeType = scope.type;
  // Stryker disable next-line ConditionalExpression: AT_CEILING — folderId is only read inside the scopeType==='folder' filter branch; for inbox/completed it is unused, so null vs undefined is unobservable.
  const folderId = scope.type === 'folder' ? scope.folderId : null;
  return React.useMemo(() => {
    const filtered = items.filter((item) => {
      if (scopeType === 'completed') return item.status === 'completed';
      // Active views (inbox / folder) keep BOTH active and completed items in scope so a
      // parent's completed children render under it (revealed by "Show completed"). A
      // subtree shares one folder bucket (moveTask cascades folder_id), so filtering by
      // folder alone keeps each subtree intact for buildTree.
      // Stryker disable next-line ConditionalExpression: AT_CEILING — for inbox, folderId is null, so `folder_id === folderId` equals the inbox filter `folder_id === null`; completed is handled above, so forcing this branch true changes nothing.
      if (scopeType === 'folder') return item.folder_id === folderId;
      return item.folder_id === null; // inbox
    });
    const forest = buildTree(filtered);
    if (scopeType === 'completed') return forest;
    // A completed ROOT belongs to the Completed view, not here — drop it (and its subtree).
    // Completed items only surface in an active view as descendants of an active task.
    return forest.filter((node) => node.status === 'active');
  }, [items, scopeType, folderId]);
}

/** Read the task mutation actions. Throws if used outside a TasksProvider. */
export function useTaskActions(): TaskActions {
  const context = React.useContext(TasksActionsContext);
  if (context === undefined) {
    throw new Error('useTaskActions must be used within a TasksProvider');
  }
  return context;
}
