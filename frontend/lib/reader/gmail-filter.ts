import { stableSorted } from '@/lib/sort';
import type { ReaderPublicationListItem } from '@/lib/types';

/**
 * The Gmail filter query that keeps the owner's hand-maintained inbox rule matched to the
 * roster: `from:(a OR b OR …)` over every ENABLED handle, sorted so the string is stable across
 * renders and diffable across pastes into gmail.com/settings/filters.
 *
 * Handles, never domains: a per-address term is exact, while `from:substack.com` would also
 * archive Substack's own platform mail, which the roster deliberately excludes. Only the query
 * itself is produced — the filter's actions (skip the inbox, apply a label) are the owner's to
 * set once in Gmail, since alfred never holds a write scope there.
 */
export function gmailFilterQuery(publications: ReaderPublicationListItem[]): string | null {
  const handles = stableSorted(
    publications.filter((publication) => publication.enabled).map((row) => row.handle),
    (a, b) => a.localeCompare(b),
  );

  if (handles.length === 0) return null;

  return `from:(${handles.join(' OR ')})`;
}
