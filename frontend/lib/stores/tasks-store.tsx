'use client';

import * as React from 'react';

import * as api from '@/lib/api-client';
import { isDueTodayOrOverdue } from '@/lib/date-utils';
import { rankByPriority, sortNodesByPriority } from '@/lib/priority';
import { nextOccurrence, parseRecurrenceRule } from '@/lib/recurrence';
import { createContextPair } from '@/lib/stores/create-context-pair';
import { runOptimisticMutation } from '@/lib/stores/optimistic-mutation';
import { type SimpleAction, simpleReducer } from '@/lib/stores/reducer-actions';
import { useToastActions } from '@/lib/stores/toast-store';
import type { ItemNode } from '@/lib/tree';
import { buildTree, collectSubtree, makeOptimisticItem, tempId } from '@/lib/tree';
import type { Item } from '@/lib/types';

/**
 * The optimistic next occurrence of a recurring task, or `null` when none should spawn
 * (the task isn't a recurring top-level task, has no due date, or its series has ended).
 * Mirrors the server's complete-and-spawn decision using the SAME engine, so the row shown
 * instantly matches the authoritative one the server returns. The spawned row is a copy of the
 * task with a temp id, the computed due date, and `occurrence_index + 1`; the server's
 * reconcile replaces it (and adds the reset subtree on the next full load).
 */
function computeOptimisticSpawn(root: Item): Item | null {
  if (root.parent_id !== null || root.item_type !== 'task') return null;
  if (root.due_date === null) return null;
  const rule = parseRecurrenceRule(root.recurrence);
  if (rule === null) return null;
  const index = root.occurrence_index ?? 1;
  const next = nextOccurrence(rule, root.due_date, index);
  if (next === null) return null;
  return {
    ...root,
    id: tempId(),
    due_date: next,
    occurrence_index: index + 1,
    status: 'active',
    completed_at: null,
    created_at: new Date().toISOString(),
  };
}

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

/** The inline-editable scalar fields of a task (title, due date, notes, recurrence, priority). */
type TaskFieldPatch = Pick<
  api.UpdateItemInput,
  'title' | 'due_date' | 'notes' | 'recurrence' | 'priority'
>;

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
   * Classify an inbox item by flipping its `item_type` (the inbox-triage gate).
   * Its own action — not part of `TaskFieldPatch` — so only this deliberate control may
   * change the type. An `unclassified` row is always free of task-only fields (the
   * DB CHECK), so the flip is a bare `item_type` patch that clears nothing; reconciles /
   * rolls back exactly like `updateTask`.
   */
  classifyItem: (id: string, itemType: 'task' | 'code') => Promise<void>;
  /** Move a task (and its subtree) to a folder, or to the Inbox when null. */
  moveTask: (id: string, folderId: string | null) => Promise<void>;
  /**
   * Bulk inbox-triage: classify a set of items by flipping each one's `item_type`. One
   * optimistic patch over the whole set, then the existing per-item route fanned out with
   * `Promise.allSettled` so a failure on one item doesn't abort the rest — saved items stay
   * applied, failed items roll back individually, and a toast reports the count that failed.
   * Resolves with the ids that FAILED (empty = full success), so the caller can keep just
   * those selected for a retry.
   */
  bulkClassify: (ids: string[], itemType: 'task' | 'code') => Promise<string[]>;
  /**
   * Bulk move: file a set of tasks (each cascading its subtree) into a folder, or back to the
   * Inbox when null. Each selected root is moved atomically (its whole subtree succeeds or
   * rolls back together), and roots are settled independently so a partial failure leaves the
   * rest filed. Resolves with the root ids that FAILED (empty = full success).
   */
  bulkMove: (ids: string[], folderId: string | null) => Promise<string[]>;
  /**
   * Re-parent a task. With a `newParentId`, nest it under that task and have its whole
   * subtree adopt the new parent's folder (a subtree shares one folder bucket). With
   * `null`, promote it to a top-level task (clear `parent_id`, keep its current folder).
   * No-ops on any move that would create a cycle (onto itself or one of its descendants).
   */
  reparentTask: (id: string, newParentId: string | null) => Promise<void>;
  /** Delete a task and its subtree (the DB cascades the children). */
  deleteTask: (id: string) => Promise<void>;
  /**
   * Drop an item from the store WITHOUT a server delete — for when a server-side action
   * has already moved it out of the tasks domain. The gate admits an item to the
   * factory via `enter_code_module`, which creates a `code_items` sidecar; the item then
   * falls out of the `task_items` view, so it must leave this store too. A pure client-side
   * `remove` (no API call): the row already changed server-side, so there's nothing to
   * reconcile and nothing to roll back.
   */
  removeGatedItem: (id: string) => void;
}

