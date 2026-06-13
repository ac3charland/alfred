/**
 * Pure logic for the drag-a-task-onto-another-task interaction (see the dnd-kit skill).
 *
 * dnd-kit reports a drop only as `active.id` / `over.id`; this module turns that pair
 * (plus the dragged subtree's ids and current parent) into the re-parent it should
 * trigger, or a no-op. Keeping it pure makes it unit-testable, since jsdom can't measure
 * layout to drive a real drag.
 */

export interface Reparent {
  /** The dragged task, which becomes a child of `newParentId`. */
  itemId: string;
  /** The task it is dropped onto — the new parent. */
  newParentId: string;
}

/**
 * Resolve a task-onto-task drop into the re-parent it should trigger, or `null` for a
 * no-op.
 *
 * Forbidden drops (return `null`):
 * - dropped on nothing (`overId` is `null`);
 * - dropped on itself or any of its own descendants (`subtreeIds` — would create a cycle);
 * - dropped onto the parent it already has (no change).
 *
 * @param itemId      the dragged task's id (`active.id`)
 * @param overId      the drop target's id (`over.id`), or `null` if dropped on nothing
 * @param currentParentId  the dragged task's current `parent_id`
 * @param subtreeIds  the dragged task's id plus every descendant id (the cycle guard)
 */
export function resolveReparent(
  itemId: string,
  overId: string | null,
  currentParentId: string | null,
  subtreeIds: ReadonlySet<string>,
): Reparent | null {
  if (overId === null) return null;
  if (subtreeIds.has(overId)) return null;
  if (overId === currentParentId) return null;
  return { itemId, newParentId: overId };
}
