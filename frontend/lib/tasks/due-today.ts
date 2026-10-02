import { isDueTodayOrOverdue } from '@/lib/date-utils';
import { compareKeyByDue, rankNodes } from '@/lib/priority';
import type { ItemNode } from '@/lib/tree';

/**
 * The Today view's ranking rule — which of the built roots are due now, and in what order.
 * Pure and framework-free (it takes the forest `buildTree` already produces), so the store's
 * selector, the view's tests, and a demo can share one definition of "due today".
 */

/**
 * Whether this task, or any still-active task beneath it, carries a due date of today or
 * earlier. The rollup is what lets an undated parent surface for a subtask that IS due — the
 * same "a parent hides its urgent subtree" reasoning the By-Priority rank uses.
 *
 * A COMPLETED descendant is skipped (with its own subtree): a finished subtask's due date is no
 * longer an obligation. The node's own status is deliberately not checked here — a completed
 * ROOT is filtered by the view's Show-completed toggle in {@link rankDueToday}, not by this
 * predicate, so turning that toggle on can reveal what you finished today.
 */
function isDueInSubtree(node: ItemNode): boolean {
  if (node.due_date !== null && isDueTodayOrOverdue(node.due_date)) return true;
  return node.children.some((child) => child.status === 'active' && isDueInSubtree(child));
}

/**
 * The Today forest: the top-level tasks that are due today or already overdue — by their own due
 * date or through an active subtask — ordered **most overdue first**, then today's, with the
 * priority level breaking a same-date tie and `created_at` as the final stable tiebreak.
 *
 * Urgency leads here (the opposite of By-Priority, where the level leads): the view's whole
 * filter is a deadline, so a Low-priority task that is a week late outranks a High-priority one
 * due at the end of the day. Completed top-level tasks are hidden unless `showCompleted`; each
 * kept root travels with its whole subtree, so its subtasks still render when it is expanded.
 */
export function rankDueToday(roots: readonly ItemNode[], showCompleted: boolean): ItemNode[] {
  const visible = roots.filter(
    (node) => (showCompleted || node.status === 'active') && isDueInSubtree(node),
  );
  return rankNodes(visible, compareKeyByDue);
}