type TaskAction = SimpleAction<Item>;

/** Pure reducer over the flat item list — the generic five-move store reducer. */
export function tasksReducer(state: Item[], action: TaskAction): Item[] {
  return simpleReducer(state, action, 'task action');
}

/** One unit of a bulk operation: a selected root, the rows to restore if it fails, and its request. */
interface BulkUnit {
  /** The selected root id — reported back when this unit fails (for retry). */
  id: string;
  /** The rows to re-apply if the request rejects (the root, or its whole subtree). */
  snapshot: Item[];
  /** The API work for this unit; resolves to the server rows to reconcile. */
  request: () => Promise<Item[]>;
}

/**
 * Fan a bulk operation's per-unit requests out with `Promise.allSettled`, then in one upsert
 * apply the server rows for units that succeeded and re-apply the captured snapshot for units
 * that failed (a per-unit rollback). Toasts the count that failed and returns the failed ids.
 * The optimistic patch is the caller's — this owns only the settle/reconcile step.
 */
async function applyBulkSettled(
  dispatch: React.Dispatch<TaskAction>,
  showToast: (message: string) => void,
  units: BulkUnit[],
  failureMessage: (failed: number, total: number) => string,
): Promise<string[]> {
  const results = await Promise.allSettled(units.map((unit) => unit.request()));
  const reconciled: Item[] = [];
  const failedIds: string[] = [];
  for (const [index, result] of results.entries()) {
    const unit = units[index];
    if (unit === undefined) continue;
    if (result.status === 'fulfilled') {
      reconciled.push(...result.value);
    } else {
      failedIds.push(unit.id);
      reconciled.push(...unit.snapshot);
    }
  }
  if (reconciled.length > 0) dispatch({ type: 'upsert', items: reconciled });
  if (failedIds.length > 0) showToast(failureMessage(failedIds.length, units.length));
  return failedIds;
}

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  Item[],
  TaskActions
