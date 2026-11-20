import type { ReaderCandidate, ReaderPublicationListItem } from '@/lib/types';

/** Whether any of `fields` contains the trimmed `query`, ignoring case; a blank query matches. */
function matchesQuery(fields: readonly (string | null)[], query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return fields.some((field) => field?.toLowerCase().includes(needle) === true);
}

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
  return matchesQuery(
    [
      publication.name,
      publication.handle,
      publication.domain,
      publication.feed_url,
      publication.notes,
    ],
    query,
  );
}

/** Whether an off-roster candidate answers the same query, by its display name or its handle. */
export function matchesCandidateQuery(candidate: ReaderCandidate, query: string): boolean {
  return matchesQuery([candidate.name, candidate.handle], query);
}
