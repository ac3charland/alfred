import { residentFolderId } from '@/lib/tasks/residency';
import type { Item } from '@/lib/types';

/**
 * Pure logic for the drag-a-task-to-a-folder interaction (see the dnd-kit skill).
 *
 * dnd-kit reports a drop only as `active.id` / `over.id`; this module turns that pair
 * (plus the task's current folder) into the move it should trigger, or a no-op. Keeping
 * it pure makes it unit-testable, since jsdom can't measure layout to drive a real drag.
 */

/**
 * Droppable id for the sidebar Inbox target. dnd-kit ids must be defined, so the Inbox
 * (a null `folder_id`) can't use `null` as its id — it uses this sentinel, which
 * {@link resolveFolderDrop} maps back to `null`.
 */
// Stryker disable next-line StringLiteral: AT_CEILING — an opaque sentinel id used only by reference (compared against itself in resolveFolderDrop and handed to dnd-kit as a droppable id); its exact spelling is arbitrary as long as it can't collide with a real folder id, so mutating the literal is unobservable.
export const INBOX_DROP_ID = '__inbox__';

export interface FolderMove {
  itemId: string;
  /** Target folder, or `null` for the Inbox. */
  folderId: string | null;
}

/**
 * Resolve a drag-to-folder drop into the move it should trigger, or `null` for a no-op
 * (dropped on nothing, or onto where the task already LIVES — its resident folder, not its
 * `folder_id` label: an Inbox item labelled with a folder still has to be filed into it).
 *
 * @param itemId  the dragged task's id (`active.id`)
 * @param overId  the drop target's id (`over.id`), or `null` if dropped on nothing
 * @param item    the dragged task's location fields
 */
export function resolveFolderDrop(
  itemId: string,
  overId: string | null,
  item: Pick<Item, 'folder_id' | 'dispatched_at'>,
): FolderMove | null {
  if (overId === null) return null;
  const folderId = overId === INBOX_DROP_ID ? null : overId;
  if (folderId === residentFolderId(item)) return null;
  return { itemId, folderId };
}