>('a TasksProvider');

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

  // A failed write rolls its optimistic change back silently; surface that to the user as a
  // toast (ALF-33). The action closures are memoized stable (`[]` below), so capture the
  // toast action through a ref synced by an effect — the same pattern as `tasksRef` above —
  // instead of adding it to the dep array. ToastProvider is mounted ABOVE this store (in the
  // shell layout), so `useToastActions()` resolves here.
  const { showToast } = useToastActions();
  const showToastRef = React.useRef(showToast);
  React.useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const actions = React.useMemo<TaskActions>(
    () => ({
      async addTask(input) {
        const folderId = input.folderId ?? undefined;
        const parentId = input.parentId ?? undefined;
        const createInput: api.CreateItemInput = {
          text: input.text,
          raw_capture: input.text,
          item_type: parentId === undefined ? 'unclassified' : 'task',
          ...(folderId !== undefined && { folder_id: folderId }),
          ...(parentId !== undefined && { parent_id: parentId }),
        };
        const optimistic = makeOptimisticItem(createInput);
        await runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'insert', item: optimistic });
          },
          apiCall: () => api.createItem(createInput),
          reconcile: (saved) => {
            dispatch({ type: 'replace', id: optimistic.id, item: saved });
          },
          rollback: () => {
            dispatch({ type: 'remove', ids: [optimistic.id] });
          },
          onError: () => {
            showToastRef.current("Couldn't add task");
          },
        });
      },
      async completeTask(id) {
        const affected = collectSubtree(tasksRef.current, id);
        if (affected.length === 0) return;
        const ids = affected.map((item) => item.id);
        const root = affected.find((item) => item.id === id);
        const spawn = root === undefined ? null : computeOptimisticSpawn(root);
        await runOptimisticMutation({
          optimistic: () => {
            dispatch({
              type: 'patch',
              ids,
              patch: { status: 'completed', completed_at: new Date().toISOString() },
            });
            // Show the next occurrence immediately for a recurring task.
            if (spawn !== null) dispatch({ type: 'insert', item: spawn });
          },
          apiCall: () => api.completeTask(id),
          reconcile: (result) => {
            dispatch({ type: 'upsert', items: result.completed });
            if (result.spawned !== null) {
              // Swap the optimistic occurrence for the authoritative server row (or insert it
              // if we didn't predict one).
              if (spawn === null) {
                dispatch({ type: 'upsert', items: [result.spawned] });
              } else {
                dispatch({ type: 'replace', id: spawn.id, item: result.spawned });
              }
            } else if (spawn !== null) {
              // We predicted a spawn but the server didn't make one — drop the optimistic row.
              dispatch({ type: 'remove', ids: [spawn.id] });
            }
          },
          rollback: () => {
            dispatch({ type: 'upsert', items: affected });
            if (spawn !== null) dispatch({ type: 'remove', ids: [spawn.id] });
          },
          onError: () => {
            showToastRef.current("Couldn't complete task");
          },
        });
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
        await runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'patch', ids, patch: { status: 'active', completed_at: null } });
          },
          apiCall: () =>
            Promise.all(ids.map((itemId) => api.updateItem(itemId, { status: 'active' }))),
          reconcile: (rows) => {
            dispatch({ type: 'upsert', items: rows });
          },
          rollback: () => {
            dispatch({ type: 'upsert', items: affected });
          },
          onError: () => {
            showToastRef.current("Couldn't reopen task");
          },
        });
      },
      async updateTask(id, patch) {
        const previous = tasksRef.current.find((item) => item.id === id);
        await runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'patch', ids: [id], patch });
          },
          apiCall: () => api.updateItem(id, patch),
          reconcile: (saved) => {
            dispatch({ type: 'upsert', items: [saved] });
          },
          rollback: () => {
            if (previous) dispatch({ type: 'upsert', items: [previous] });
          },
          onError: () => {
            showToastRef.current("Couldn't save changes");
          },
        });
      },
      async classifyItem(id, itemType) {
        const previous = tasksRef.current.find((item) => item.id === id);
        await runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'patch', ids: [id], patch: { item_type: itemType } });
          },
          apiCall: () => api.updateItem(id, { item_type: itemType }),
          reconcile: (saved) => {
            dispatch({ type: 'upsert', items: [saved] });
          },
          rollback: () => {
            if (previous) dispatch({ type: 'upsert', items: [previous] });
          },
          onError: () => {
            showToastRef.current("Couldn't update item");
          },
        });
      },
      async moveTask(id, folderId) {
        const affected = collectSubtree(tasksRef.current, id);
        // Stryker disable next-line ConditionalExpression: AT_CEILING — empty subtree → ids=[], so Promise.all maps over [] (zero API calls) and the dispatches are no-ops; identical to the early return. (completeTask/deleteTask call the API unconditionally, so their guards stay killable.)
        if (affected.length === 0) return;
        const ids = affected.map((item) => item.id);
        await runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'patch', ids, patch: { folder_id: folderId } });
          },
          apiCall: () =>
            Promise.all(
              ids.map((itemId) =>
                folderId === null
                  ? api.moveToInbox(itemId)
                  : api.updateItem(itemId, { folder_id: folderId }),
              ),
            ),
          reconcile: (rows) => {
            dispatch({ type: 'upsert', items: rows });
          },
          rollback: () => {
            dispatch({ type: 'upsert', items: affected });
          },
          onError: () => {
            showToastRef.current("Couldn't move task");
          },
        });
      },
      async bulkClassify(ids, itemType) {
        const current = tasksRef.current;
        const byId = new Map(current.map((row) => [row.id, row] as const));
        // An unclassified item is always a leaf (subtasks nest only under tasks), so each
        // selected id is its own unit — no subtree to gather.
        const units: BulkUnit[] = ids.flatMap((id) => {
          const previous = byId.get(id);
          if (previous === undefined) return [];
          return [
            {
              id,
              snapshot: [previous],
              request: () => api.updateItem(id, { item_type: itemType }).then((row) => [row]),
            },
          ];
        });
        if (units.length === 0) return [];
        // One optimistic patch over the whole set, then settle + per-unit reconcile/rollback.
        dispatch({
          type: 'patch',
          ids: units.map((unit) => unit.id),
          patch: { item_type: itemType },
        });
        return applyBulkSettled(
          dispatch,
          showToastRef.current,
          units,
          (failed, total) => `${String(failed)} of ${String(total)} couldn't be classified`,
        );
      },
      async bulkMove(ids, folderId) {
        const current = tasksRef.current;
        // Each selected root carries its subtree: file the whole subtree together, and roll
        // the whole subtree back if any of its rows fails (matching single-item moveTask).
        const units: BulkUnit[] = ids.flatMap((id) => {
          const subtree = collectSubtree(current, id);
          if (subtree.length === 0) return [];
          return [
            {
              id,
              snapshot: subtree,
              request: () =>
                Promise.all(
                  subtree.map((row) =>
                    folderId === null
                      ? api.moveToInbox(row.id)
                      : api.updateItem(row.id, { folder_id: folderId }),
                  ),
                ),
            },
          ];
        });
        if (units.length === 0) return [];
        const affectedIds = units.flatMap((unit) => unit.snapshot.map((row) => row.id));
        dispatch({ type: 'patch', ids: affectedIds, patch: { folder_id: folderId } });
        return applyBulkSettled(
          dispatch,
          showToastRef.current,
          units,
          (failed, total) => `${String(failed)} of ${String(total)} couldn't be filed`,
        );
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
          await runOptimisticMutation({
            optimistic: () => {
              dispatch({ type: 'patch', ids: [id], patch: { parent_id: null } });
            },
            apiCall: () => api.updateItem(id, { parent_id: null }),
            reconcile: (saved) => {
              dispatch({ type: 'upsert', items: [saved] });
            },
            rollback: () => {
              dispatch({ type: 'upsert', items: [dragged] });
            },
            onError: () => {
              showToastRef.current("Couldn't move task");
            },
          });
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

        await runOptimisticMutation({
          optimistic: () => {
            dispatch({
              type: 'patch',
              ids: [id],
              patch: { parent_id: newParentId, folder_id: newFolderId },
            });
            if (folderChanged && descendantIds.length > 0) {
              dispatch({ type: 'patch', ids: descendantIds, patch: { folder_id: newFolderId } });
            }
          },
          apiCall: () => {
            const requests = [
              api.updateItem(id, { parent_id: newParentId, folder_id: newFolderId }),
            ];
            if (folderChanged) {
              for (const descId of descendantIds) {
                requests.push(api.updateItem(descId, { folder_id: newFolderId }));
              }
            }
            return Promise.all(requests);
          },
          reconcile: (rows) => {
            dispatch({ type: 'upsert', items: rows });
          },
          rollback: () => {
            dispatch({ type: 'upsert', items: affected });
          },
          onError: () => {
            showToastRef.current("Couldn't move task");
          },
        });
      },
      async deleteTask(id) {
        const affected = collectSubtree(tasksRef.current, id);
        if (affected.length === 0) return;
        // No reconcile — the rows are gone on success.
        await runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'remove', ids: affected.map((item) => item.id) });
          },
          apiCall: () => api.deleteItem(id),
          rollback: () => {
            dispatch({ type: 'upsert', items: affected });
          },
          onError: () => {
            showToastRef.current("Couldn't delete task");
          },
        });
      },
      removeGatedItem(id) {
        // The gate's RPC clears parent_id, so a gated item is always a leaf here — drop
        // just that row (no subtree, no server call).
        dispatch({ type: 'remove', ids: [id] });
      },
    }),
    // Stryker disable next-line ArrayDeclaration: AT_CEILING — a non-empty literal dep array holds a constant string that is Object.is-equal every render, so React never recomputes this memo; identical to [].
    [],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={tasks}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

