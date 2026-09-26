import { type WikiSection, isWikiSection, wikiPagePath } from '@/lib/wiki/sections';

/**
 * What a `/wiki…` URL names — derived from the pathname alone, the way every module's view router
 * derives its view, so a hard load, a deep link and a `pushState` all land on the same view.
 */
export type WikiRoute =
  | { kind: 'index' }
  | { kind: 'section'; section: WikiSection }
  | { kind: 'page'; path: string }
  | { kind: 'not-found' };

/**
 * A URL segment as the file stem it names. A browser percent-encodes a stem with a space in it,
 * so the segment is decoded — unless that stem is not in the snapshot while the literal one is (a
 * file literally named `habit%20loop.md`, which the wiki's literal link rule can reach).
 */
function pagePathFor(section: WikiSection, segment: string, index: ReadonlySet<string>): string {
  const literal = wikiPagePath(section, segment);
  let decoded: string;
  try {
    decoded = wikiPagePath(section, decodeURIComponent(segment));
  } catch {
    return literal;
  }
  return index.has(decoded) || !index.has(literal) ? decoded : literal;
}

/** The route `pathname` names, resolved against the snapshot's page paths. */
export function parseWikiRoute(pathname: string, index: ReadonlySet<string>): WikiRoute {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  if (segments[0] !== 'wiki') return { kind: 'not-found' };
  const [, section, name, ...rest] = segments;
  if (section === undefined) return { kind: 'index' };
  if (!isWikiSection(section) || rest.length > 0) return { kind: 'not-found' };
  if (name === undefined) return { kind: 'section', section };
  const path = pagePathFor(section, name, index);
  return index.has(path) ? { kind: 'page', path } : { kind: 'not-found' };
}
