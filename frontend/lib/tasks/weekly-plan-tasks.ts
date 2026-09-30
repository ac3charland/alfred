import { stableSorted } from '@/lib/sort';
import type { ItemNode } from '@/lib/tree';

/** How far through its tasks a week has got. */
export interface PlanProgress {
  done: number;
  total: number;
}

/** A task the review created against `planId` (`items.weekly_plan_id`). */
function isPlannedTask(node: ItemNode, planId: string): boolean {
  return node.weekly_plan_id === planId && node.item_type === 'task';
}

/**
 * The tasks a weekly review created against `planId`, each carrying its whole subtree, in **plan
 * order**. Tasks only (ALF-235): code, knowledge and not-yet-classified rows stay out until the
 * classifier types them.
 *
 * A planned task is listed wherever it sits in the forest, unless its parent is itself a planned
 * task — the RPC stamps the plan id on every child too, and a subtask belongs under its parent's
 * chevron, not as a second row. So a planned root later dragged under an ordinary task is still
 * this week's work, and still listed. Completed tasks stay: the list is a record of the week.
 *
 * Plan order is `created_at` descending: `create_weekly_plan_items` stamps array position 0 as the
 * newest row, so newest-first reads the week top-down exactly as the review wrote it. Sorted here
 * rather than inherited from `buildTree`, because a re-nested task is collected from deep in the
 * forest.
 */
export function plannedRoots(roots: readonly ItemNode[], planId: string): ItemNode[] {
  const found: ItemNode[] = [];
  const walk = (nodes: readonly ItemNode[], parentPlanned: boolean) => {
    for (const node of nodes) {
      const planned = isPlannedTask(node, planId);
      if (planned && !parentPlanned) found.push(node);
      walk(node.children, planned);
    }
  };
  walk(roots, false);
  return stableSorted(found, (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/**
 * The week's progress: how many of the listed tasks are done. Roots only — subtasks roll up into
 * the task they belong to.
 *
 * Deliberately narrower than the `counts` the `/api/weekly-plans/[id]/items` payload reports, which
 * tally every planned node of every type: that answers the review's "what became of each line?",
 * while this answers "how far through its tasks is the week?".
 */
export function planProgress(roots: readonly ItemNode[]): PlanProgress {
  return {
    done: roots.filter((node) => node.status === 'completed').length,
    total: roots.length,
  };
}
