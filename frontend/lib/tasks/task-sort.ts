import { CalendarClock, ListOrdered, type LucideIcon } from 'lucide-react';

import { type KeyComparator, compareKey, compareKeyByDue, rankNodes } from '@/lib/priority';
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

const COMPARATORS: Record<TaskSortMode, KeyComparator> = {
  priority: compareKey,
  due: compareKeyByDue,
};

/**
 * Order the **top-level** nodes it's handed by `mode`, returning a new array. Each node is ranked
 * by its subtree's best key (`effectiveKey`) — the same rollup the By-Priority and Today views use
 * — so a parent hiding a High or soon-due active subtask floats up. Children are left **exactly as
 * received**: a subtask group keeps the `sort_order` order `buildTree` applied, so neither mode
 * reorders a subtask list.
 */
export function sortNodesBy<T extends Item & { children: T[] }>(
  nodes: readonly T[],
  mode: TaskSortMode,
): T[] {
  return rankNodes(nodes, COMPARATORS[mode]);
}
