import type { Item } from '@/lib/types';

/**
 * Inbox **residency** — the one place the rule lives.
 *
 * An item's `folder_id` says where it would *land*; `dispatched_at` says whether it has actually
 * *left* the Inbox. They are two different facts, because a folder can be filled in by something
 * other than a human decision, and an item must not slip out of the Inbox before its owner has
 * seen it. Only a human act stamps `dispatched_at`.
 *
 * Every read site — the Inbox and folder lists, the folder badge tallies, the "where does this
 * live" labels, the keyed list endpoint — goes through these two functions, so the rule can never
 * be half-applied.
 */

/** True once a human has dispatched this item out of the Inbox. */
export function isDispatched(item: Pick<Item, 'dispatched_at'>): boolean {
  return item.dispatched_at !== null;
}

/**
 * The folder an item actually LIVES in — `null` while it is still in the Inbox, whatever
 * `folder_id` holds. The one function that turns location into residency.
 */
export function residentFolderId(item: Pick<Item, 'dispatched_at' | 'folder_id'>): string | null {
  return isDispatched(item) ? item.folder_id : null;
}
