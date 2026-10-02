import { ChevronsDown, ChevronsUp, Equal, type LucideIcon } from 'lucide-react';

import type { BadgeProperties } from '@/components/atoms/badge';
import { stableSorted } from '@/lib/sort';
import { type ItemNode, buildTree } from '@/lib/tree';
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
  /**
   * The level's accent text colour, for an icon shown against a neutral surface — the picker
   * menu's level glyphs and the detail chip. (Distinct from `badgeVariant`, whose Low is a muted
   * grey pill; here Low reads blue.)
   */
  iconClass: string;
}

const OPTIONS: Record<TaskPriority, PriorityOption> = {
  high: {
    value: 'high',
    label: 'High',
    icon: ChevronsUp,
    badgeVariant: 'destructive',
    iconClass: 'text-accent-red',
  },
  medium: {
    value: 'medium',
    label: 'Medium',
    icon: Equal,
    badgeVariant: 'alert',
    iconClass: 'text-accent-amber',
  },
  low: {
    value: 'low',
    label: 'Low',
    icon: ChevronsDown,
    badgeVariant: 'muted',
    iconClass: 'text-accent-blue',
  },
};

/** The levels in rank order (High → Medium → Low) — the menu / select order. */
export const PRIORITY_OPTIONS: readonly PriorityOption[] = [
  OPTIONS.high,
  OPTIONS.medium,
  OPTIONS.low,
];

/**
 * Narrow to a real level (`high` / `medium` / `low`), excluding BOTH `null` and `undefined`.
 * The render gates use this instead of a bare `!== null` so a row whose `priority` the read
 * layer never surfaced (a `task_items` view predating the column yields `undefined`, not `null`)
 * is treated as unprioritised — not waved through to a lookup that then misses.
 */
export function isPriorityLevel(value: TaskPriority | null | undefined): value is TaskPriority {
  return value !== null && value !== undefined;
}

/**
 * The option metadata for a level, or `undefined` when there is none to show — `null`/`undefined`
 * (unprioritised) or any value that isn't a known level. The return type is honest about the miss
 * so callers can't `const { label } = priorityOption(value)` blindly: a `task_items` row can arrive
 * with no `priority` at all (→ `undefined`), and destructuring the absent option crashes the page.
 */
export function priorityOption(value: TaskPriority | null | undefined): PriorityOption | undefined {
  return isPriorityLevel(value) ? OPTIONS[value] : undefined;
}

// Lower rank = higher in the list. Unset (null/undefined) ranks last.
const RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

export function priorityRank(p: TaskPriority | null | undefined): number {
  return isPriorityLevel(p) ? RANK[p] : 3;
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

/** Sort comparator: rank ascending, then due ascending. */
export function compareKey(a: PriorityKey, b: PriorityKey): number {
  return a.rank - b.rank || a.due - b.due;
}

/**
 * The urgency-first counterpart of {@link compareKey}: due ascending (earliest first, an undated
 * task last via its key's `Infinity`), with the level as the tiebreak among tasks sharing a date.
 * Compares the dates rather than subtracting them, so two undated tasks tie at 0 instead of
 * yielding `Infinity - Infinity`.
 */
export function compareKeyByDue(a: PriorityKey, b: PriorityKey): number {
  if (a.due !== b.due) return a.due < b.due ? -1 : 1;
  return a.rank - b.rank;
}

/** A task with its subtree attached — the shape `buildTree` produces. */
export interface PriorityNode extends Item {
  children: readonly PriorityNode[];
}

/** A key ordering — {@link compareKey} (importance first) or {@link compareKeyByDue} (urgency first). */
export type KeyComparator = (a: PriorityKey, b: PriorityKey) => number;

/**
 * A task's **effective key**: the best key — first under `compare` — across the task itself and
 * its *active* descendants, at any depth. So a Low parent hiding a High (or overdue) active subtask
 * ranks as that subtask would; a completed subtask (and its subtree) no longer counts. The row's
 * badge still shows the task's OWN priority — the rollup affects ordering only.
 */
export function effectiveKey(node: PriorityNode, compare: KeyComparator = compareKey): PriorityKey {
  let key = ownKey(node);
  for (const child of node.children) {
    if (child.status !== 'active') continue;
    const childKey = effectiveKey(child, compare);
    if (compare(childKey, key) < 0) key = childKey;
  }
  return key;
}

/**
 * The one task ranking every view shares: order `nodes` by their {@link effectiveKey} under
 * `compare`, `created_at` (oldest first) as the final stable tiebreak. Returns a new array; each
 * node's children are left exactly as received (a subtask group keeps its `sort_order` order).
 */
export function rankNodes<T extends PriorityNode>(
  nodes: readonly T[],
  compare: KeyComparator = compareKey,
): T[] {
  const keyed = nodes.map((node) => ({ node, key: effectiveKey(node, compare) }));
  return stableSorted(
    keyed,
    (a, b) =>
      compare(a.key, b.key) || Date.parse(a.node.created_at) - Date.parse(b.node.created_at),
  ).map(({ node }) => node);
}

/**
 * Rank the top-level (parentless) tasks of a flat item list for the By-Priority view (ALF-37):
 * High → Medium → Low → unprioritised by each task's {@link effectiveKey}, earlier due date first
 * within a level. Completed tasks are dropped unless `showCompleted`. Each returned task carries its
 * full built subtree (completed subtasks included), so a row can render it.
 */
export function rankByPriority(items: readonly Item[], showCompleted: boolean): ItemNode[] {
  const top = buildTree([...items]).filter((node) => node.parent_id === null);
  const visible = showCompleted ? top : top.filter((node) => node.status === 'active');
  return rankNodes(visible, compareKey);
}
