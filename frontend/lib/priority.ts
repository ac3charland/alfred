import { ChevronsDown, ChevronsUp, Equal, type LucideIcon } from 'lucide-react';

import type { BadgeProperties } from '@/components/atoms/badge';
import { stableSorted } from '@/lib/sort';
import type { Item, ItemPriority } from '@/lib/types';

/**
 * The discrete task priority (ALF-37): High / Medium / Low, or `null` for unprioritised.
 * Derived from the DB enum so the level set stays single-sourced with the schema.
 */
export type TaskPriority = ItemPriority;

/**
 * One priority level's presentation: the menu/select label, the lucide icon, and the
 * {@link Badge} variant. The single source consumed by BOTH `PrioritySelect` (the editor
 * control) and `PriorityChip` (the row badge) so the two never drift — the same pattern as
 * `lib/recurrence/presets.ts`. Ordered high → low (the rank order).
 */
export interface PriorityOption {
  value: TaskPriority;
  label: string;
  icon: LucideIcon;
  badgeVariant: NonNullable<BadgeProperties['variant']>;
}

const OPTIONS: Record<TaskPriority, PriorityOption> = {
  high: { value: 'high', label: 'High', icon: ChevronsUp, badgeVariant: 'destructive' },
  medium: { value: 'medium', label: 'Medium', icon: Equal, badgeVariant: 'alert' },
  low: { value: 'low', label: 'Low', icon: ChevronsDown, badgeVariant: 'muted' },
};

/** The levels in rank order (High → Medium → Low) — the menu / select order. */
export const PRIORITY_OPTIONS: readonly PriorityOption[] = [
  OPTIONS.high,
  OPTIONS.medium,
  OPTIONS.low,
];

/** The option metadata for a level (the keyed lookup is exhaustive — every level has an entry). */
export function priorityOption(value: TaskPriority): PriorityOption {
  return OPTIONS[value];
}

// Lower rank = higher in the list. Unset (null) ranks last.
const RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

export function priorityRank(p: TaskPriority | null): number {
  return p === null ? 3 : RANK[p];
}

/**
 * A task's importance/urgency, compared lexicographically: level first (lower rank wins),
 * then due (earlier = more urgent; no due date sorts last via `Infinity`).
 */
export interface PriorityKey {
  rank: number;
  due: number;
}

export function ownKey(i: Item): PriorityKey {
  return { rank: priorityRank(i.priority), due: i.due_date ? Date.parse(i.due_date) : Infinity };
}

/** The more important / urgent of two keys: higher level wins, then the earlier due date. */
export function bestKey(a: PriorityKey, b: PriorityKey): PriorityKey {
  if (a.rank !== b.rank) return a.rank < b.rank ? a : b;
  return a.due <= b.due ? a : b;
}

/** Sort comparator: rank ascending, then due ascending. */
export function compareKey(a: PriorityKey, b: PriorityKey): number {
  return a.rank - b.rank || a.due - b.due;
}

/**
 * Rank the top-level (parentless) tasks of a flat item list for the By-Priority view (ALF-37):
 * High → Medium → Low → unprioritised, earlier due date first within a level, `created_at` as
 * the final stable tiebreak. Completed tasks are dropped unless `showCompleted`.
 *
 * Each task is ranked by its **effective key** — the best (most important, then most urgent) of
 * the task itself and its *active* descendants (recursively). So a Low-priority parent hiding a
 * High-priority, overdue active subtask floats up; a completed subtask's urgency is moot. Pure
 * and framework-free so the `useTasksByPriority` hook and the demo can share one ranking.
 */
export function rankByPriority(items: readonly Item[], showCompleted: boolean): Item[] {
  // Index children so a task's key can roll up over its subtree.
  const childrenOf = new Map<string, Item[]>();
  for (const i of items) {
    if (i.parent_id === null) continue;
    const list = childrenOf.get(i.parent_id) ?? [];
    list.push(i);
    childrenOf.set(i.parent_id, list);
  }
  const effectiveKey = (node: Item): PriorityKey => {
    let key = ownKey(node);
    for (const child of childrenOf.get(node.id) ?? []) {
      if (child.status === 'active') key = bestKey(key, effectiveKey(child));
    }
    return key;
  };
  const top = items.filter((i) => i.parent_id === null);
  const visible = showCompleted ? top : top.filter((i) => i.status === 'active');
  return stableSorted(
    visible,
    (a, b) =>
      compareKey(effectiveKey(a), effectiveKey(b)) ||
      Date.parse(a.created_at) - Date.parse(b.created_at),
  );
}

/**
 * Recursively rank an assembled item tree by priority → due date → `created_at` at **every**
 * level (ALF-37), returning a new forest with each sibling group sorted and children sorted in
 * turn. Unlike {@link rankByPriority} this ranks each node by its **own** key (no subtree
 * rollup) — the Folder view shows subtasks as their own rows, so each row sorts among its
 * siblings on its own priority/urgency. Used by the Folder view; the Inbox keeps capture order.
 */
export function sortNodesByPriority<T extends Item & { children: T[] }>(nodes: readonly T[]): T[] {
  const sorted = stableSorted(
    nodes,
    (a, b) =>
      compareKey(ownKey(a), ownKey(b)) ||
      (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0),
  );
  return sorted.map((node) => ({ ...node, children: sortNodesByPriority(node.children) }));
}
