/**
 * Pure logic for the drag-a-subtask-into-a-gap interaction (see the dnd-kit skill).
 *
 * A subtask group renders a thin, layout-neutral drop strip at each sibling boundary (top,
 * between, bottom). Dropping a subtask into a gap positions it at that slot; dropping onto a row
 * body keeps its re-parent meaning. dnd-kit reports a drop only as `active.id` / `over.id`, so a
 * gap encodes its slot in its id (parent + insertion index) and the handler reads the neighbours'
 * `sort_order` from the store. This module turns (dragged row, gap slot, the parent's ordered
 * siblings) into the reorder to run, or a no-op. Keeping it pure makes it unit-testable, since
 * jsdom can't measure layout to drive a real drag.
 */

/** Marks a droppable id as a reorder-gap strip (vs a row body or a folder/promote zone). */
export const REORDER_GAP_PREFIX = '__reorder-gap__';

// A parent id can't contain this separator (ids are UUIDs), so splitting on it is unambiguous.
const GAP_SEPARATOR = '::';

/**
 * Encode which slot a gap represents: the parent whose children it sits among, plus the
 * insertion index (0 = above the first child, `children.length` = below the last). The handler
 * reads the neighbours' `sort_order` from the store by index, so the id only has to locate the
 * slot.
 */
export function reorderGapId(parentId: string, index: number): string {
  return `${REORDER_GAP_PREFIX}${parentId}${GAP_SEPARATOR}${String(index)}`;
}

/** True when `overId` is a reorder-gap strip. */
export function isReorderGap(overId: string | null): boolean {
  return overId?.startsWith(REORDER_GAP_PREFIX) ?? false;
}

/**
 * Decode a gap id back into its parent and insertion index, or `null` if `overId` is not a gap
 * (or is malformed). The inverse of {@link reorderGapId}.
 */
export function parseReorderGapId(
  overId: string | null,
): { parentId: string; index: number } | null {
  if (!overId?.startsWith(REORDER_GAP_PREFIX)) return null;
  const body = overId.slice(REORDER_GAP_PREFIX.length);
  const separator = body.lastIndexOf(GAP_SEPARATOR);
  if (separator === -1) return null;
  const parentId = body.slice(0, separator);
  const index = Number.parseInt(body.slice(separator + GAP_SEPARATOR.length), 10);
  if (parentId === '' || Number.isNaN(index)) return null;
  return { parentId, index };
}

/**
 * The fractional `sort_order` for a slot between two neighbours — THE unit-test target (jsdom
 * can't drive a real drag). `prev`/`next` are the sort_order values bounding the slot, or `null`
 * at an edge (or when the group is empty).
 *
 * - empty group  → 0
 * - top gap      → `next - 1`   (before the first row)
 * - bottom gap   → `prev + 1`   (after the last row)
 * - between      → the midpoint  (no neighbour is renumbered)
 */
export function computeInsertOrder(prev: number | null, next: number | null): number {
  if (prev === null) return next === null ? 0 : next - 1;
  if (next === null) return prev + 1;
  return (prev + next) / 2;
}

/** One sibling in a parent's ordered (sort_order asc) children — id + its current rank. */
export interface OrderedSibling {
  id: string;
  sortOrder: number;
}

export interface ReorderSubtaskArgs {
  /** The dragged subtask's id (`active.id`). */
  draggedId: string;
  /** The dragged subtask's current `parent_id` (null when it's currently a root). */
  draggedParentId: string | null;
  /** The dragged subtask's current `sort_order` — used to detect a no-op drop into its own slot. */
  draggedSortOrder: number;
  /** The parent whose gap was dropped into (a gap always sits under a real parent). */
  gapParentId: string;
  /**
   * The gap parent's active children in display order (sort_order asc), **EXCLUDING** the dragged
   * row. The handler builds this from the store and translates the rendered gap index into an
   * `insertIndex` relative to this excluded list.
   */
  orderedSiblings: readonly OrderedSibling[];
  /** The slot to insert at, in `orderedSiblings` coordinates (0..orderedSiblings.length). */
  insertIndex: number;
  /** The dragged subtask's id plus every descendant id — the cross-parent cycle guard. */
  subtreeIds: ReadonlySet<string>;
}

export interface Reorder {
  /** The dragged subtask, which is moved. */
  itemId: string;
  /** The parent it lands under (its new `parent_id` — same as current for an in-place reorder). */
  parentId: string;
  /** Its new fractional `sort_order`. */
  sortOrder: number;
}

/**
 * Resolve a drop into a reorder-gap into the reorder it should trigger, or `null` for a no-op.
 *
 * No-ops (return `null`):
 * - a cross-parent drop into the dragged row's **own subtree** (`subtreeIds` — would create a
 *   cycle, mirroring `resolveReparent`);
 * - dropping back into the slot the row **already occupies** (same parent, same position).
 */
export function resolveReorder(args: ReorderSubtaskArgs): Reorder | null {
  const {
    draggedId,
    draggedParentId,
    draggedSortOrder,
    gapParentId,
    orderedSiblings,
    insertIndex,
    subtreeIds,
  } = args;

  // A subtask may never land in a gap among its own descendants (cycle) — nor "under itself".
  if (subtreeIds.has(gapParentId)) return null;

  // Same parent: dropping into the slot the row already sits in changes nothing. Its current
  // index (excluding itself) is the count of siblings ranked before it; the two gaps flanking
  // that position both reproduce it, and the handler maps both to this same insertIndex.
  if (gapParentId === draggedParentId) {
    const currentIndex = orderedSiblings.filter((s) => s.sortOrder < draggedSortOrder).length;
    if (insertIndex === currentIndex) return null;
  }

  const prev = insertIndex > 0 ? (orderedSiblings[insertIndex - 1]?.sortOrder ?? null) : null;
  const next =
    insertIndex < orderedSiblings.length ? (orderedSiblings[insertIndex]?.sortOrder ?? null) : null;

  return { itemId: draggedId, parentId: gapParentId, sortOrder: computeInsertOrder(prev, next) };
}
