import { CalendarClock, ListOrdered, type LucideIcon } from 'lucide-react';

import { type PriorityKey, compareKey, ownKey } from '@/lib/priority';
import { stableSorted } from '@/lib/sort';
import type { Item } from '@/lib/types';

/**
 * How a folder orders its top-level tasks: by **priority** (importance first) or by **due date**
 * (urgency first). Both fall back on the other signal, so the choice is which one leads — not
 * which one is used.
 */
export type TaskSortMode = 'priority' | 'due';

/** One sort mode's presentation: the menu label and its lucide glyph. */
export interface TaskSortOption {
  value: TaskSortMode;
  label: string;
  icon: LucideIcon;
}

const OPTIONS: Record<TaskSortMode, TaskSortOption> = {
  priority: { value: 'priority', label: 'Priority', icon: ListOrdered },
  due: { value: 'due', label: 'Due date', icon: CalendarClock },
};

/** The modes in menu order. */
export const TASK_SORT_OPTIONS: readonly TaskSortOption[] = [OPTIONS.priority, OPTIONS.due];

/**
 * The mode a folder rests at until you pick another — priority, the order every folder has shown
 * since tasks gained a level, so nothing moves for a user who never opens the sort menu.
 */
export const DEFAULT_TASK_SORT: TaskSortMode = 'priority';

/** The option metadata for a mode. Total over the union, so it never misses. */
export function taskSortOption(mode: TaskSortMode): TaskSortOption {
  return OPTIONS[mode];
}

/**
 * Due-date ordering: earliest first, a task with no due date last (its key's `Infinity`), with the
 * priority level as the tiebreak among tasks sharing a date. Compares the dates rather than
 * subtracting them, so two undated tasks tie at 0 instead of yielding `Infinity - Infinity`.
 */
function compareKeyByDue(a: PriorityKey, b: PriorityKey): number {
  if (a.due !== b.due) return a.due < b.due ? -1 : 1;
  return a.rank - b.rank;
}

const COMPARATORS: Record<TaskSortMode, (a: PriorityKey, b: PriorityKey) => number> = {
  priority: compareKey,
  due: compareKeyByDue,
};

/**
 * Order the **top-level** nodes it's handed by `mode`, returning a new array. Each node is ranked
 * by its **own** key — no rollup from its subtree — with `created_at` (oldest first) as the final
 * stable tiebreak. Children are left **exactly as received**: a subtask group keeps the
 * `sort_order` order `buildTree` applied (creation order by default, the manual order once
 * dragged), so neither mode reorders a subtask list.
 *
 * Pure and framework-free, so the Folder view's selector and a test can share one ordering.
 */
export function sortNodesBy<T extends Item & { children: T[] }>(
  nodes: readonly T[],
  mode: TaskSortMode,
): T[] {
  const compare = COMPARATORS[mode];
  return stableSorted(
    nodes,
    (a, b) =>
      compare(ownKey(a), ownKey(b)) ||
      (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0),
  );
}