/** The view a TaskList renders. Serializable so Server Components can pass it as a prop. */
export type TaskScope =
  | { type: 'inbox' }
  | { type: 'folder'; folderId: string }
  | { type: 'completed' };

/** Read the full (flat) item list. Throws if used outside a TasksProvider. */
export function useTasks(): Item[] {
  return useStateValue('useTasks');
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
    const activeRoots = forest.filter((node) => node.status === 'active');
    // A folder ranks every level by priority → due date → created_at (ALF-37); the Inbox
    // keeps buildTree's capture-first (newest) order.
    return scopeType === 'folder' ? sortNodesByPriority(activeRoots) : activeRoots;
  }, [items, scopeType, folderId]);
}

/**
 * Per-folder count of active task items due today or earlier (today + past-due), keyed by
 * `folder_id`. Returns a map so a folder list can look up each folder's count in its existing
 * `folders.map(...)` without N hook calls. Derived from the shared store via `useMemo`, so it
 * updates optimistically with every capture, completion, due-date edit, and drag-to-folder.
 *
 * An item counts when ALL hold: it lives in a folder (`folder_id !== null`, so inbox items
 * never count), it's active (completed excluded), and it has a `due_date` that is today or
 * earlier. Filtering on `due_date !== null` already restricts to tasks (the DB
 * `items_task_only_fields` constraint lets only `item_type = 'task'` rows carry a due date), and
 * subtasks share their ancestor's `folder_id`, so this flat count includes nested subtasks.
 */
