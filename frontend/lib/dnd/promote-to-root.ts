/**
 * Pure logic for the drag-a-child-out-to-the-top-level interaction (see the dnd-kit skill).
 *
 * The task list brackets itself with two droppable zones — one above the first row, one
 * below the last. Dropping a *child* task onto either pulls it out of its parent and makes
 * it a top-level task. dnd-kit reports the drop only as `active.id` / `over.id`; this module
 * turns that pair (plus the dragged task's current parent) into the promotion it should
 * trigger, or a no-op. Keeping it pure makes it unit-testable, since jsdom can't measure
 * layout to drive a real drag.
 */

/** Droppable ids for the list's top and bottom promote-to-root zones. */
export const LIST_TOP_DROP_ID = '__list-top__';
export const LIST_BOTTOM_DROP_ID = '__list-bottom__';

/** True when `overId` is one of the two promote-to-root zones. */
export function isPromoteZone(overId: string | null): boolean {
  return overId === LIST_TOP_DROP_ID || overId === LIST_BOTTOM_DROP_ID;
}

export interface Promotion {
  /** The dragged task, which becomes a top-level task (parent_id → null). */
  itemId: string;
}

/**
 * Resolve a drop onto a promote-to-root zone into the promotion it should trigger, or
 * `null` for a no-op (not a promote zone, or the task is already top-level).
 *
 * @param itemId           the dragged task's id (`active.id`)
 * @param overId           the drop target's id (`over.id`), or `null` if dropped on nothing
 * @param currentParentId  the dragged task's current `parent_id`
 */
export function resolvePromoteToRoot(
  itemId: string,
  overId: string | null,
  currentParentId: string | null,
): Promotion | null {
  if (!isPromoteZone(overId)) return null;
  if (currentParentId === null) return null; // already a top-level task
  return { itemId };
}
