import { stableSorted } from '@/lib/sort';
import type { WikiPageIndexRow } from '@/lib/types';
import { sortWikiPages } from '@/lib/wiki/sections';

/** The two sections the landing's web draws; sources and questions stay in the nav. */
export type WikiWebSection = 'concepts' | 'entities';

/** One dot on the web: a concept or entity page. */
export interface WikiWebNode {
  /** The page path (`wiki/concepts/x.md`) — the node's id everywhere in the web. */
  path: string;
  title: string;
  section: WikiWebSection;
  /** How many distinct pages it is linked with in the web, either way round. */
  degree: number;
}

/** One undirected edge, its ends in path order (`a < b`), so a link and its reverse are one. */
export interface WikiWebEdge {
  a: string;
  b: string;
}

const isWebSection = (section: string): section is WikiWebSection =>
  section === 'concepts' || section === 'entities';

/** An edge's key: its two ends, in path order. Paths never hold a `|`. */
export const edgeKey = (edge: WikiWebEdge): string => `${edge.a}|${edge.b}`;

/**
 * The web of the wiki's concepts and entities, built from the index alone (no bodies).
 *
 * Nodes are every concept and entity page in index order — the order matters, since the physics
 * places its first frame by array index and the layout must be the same every run. Edges are the
 * outbound links between two of those pages, direction discarded: a link to a source, a question,
 * a page not in the snapshot, or the page itself isn't drawn. Edges come sorted by their ends, so
 * the order links are written in a page's frontmatter never moves the layout.
 */
export function buildWikiWeb(pages: readonly WikiPageIndexRow[]): {
  nodes: WikiWebNode[];
  edges: WikiWebEdge[];
} {
  const drawn = sortWikiPages(pages).flatMap(({ path, title, section, links }) =>
    isWebSection(section) ? [{ path, title, section, links }] : [],
  );
  const known = new Set(drawn.map((page) => page.path));

  const edges = new Map<string, WikiWebEdge>();
  for (const page of drawn) {
    for (const target of page.links) {
      if (target === page.path || !known.has(target)) continue;
      const edge = page.path < target ? { a: page.path, b: target } : { a: target, b: page.path };
      edges.set(edgeKey(edge), edge);
    }
  }
  const sorted = stableSorted([...edges.entries()], ([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  ).map(([, edge]) => edge);

  const degree = new Map<string, number>();
  for (const { a, b } of sorted) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }

  return {
    nodes: drawn.map(({ path, title, section }) => ({
      path,
      title,
      section,
      degree: degree.get(path) ?? 0,
    })),
    edges: sorted,
  };
}