export function useDueCountsByFolder(): Record<string, number> {
  const items = useTasks();
  return React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      if (item.folder_id === null) continue;
      if (item.status !== 'active') continue;
      if (item.due_date === null) continue;
      if (!isDueTodayOrOverdue(item.due_date)) continue;
      counts[item.folder_id] = (counts[item.folder_id] ?? 0) + 1;
    }
    return counts;
  }, [items]);
}

/**
 * The flat, cross-cutting **By-Priority** list (ALF-37): every top-level (parentless) task
 * across Inbox and every folder, ranked by how much it needs attention. Derived entirely from
 * the seeded store — no extra fetch — exactly as `useBacklog` derives the Code backlog.
 *
 * Each top-level task is ranked by its **effective key**: the best (most important, then most
 * urgent) of the task itself AND its *active* descendants (a completed subtask's urgency is
 * moot). So a Low-priority parent hiding a High/overdue active subtask floats up. The badge on
 * a row still shows the task's OWN priority — the rollup affects ordering only.
 *
 * Order: rank ascending (High → Medium → Low → unprioritised), then due ascending (earliest /
 * most overdue first; no due date sorts last), then `created_at` as the stable final tiebreak.
 * Completed tasks are hidden unless `showCompleted`.
 */
export function useTasksByPriority({ showCompleted }: { showCompleted: boolean }): Item[] {
  const items = useTasks();
  return React.useMemo(() => rankByPriority(items, showCompleted), [items, showCompleted]);
}

/** Read the task mutation actions. Throws if used outside a TasksProvider. */
export function useTaskActions(): TaskActions {
  return useActions('useTaskActions');
}
