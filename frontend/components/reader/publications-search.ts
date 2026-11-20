import type { ReaderPublicationListItem } from '@/lib/types';

/**
 * Whether a roster publication answers the publications search box's query: a case-insensitive
 * substring match over every text the owner might remember it by — its name, a sender's handle
 * and domain, a feed's URL, and the note they left on it. A blank query matches everything, so an
 * empty box shows the whole roster.
 */
export function matchesPublicationQuery(
  publication: ReaderPublicationListItem,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return [
    publication.name,
    publication.handle,
    publication.domain,
    publication.feed_url,
    publication.notes,
  ].some((field) => field?.toLowerCase().includes(needle) === true);
}
