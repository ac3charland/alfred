'use client';

import * as React from 'react';

import * as api from '@/lib/api-client';
import type { ItemNode } from '@/lib/tree';
import {
  findNode,
  getDescendantIds,
  insertChild,
  insertRoot,
  insertSubtree,
  makeOptimisticItem,
  removeNode,
  updateNode,
} from '@/lib/tree';
import type { Item } from '@/lib/types';

/**
 * Tasks store — the central, optimistic source of truth for one route's task forest.
 *
 * The tree is scoped per route (inbox / folder / completed), so this provider lives
 * in each page and is seeded from that page's server-built tree. Mutations edit the
 * tree instantly and reconcile with the server row(s), rolling back on error.
 *
 * Removal semantics match the scoped views: completing, moving, or deleting a task
 * takes it out of the current list immediately (it has left this scope). State and
 * actions are split into two contexts so the recursive TaskRow tree doesn't re-render
 * from action-only consumers.
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
  /** Complete a task and its subtree, removing it from this scope. */
  completeTask: (id: string) => Promise<void>;
  /** Reactivate a completed task, removing it from the completed scope. */
  uncompleteTask: (id: string) => Promise<void>;
  /** Optimistically patch a task's editable fields, rolling back on failure. */
  updateTask: (id: string, patch: TaskFieldPatch) => Promise<void>;
  /** Move a task (and its subtree) to a folder, or to the Inbox when null. */
  moveTask: (id: string, folderId: string | null) => Promise<void>;
  /** Delete a task and its subtree. */
  deleteTask: (id: string) => Promise<void>;
}

type TaskAction =
  | { type: 'insertRoot'; node: ItemNode }
  | { type: 'insertChild'; parentId: string; node: ItemNode }
  | { type: 'patch'; id: string; patch: Partial<Item> }
  | { type: 'replace'; id: string; item: Item }
  | { type: 'remove'; id: string }
  | { type: 'restore'; removed: ItemNode; parentId: string | null; index: number };

function assertNever(value: never): never {
  throw new Error(`Unhandled task action: ${JSON.stringify(value)}`);
}

/**
 * Pure reducer over the task forest, delegating to the lib/tree helpers. `patch` and
 * `replace` are no-ops when the id is absent (the race rule); `replace` keeps the
 * node's locally-accumulated children (the reconcile invariant).
 */
export function tasksReducer(state: ItemNode[], action: TaskAction): ItemNode[] {
  switch (action.type) {
    case 'insertRoot': {
      return insertRoot(state, action.node);
    }
    case 'insertChild': {
      return insertChild(state, action.parentId, action.node);
    }
    case 'patch': {
      return updateNode(state, action.id, action.patch);
    }
    case 'replace': {
      return updateNode(state, action.id, action.item);
    }
    case 'remove': {
      return removeNode(state, action.id).forest;
    }
    case 'restore': {
      return insertSubtree(state, action.removed, action.parentId, action.index);
    }
    default: {
      return assertNever(action);
    }
  }
}

const TasksStateContext = React.createContext<ItemNode[] | undefined>(undefined);
const TasksActionsContext = React.createContext<TaskActions | undefined>(undefined);

export function TasksProvider({
  initialTasks,
  children,
}: {
  initialTasks: ItemNode[];
  children: React.ReactNode;
}) {
  const [tasks, dispatch] = React.useReducer(tasksReducer, initialTasks);

  // Latest forest, readable inside the stable action closures so they can capture the
  // pre-mutation subtree + position for rollback without going stale. Synced via an
  // effect (not a render-body write, which react-hooks/refs forbids); actions fire
  // from user events after commit, so the ref is current by the time they run.
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
        dispatch(
          parentId === undefined
            ? { type: 'insertRoot', node: optimistic }
            : { type: 'insertChild', parentId, node: optimistic },
        );
        try {
          const saved = await api.createItem(createInput);
          dispatch({ type: 'replace', id: optimistic.id, item: saved });
        } catch (error) {
          dispatch({ type: 'remove', id: optimistic.id });
          throw error;
        }
      },
      async completeTask(id) {
        const { removed, parentId, index } = removeNode(tasksRef.current, id);
        if (removed === undefined) return;
        dispatch({ type: 'remove', id });
        try {
          await api.completeTask(id);
        } catch (error) {
          dispatch({ type: 'restore', removed, parentId, index });
          throw error;
        }
      },
      async uncompleteTask(id) {
        const { removed, parentId, index } = removeNode(tasksRef.current, id);
        if (removed === undefined) return;
        dispatch({ type: 'remove', id });
        try {
          await api.updateItem(id, { status: 'active' });
        } catch (error) {
          dispatch({ type: 'restore', removed, parentId, index });
          throw error;
        }
      },
      async updateTask(id, patch) {
        const previous = findNode(tasksRef.current, id);
        dispatch({ type: 'patch', id, patch });
        try {
          const saved = await api.updateItem(id, patch);
          dispatch({ type: 'replace', id, item: saved });
        } catch (error) {
          if (previous) {
            const rollback: Partial<Item> = {};
            for (const key of Object.keys(patch)) {
              (rollback as Record<string, unknown>)[key] = previous[key as keyof Item];
            }
            dispatch({ type: 'patch', id, patch: rollback });
          }
          throw error;
        }
      },
      async moveTask(id, folderId) {
        const { removed, parentId, index } = removeNode(tasksRef.current, id);
        if (removed === undefined) return;
        const ids = [id, ...getDescendantIds(removed)];
        dispatch({ type: 'remove', id });
        try {
          await Promise.all(
            ids.map((itemId) =>
              folderId === null
                ? api.moveToInbox(itemId)
                : api.updateItem(itemId, { folder_id: folderId }),
            ),
          );
        } catch (error) {
          dispatch({ type: 'restore', removed, parentId, index });
          throw error;
        }
      },
      async deleteTask(id) {
        const { removed, parentId, index } = removeNode(tasksRef.current, id);
        if (removed === undefined) return;
        dispatch({ type: 'remove', id });
        try {
          await api.deleteItem(id);
        } catch (error) {
          dispatch({ type: 'restore', removed, parentId, index });
          throw error;
        }
      },
    }),
    [],
  );

  return (
    <TasksActionsContext.Provider value={actions}>
      <TasksStateContext.Provider value={tasks}>{children}</TasksStateContext.Provider>
    </TasksActionsContext.Provider>
  );
}

/** Read the current task forest. Throws if used outside a TasksProvider. */
export function useTasks(): ItemNode[] {
  const context = React.useContext(TasksStateContext);
  if (context === undefined) {
    throw new Error('useTasks must be used within a TasksProvider');
  }
  return context;
}

/** Read the task mutation actions. Throws if used outside a TasksProvider. */
export function useTaskActions(): TaskActions {
  const context = React.useContext(TasksActionsContext);
  if (context === undefined) {
    throw new Error('useTaskActions must be used within a TasksProvider');
  }
  return context;
}
