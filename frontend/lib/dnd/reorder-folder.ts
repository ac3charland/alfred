/**
 * Pure logic for the drag-a-folder-into-a-gap interaction (see the dnd-kit skill).
 *
 * The sidebar folder list renders a thin, layout-neutral drop strip at each folder boundary
 * (top, between, bottom). Dropping a folder into a gap positions it at that slot; the folder
 * rows themselves keep their existing meaning as drop targets for *tasks*. dnd-kit reports a
 * drop only as `active.id` / `over.id` and the sidebar registers each folder BOTH as a task
 * drop zone (its bare id) and as a draggable, so a folder drag carries a prefixed id and a gap
 * encodes its slot index in its own id. This module turns (dragged folder, gap slot, the other
 * folders in display order) into the reorder to run, or a no-op. Keeping it pure makes it
 * unit-testable, since jsdom can't measure layout to drive a real drag.
 */
import { computeInsertOrder } from '@/lib/dnd/reorder-subtask';

/** Marks a draggable id as a folder row (vs a task row, which drags under its bare id). */
export const FOLDER_DRAG_PREFIX = '__folder__';
/** Marks a droppable id as a folder reorder-gap strip (vs a folder row's task drop zone). */
export const FOLDER_GAP_PREFIX = '__folder-gap__';

/** The draggable id a folder row lifts under — its folder id, prefixed. */
export function folderDragId(folderId: string): string {
  return `${FOLDER_DRAG_PREFIX}${folderId}`;
}

/** True when `activeId` is a folder being dragged (rather than a task row). */
export function isFolderDrag(activeId: string | null): boolean {
  return activeId?.startsWith(FOLDER_DRAG_PREFIX) ?? false;
}

/** Decode a folder drag id back into its folder id, or `null` when it isn't one. */
export function parseFolderDragId(activeId: string | null): string | null {
  if (!activeId?.startsWith(FOLDER_DRAG_PREFIX)) return null;
  const folderId = activeId.slice(FOLDER_DRAG_PREFIX.length);
  return folderId === '' ? null : folderId;
}

/**
 * Encode which slot a gap represents: the insertion index in the rendered list (0 = above the
 * first folder, `folders.length` = below the last). The handler reads the neighbours'
 * `sort_order` from the store by index, so the id only has to locate the slot.
 */
export function folderGapId(index: number): string {
  return `${FOLDER_GAP_PREFIX}${String(index)}`;
}

/** True when `overId` is a folder reorder-gap strip. */
export function isFolderGap(overId: string | null): boolean {
  return overId?.startsWith(FOLDER_GAP_PREFIX) ?? false;
}

/** Decode a gap id back into its insertion index, or `null` if `overId` is not a gap. */
export function parseFolderGapId(overId: string | null): number | null {
  if (!overId?.startsWith(FOLDER_GAP_PREFIX)) return null;
  const index = Number.parseInt(overId.slice(FOLDER_GAP_PREFIX.length), 10);
  return Number.isNaN(index) ? null : index;
}

/** One folder in the rendered (sort_order asc) list — id + its current rank. */
export interface OrderedFolder {
  id: string;
  sortOrder: number;
}

export interface ReorderFolderArgs {
  /** The dragged folder's id (decoded from `active.id`). */
  draggedId: string;
  /** Its current `sort_order` — used to detect a no-op drop into its own slot. */
  draggedSortOrder: number;
  /**
   * The rendered folder list in display order (sort_order asc), **EXCLUDING** the dragged
   * folder. The handler translates the rendered gap index into an `insertIndex` relative to
   * this excluded list.
   */
  otherFolders: readonly OrderedFolder[];
  /** The slot to insert at, in `otherFolders` coordinates (0..otherFolders.length). */
  insertIndex: number;
}

export interface FolderReorder {
  /** The dragged folder, which is moved. */
  folderId: string;
  /** Its new fractional `sort_order`. */
  sortOrder: number;
}

/**
 * Resolve a drop into a folder reorder-gap into the reorder it should trigger, or `null` when
 * the folder was dropped back into the slot it already occupies (its current index — the count
 * of folders ranked before it — is reproduced by both gaps flanking it, and the handler maps
 * both to this same insertIndex).
 */
export function resolveFolderReorder(args: ReorderFolderArgs): FolderReorder | null {
  const { draggedId, draggedSortOrder, otherFolders, insertIndex } = args;

  const currentIndex = otherFolders.filter((folder) => folder.sortOrder < draggedSortOrder).length;
  if (insertIndex === currentIndex) return null;

  const previous = insertIndex > 0 ? (otherFolders[insertIndex - 1]?.sortOrder ?? null) : null;
  const next =
    insertIndex < otherFolders.length ? (otherFolders[insertIndex]?.sortOrder ?? null) : null;

  return { folderId: draggedId, sortOrder: computeInsertOrder(previous, next) };
}
