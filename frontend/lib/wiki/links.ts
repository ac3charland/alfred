import { githubBlobUrl, githubTreeUrl } from '@/lib/wiki/github-url';
import { WIKI_PAGE_PATH, wikiPageHref } from '@/lib/wiki/sections';

/**
 * How the reading room renders an href written on a wiki page — the browser's half of the one
 * link table the Worker and the renderer share. The Worker decides which hrefs become a `links`
 * entry (backlinks); this decides what each one IS on screen, and both suites pin the same rows,
 * so a backlink and an in-app link always name the same page.
 *
 * Resolution mirrors the Worker's and the wiki lint's: literal (no URL-decoding), relative to the
 * page's folder, the `#anchor` kept aside. The snapshot holds pages only, so anything else inside
 * the repo — a raw citation, a source folder, the repo's own index — opens on GitHub in a new tab,
 * and without a configured repo there is nowhere to send it, so it renders as broken.
 */

export type WikiLinkTarget =
  /** A page in the snapshot: an in-app link to `/wiki/<section>/<name>`, anchor kept. */
  | { kind: 'page'; href: string }
  /** A heading on this same page. */
  | { kind: 'anchor'; href: string }
  /** Any other file or folder in the repo, on GitHub. */
  | { kind: 'github'; href: string }
  /** The open web: `http(s):` or `mailto:`. */
  | { kind: 'external'; href: string }
  /** Nowhere to go: a page not in the snapshot, a path out of the repo, or no repo to link to. */
  | { kind: 'broken' };

export interface WikiLinkContext {
  /** Every page path in the snapshot. */
  index: ReadonlySet<string>;
  /** The repo's `owner/name`, or `null` when this deployment has none. */
  repo: string | null;
}

/** Any URL scheme — the same test the Worker applies before treating an href as a path. */
const SCHEME = /^[a-z][\d+.a-z-]*:/i;

/** The schemes worth a click. Anything else (`javascript:`, `data:`, …) is never a link. */
const SAFE_SCHEME = /^(?:https?|mailto):/i;

const BROKEN: WikiLinkTarget = { kind: 'broken' };

/** `href` split at its first `#` into the target and the anchor (with its `#`, or ''). */
function splitAnchor(href: string): { target: string; anchor: string } {
  const at = href.indexOf('#');
  return at === -1
    ? { target: href, anchor: '' }
    : { target: href.slice(0, at), anchor: href.slice(at) };
}

/**
 * A dot segment spelled with `%2e` (`%2e%2e`, `.%2E`, …). Resolution is literal, so it is not a
 * `..` here — but GitHub decodes it, so followed there it could climb past the repo. It is
 * neither: a path carrying one goes nowhere.
 */
const ENCODED_DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/**
 * `target` resolved against the folder `base` (repo-relative segments), or `undefined` when a
 * `..` climbs above the repo root or a segment is a percent-encoded dot segment. `folder` records
 * a trailing slash, which names a directory.
 */
function resolvePath(
  base: readonly string[],
  target: string,
): { path: string; folder: boolean } | undefined {
  const segments = [...base];
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..' && ENCODED_DOT_SEGMENT.test(segment)) return undefined;
    if (segment === '..') {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return { path: segments.join('/'), folder: target.endsWith('/') || segments.length === 0 };
}

/** The repo-relative folder a page lives in, as segments. */
function folderOf(pagePath: string): string[] {
  return pagePath.split('/').slice(0, -1);
}

/** A repo path on GitHub: a folder's tree, else a file's blob with its anchor. */
function onGithub(repo: string, path: string, folder: boolean, anchor: string): WikiLinkTarget {
  return folder
    ? { kind: 'github', href: githubTreeUrl(repo, path) }
    : { kind: 'github', href: githubBlobUrl(repo, path, anchor) };
}

/** What `href`, written on the page at `fromPath`, renders as. */
export function resolveWikiLink(
  href: string,
  fromPath: string,
  { index, repo }: WikiLinkContext,
): WikiLinkTarget {
  if (href === '') return BROKEN;
  if (href.startsWith('#')) return { kind: 'anchor', href };
  if (SCHEME.test(href)) return SAFE_SCHEME.test(href) ? { kind: 'external', href } : BROKEN;
  // Protocol-relative: another host, spelled so it reads like a path. Never followed.
  if (href.startsWith('//')) return BROKEN;

  const { target, anchor } = splitAnchor(href);
  // A root-relative href is a path from the repo root, which is how GitHub renders it too.
  const base = target.startsWith('/') ? [] : folderOf(fromPath);
  const resolved = resolvePath(base, target);
  if (resolved === undefined) return BROKEN;

  // The page's own file, with or without an anchor, is a same-page jump: an in-app link to the
  // pathname already on screen would change nothing, and never scroll.
  if (!target.startsWith('/') && resolved.path === fromPath) {
    return { kind: 'anchor', href: anchor === '' ? '#' : anchor };
  }
  if (!target.startsWith('/') && WIKI_PAGE_PATH.test(resolved.path)) {
    return index.has(resolved.path)
      ? { kind: 'page', href: `${wikiPageHref(resolved.path)}${anchor}` }
      : BROKEN;
  }
  if (repo === null) return BROKEN;
  return onGithub(repo, resolved.path, resolved.folder, anchor);
}

/** One frontmatter source as the Sources list draws it: a label, and where it goes (if anywhere). */
export interface WikiSourceLink {
  label: string;
  href: string | undefined;
}

/** `<folder> / <file>` from a repo path's last two segments, anchor appended. */
function sourceLabel(path: string, anchor: string): string {
  const segments = path.split('/').filter((segment) => segment !== '');
  const last = segments.at(-1) ?? path;
  const parent = segments.at(-2);
  return `${parent === undefined ? last : `${parent} / ${last}`}${anchor}`;
}

/**
 * A frontmatter `sources` entry. The wiki writes them repo-relative (`raw/2026/…`); one written
 * page-relative (`../../raw/…`) resolves against the page's folder instead, and a URL links as
 * itself. With no repo, or a path that leaves the repo, the label stands alone.
 */
export function resolveWikiSource(
  source: string,
  fromPath: string,
  repo: string | null,
): WikiSourceLink {
  if (SCHEME.test(source)) {
    return { label: source, href: SAFE_SCHEME.test(source) ? source : undefined };
  }
  const { target, anchor } = splitAnchor(source);
  const relative = target.startsWith('./') || target.startsWith('../');
  const resolved = resolvePath(relative ? folderOf(fromPath) : [], target);
  if (resolved === undefined) return { label: source, href: undefined };

  const label = sourceLabel(resolved.path, anchor);
  if (repo === null) return { label, href: undefined };
  const link = onGithub(repo, resolved.path, resolved.folder, anchor);
  return { label, href: link.kind === 'github' ? link.href : undefined };
}
