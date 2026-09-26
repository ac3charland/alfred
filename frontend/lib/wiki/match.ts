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
