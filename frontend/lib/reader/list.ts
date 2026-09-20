import { stableSorted } from '@/lib/sort';
import type { ReaderPostListItem } from '@/lib/types';

/**
 * The reading list's membership and order rules, shared by the store's selector and anything
 * else that needs to ask the same two questions of a post: is it still active, and where does
 * it sit in the list.
 */

/** True for a post that hasn't been archived — the reading list's membership rule. */
export function isActive(post: ReaderPostListItem): boolean {
  return post.archived_at === null;
}

/**
 * True for a post the owner has put away — the archive's membership rule, and the complement of
 * {@link isActive} over the store's one post list.
 */
export function isArchived(post: ReaderPostListItem): boolean {
  return post.archived_at !== null;
}

/**
 * The list's own order: most recently arrived first, ties broken stably (the input order is
 * preserved for two posts with the same instant, rather than left to the sort's whim).
 */
export function byReceivedDescending(posts: readonly ReaderPostListItem[]): ReaderPostListItem[] {
  return stableSorted(
    posts,
    (a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime(),
  );
}
