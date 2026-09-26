import { stableSorted } from '@/lib/sort';
import type { WikiPageIndexRow, WikiSearchHit } from '@/lib/types';
import { rankWikiPage } from '@/lib/wiki/match';

/**
 * The module search's two result groups, as pure functions of the index and the query — the
 * components only draw them.
 */

/** Newest first; a page with no `updated` date sorts after every dated one. */
function byUpdatedDesc(a: WikiPageIndexRow, b: WikiPageIndexRow): number {
  const aDate = a.updated ?? '';
  const bDate = b.updated ?? '';
  if (aDate === bDate) return 0;
  return aDate < bDate ? 1 : -1;
}

/**
 * "Titles & summaries": every page `rankWikiPage` matches — the one matcher ⌘P shares — best rank
 * first (title prefix, title substring, summary or tag), then most recently updated, then the
 * index order `pages` arrive in.
 */
export function titleMatches(
  pages: readonly WikiPageIndexRow[],
  query: string,
): WikiPageIndexRow[] {
  const ranked: { page: WikiPageIndexRow; rank: number }[] = [];
  for (const page of pages) {
    const rank = rankWikiPage(query, page);
    if (rank !== null) ranked.push({ page, rank });
  }
  // Stable, so pages tied on rank and date keep the index order they arrived in.
  return stableSorted(ranked, (a, b) => a.rank - b.rank || byUpdatedDesc(a.page, b.page)).map(
    ({ page }) => page,
  );
}

/** One "In page text" row: the page and the snippet the body search found in it. */
export interface WikiBodyMatch {
  page: WikiPageIndexRow;
  snippet: string;
}

/**
 * "In page text": the body hits, in the server's rank order, less every page already listed above
 * (`listed`) — a page never appears twice — and less any hit for a page the index doesn't hold
 * (the search read a newer snapshot than this tab), which would have no title to show.
 */
export function bodyMatches(
  hits: readonly WikiSearchHit[],
  pages: readonly WikiPageIndexRow[],
  listed: ReadonlySet<string>,
): WikiBodyMatch[] {
  const byPath = new Map(pages.map((page) => [page.path, page]));
  const matches: WikiBodyMatch[] = [];
  for (const hit of hits) {
    const page = byPath.get(hit.path);
    if (page === undefined || listed.has(hit.path)) continue;
    if (matches.some((match) => match.page.path === hit.path)) continue;
    matches.push({ page, snippet: hit.snippet });
  }
  return matches;
}
