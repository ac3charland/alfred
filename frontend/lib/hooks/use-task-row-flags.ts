import type { ItemNode } from '@/lib/tree';
import { isTempId } from '@/lib/tree';
import type { Item } from '@/lib/types';

export interface TaskRowFlags {
  /**
   * A `task` row: completion and due dates are task-only — gated here in the UI and
   * structurally in the DB (the CHECK constraint).
   */
  isTask: boolean;
  /**
   * An `unclassified` row (what capture creates). The Classify-as submenu is inbox triage,
   * offered ONLY while still unclassified: once a type is set the row's per-type label submenus
   * take that slot, and the way back from a wrong type is Delete and re-capture — a flip after
   * the fields are filled would silently drop whatever the new type forbids.
   */
  isUnclassified: boolean;
  /** A `code`-classified-but-not-yet-sent row — still in the inbox, awaiting its dispatch. */
  isCode: boolean;
  /**
   * May host subtasks: any task, or a code ROOT (a code child never nests further — the
   * 1-deep rule, enforced here and by the DB trigger). Drives the desktop `+` and the mobile
   * "Add subtask" / "Add story" menu item.
   */
  canAddSubtask: boolean;
  /**
   * A valid drop target lights up: a different, active, reconciled task outside the dragged
   * item's own subtree (re-parenting onto self/a descendant would make a cycle). A non-`task`
   * row can never be a parent, and a `code` item never re-parents onto a task — the two
   * families don't mix by drag.
   */
  isValidDropTarget: boolean;
  /**
   * The row's SHAPE permits a type change: a top-level row with no subtasks. A render gate on
   * Classify as… (alongside `isUnclassified`), not a disabled state — an entry that is never
   * going to work is simply not offered. The dangerous flip is a PARENT's —
   * `enforce_subtask_shape` returns early on a parentless row and never re-validates the
   * untouched children, so a code root would silently acquire task children; the database
   * cannot catch that one, so the UI must. A subtask's flip is caught by the DB, but the UI
   * shouldn't offer it either.
   */
  canChangeType: boolean;
}

/**
 * Derives a task row's item-type flags and its drop-target validity from the node. These
 * conditionals gate nearly every affordance in the row (checkbox, due date, subtasks, the
 * menu entries, the drop highlight); centralising them keeps the row and its menu in sync.
 * `draggedItemType` is the in-flight drag's item type (null when nothing is dragged), so the
 * drop highlight can refuse a cross-family re-parent.
 */
export function useTaskRowFlags(
  node: ItemNode,
  isCompleted: boolean,
  draggedSubtreeIds: ReadonlySet<string>,
  draggedItemType: Item['item_type'] | null = null,
): TaskRowFlags {
  const isTask = node.item_type === 'task';
  const isUnclassified = node.item_type === 'unclassified';
  const isCode = node.item_type === 'code';
  const isCodeRoot = isCode && node.parent_id === null;
  const canAddSubtask = isTask || isCodeRoot;
  const isValidDropTarget =
    isTask &&
    !isCompleted &&
    !isTempId(node.id) &&
    !draggedSubtreeIds.has(node.id) &&
    draggedItemType !== 'code';
  const canChangeType = node.parent_id === null && node.children.length === 0;

  return {
    isTask,
    isUnclassified,
    isCode,
    canAddSubtask,
    isValidDropTarget,
    canChangeType,
  };
}
