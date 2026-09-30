import { stableSorted } from '@/lib/sort';
import type { ItemNode } from '@/lib/tree';

/** How far through its tasks a week has got. */
export interface PlanProgress {
  done: number;
  total: number;
}

/**
 * The top-level items a weekly review created against `planId` (`items.weekly_plan_id`), each
 * carrying its whole subtree, in **plan order**.
 *
 * Plan order is `created_at` descending: `create_weekly_plan_items` stamps array position 0 as
 * the newest row, so newest-first reads the week top-down exactly as the review wrote it.
 *
 * Roots only. The RPC stamps the plan id on every child too, but a subtask belongs under its
 * parent's chevron, not as a second row of its own. Completed roots stay: the list is a record of
 * the week, and what got done is half of it.
 */
export function plannedRoots(roots: readonly ItemNode[], planId: string): ItemNode[] {
  return stableSorted(
    roots.filter((node) => node.weekly_plan_id === planId),
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
}

/**
 * The week's progress over its **tasks** only. A knowledge row or one the classifier hasn't typed
 * yet has no checkbox, so counting it would hold the week below its total whatever got done. Roots
 * only: subtasks roll up into the task they belong to.
 */
export function planProgress(roots: readonly ItemNode[]): PlanProgress {
  const tasks = roots.filter((node) => node.item_type === 'task');
  return {
    done: tasks.filter((node) => node.status === 'completed').length,
    total: tasks.length,
  };
}
