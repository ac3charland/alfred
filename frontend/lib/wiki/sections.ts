import { stableSorted } from '@/lib/sort';
import type { WikiPageIndexRow } from '@/lib/types';

/**
 * The wiki's four page sections and the path ↔ URL rules every wiki surface shares: the Worker
 * snapshots exactly these four folders, the module routes `/wiki/<section>/<name>` to
 * `wiki/<section>/<name>.md`, and the index sorts pages the way the wiki's own generated
 * `index.md` does. One home, so the nav, the views, ⌘K and ⌘P cannot disagree on a section's
 * name or order.
 */

export const WIKI_SECTIONS = ['concepts', 'entities', 'sources', 'questions'] as const;

export type WikiSection = (typeof WIKI_SECTIONS)[number];

/** Each section's plural heading and singular eyebrow. */
export const WIKI_SECTION_LABELS: Record<WikiSection, { plural: string; singular: string }> = {
  concepts: { plural: 'Concepts', singular: 'Concept' },
  entities: { plural: 'Entities', singular: 'Entity' },
  sources: { plural: 'Sources', singular: 'Source' },
  questions: { plural: 'Questions', singular: 'Question' },
};

export function isWikiSection(value: string): value is WikiSection {
  return (WIKI_SECTIONS as readonly string[]).includes(value);
}

/** The one shape a snapshotted page path takes; the body route refuses anything else. */
export const WIKI_PAGE_PATH = /^wiki\/(concepts|entities|sources|questions)\/([^/]+)\.md$/;

/** The section and file stem of a page path, or `undefined` for a path outside the snapshot. */
export function splitWikiPath(path: string): { section: WikiSection; name: string } | undefined {
  const match = WIKI_PAGE_PATH.exec(path);
  const section = match?.[1];
  const name = match?.[2];
  if (section === undefined || name === undefined || !isWikiSection(section)) return undefined;
  return { section, name };
}

/** `wiki/<section>/<name>.md` — the path a section + stem names. */
export function wikiPagePath(section: WikiSection, name: string): string {
  return `wiki/${section}/${name}.md`;
}

/** The in-app URL of a page: `/wiki/<section>/<name>`, or the index for a path outside it. */
export function wikiPageHref(path: string): string {
  const split = splitWikiPath(path);
  return split === undefined ? '/wiki' : `/wiki/${split.section}/${split.name}`;
}

/** A section's rank in the wiki's own order. */
function sectionRank(section: string): number {
  const index = (WIKI_SECTIONS as readonly string[]).indexOf(section);
  return index === -1 ? WIKI_SECTIONS.length : index;
}

/**
 * The index order: section by section in the wiki's order, then by lower-cased title in plain
 * code-unit order (never `localeCompare`, whose answer depends on the machine), ties by path.
 */
export function compareWikiPages(a: WikiPageIndexRow, b: WikiPageIndexRow): number {
  const bySection = sectionRank(a.section) - sectionRank(b.section);
  if (bySection !== 0) return bySection;
  const aTitle = a.title.toLowerCase();
  const bTitle = b.title.toLowerCase();
  if (aTitle < bTitle) return -1;
  if (aTitle > bTitle) return 1;
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

/** A copy of `pages` in index order. */
export function sortWikiPages(pages: readonly WikiPageIndexRow[]): WikiPageIndexRow[] {
  return stableSorted(pages, compareWikiPages);
}
