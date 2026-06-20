import type { ItemNode } from '@/lib/tree';
import { isTempId } from '@/lib/tree';

export interface TaskRowFlags {
  /**
   * A `task` row: completion, due dates, and subtasks are task-only — gated here in the UI
   * and structurally in the DB (the CHECK constraint).
   */
  isTask: boolean;
  /**
   * An `unclassified` row (what capture creates). The Classify-as submenu is inbox triage,
   * offered ONLY while still unclassified.
   */
  isUnclassified: boolean;
  /** A `code`-classified-but-not-yet-sent row — still in the inbox, offering the gate. */
  isCode: boolean;
  /**
   * Eligible for the gate's "Convert to Code Story…" path (a task or unclassified row, both
   * safe to convert; a `code` row uses "Send to Code module…" instead).
   */
  canConvert: boolean;
  /**
   * A valid drop target lights up: a different, active, reconciled task outside the dragged
   * item's own subtree (re-parenting onto self/a descendant would make a cycle). A non-`task`
   * row can never be a parent, so it's never valid.
   */
  isValidDropTarget: boolean;
}

/**
 * Derives a task row's item-type flags and its drop-target validity from the node. These
 * conditionals gate nearly every affordance in the row (checkbox, due date, subtasks, the
 * menu entries, the drop highlight); centralising them keeps the row and its menu in sync.
 */
export function useTaskRowFlags(
  node: ItemNode,
  isCompleted: boolean,
  draggedSubtreeIds: ReadonlySet<string>,
): TaskRowFlags {
  const isTask = node.item_type === 'task';
  const isUnclassified = node.item_type === 'unclassified';
  const isCode = node.item_type === 'code';
  const canConvert = isTask || isUnclassified;
  const isValidDropTarget =
    isTask && !isCompleted && !isTempId(node.id) && !draggedSubtreeIds.has(node.id);

  return { isTask, isUnclassified, isCode, canConvert, isValidDropTarget };
}
