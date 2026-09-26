import type { WikiPageIndexRow } from '@/lib/types';

/**
 * The one matcher ⌘P and the Wiki module's instant search share, so a page ranks the same in
 * both. Instant means the index columns only — title, summary, tags — never the body, which is
 * Postgres full-text search's job (the module's second, debounced group).
 *
 * `0` for a title prefix, `1` for a title substring, `2` for a summary or tag match, `null` for
 * no match. Matching is whitespace- and case-insensitive; an empty query matches nothing.
 */
export function rankWikiPage(query: string, page: WikiPageIndexRow): 0 | 1 | 2 | null {
  const q = query.trim().toLowerCase();
  if (q === '') return null;
  const title = page.title.toLowerCase();
  if (title.startsWith(q)) return 0;
  if (title.includes(q)) return 1;
  if (page.summary.toLowerCase().includes(q)) return 2;
  if (page.tags.some((tag) => tag.toLowerCase().includes(q))) return 2;
  return null;
}

/** What {@link compareWikiMatches} orders by: a page's rank for the query, and its `updated`. */
export interface WikiMatchOrder {
  rank: number;
  updated: string | null;
}

/**
 * The order after {@link rankWikiPage}, shared by ⌘P and the module's instant search: best rank
 * first, then `updated` newest first, with a never-updated page (`null`) last within its rank.
 * Plain string comparison, never `localeCompare` — an ISO `YYYY-MM-DD` date orders correctly as a
 * string and stays independent of the machine's locale (the `sections.ts` convention). Ties are
 * `0`, so a stable sort keeps them in arrival order.
 */
export function compareWikiMatches(a: WikiMatchOrder, b: WikiMatchOrder): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.updated === b.updated) return 0;
  if (a.updated === null) return 1;
  if (b.updated === null) return -1;
  return a.updated > b.updated ? -1 : 1;
}
