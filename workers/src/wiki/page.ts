/**
 * One wiki page's text → the `wiki_pages` row fields the snapshot stores. Pure: no I/O, no clock.
 *
 * It follows the knowledge repo's own reading of a page (its `parseFile`, `titleFor` and
 * `extractLinks`) so the snapshot never disagrees with the wiki's lint about what a page says or
 * links to. Link resolution here feeds backlinks; the frontend's link renderer
 * (lib/wiki/links.ts) resolves the same hrefs in the browser, and both suites pin the same
 * href table, so a backlink and an in-app link always name the same page.
 */
import { parse } from 'yaml';

/** The four page folders the snapshot covers, in the order the wiki lists them. */
export const WIKI_SECTIONS = ['concepts', 'entities', 'sources', 'questions'] as const;

export type WikiSection = (typeof WIKI_SECTIONS)[number];

/** The one shape a snapshotted page path takes: a `.md` file directly inside a section. */
const WIKI_PAGE_PATH = /^wiki\/(concepts|entities|sources|questions)\/([^/]+)\.md$/;

/**
 * `YYYY-MM-DD` with a year from 0001 to 9999; the calendar check happens in `realDate`. Year 0000
 * is refused here because a JS `Date` round-trips it but Postgres rejects it as a `date` — and a
 * page whose upsert always fails would sit at the front of every run's sorted batch forever.
 */
const ISO_DATE = /^(?!0000)\d{4}-\d{2}-\d{2}$/;

/**
 * NUL. Postgres refuses it in `text` (22P05), which would fail the whole upsert batch, so it is
 * stripped from every stored string — the raw page text and every decoded YAML string (a
 * double-quoted `"\0"` produces one).
 */
const NUL = '\u0000';

/** Any URL scheme (`https:`, `mailto:`, …) — an href carrying one is never a page link. */
const SCHEME = /^[a-z][\d+.a-z-]*:/i;

/**
 * A markdown link, `[text](target)` or `[text](target "title")`, and NOT an image: the lookbehind
 * refuses a `!` before the bracket, since `![alt](src)` embeds a file rather than linking a page.
 */
const LINK = /(?<!!)\[[^\]]*\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

/** A fence line: up to three spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * An inline code span: a backtick run, anything, the same-length run — never across a blank
 * line, since a code span, like CommonMark's, cannot cross a paragraph break.
 */
const INLINE_CODE = /(`+)(?:(?!\n[\t ]*\n)[\s\S])*?\1/g;

/** The row fields `parsePage` derives. The sync adds `blob_oid`, `commit_oid` and `synced_at`. */
export interface ParsedPage {
  path: string;
  section: WikiSection;
  title: string;
  summary: string;
  tags: string[];
  sources: string[];
  links: string[];
  /** `YYYY-MM-DD`, or undefined when absent or not a real date — the column is then null. */
  created: string | undefined;
  updated: string | undefined;
  body: string;
  /** Why the page could not be read as a page, or undefined when it could. */
  parse_error: string | undefined;
}

/** The section of a page path. The sync only ever hands this a path from the four folders. */
export function sectionOf(path: string): WikiSection {
  const section = WIKI_PAGE_PATH.exec(path)?.[1];
  const found = WIKI_SECTIONS.find((candidate) => candidate === section);
  if (found === undefined) throw new Error(`not a wiki page path: ${path}`);
  return found;
}

/** The file stem — `wiki/concepts/habit-loop.md` → `habit-loop` — the title of last resort. */
function stemOf(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  return file.endsWith('.md') ? file.slice(0, -'.md'.length) : file;
}

/**
 * Split the frontmatter off the way the wiki's `parseFile` does: CRLF normalised, a leading
 * `---\n`, then the next `\n---`. No closing fence means no frontmatter at all. The newline that
 * ends the closing fence line belongs to the fence, not the body.
 */
function splitFrontmatter(text: string): { yaml: string | undefined; body: string } {
  const normalised = text.replaceAll('\r\n', '\n');
  if (!normalised.startsWith('---\n')) return { yaml: undefined, body: normalised };
  const close = normalised.indexOf('\n---', 3);
  if (close === -1) return { yaml: undefined, body: normalised };
  const yaml = normalised.slice(4, Math.max(4, close));
  const rest = normalised.slice(close + '\n---'.length);
  return { yaml, body: rest.startsWith('\n') ? rest.slice(1) : rest };
}

type Frontmatter = Record<string, unknown>;

function isMapping(value: unknown): value is Frontmatter {
  return typeof value === 'object' && value != undefined && !Array.isArray(value);
}

/** Parse the YAML block, or say why it is not a frontmatter mapping. An empty block is `{}`. */
function readFrontmatter(yaml: string): { data: Frontmatter } | { error: string } {
  let value: unknown;
  try {
    value = parse(yaml);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { error: `invalid frontmatter YAML: ${reason}` };
  }
  if (value == undefined) return { data: {} };
  if (!isMapping(value)) return { error: 'frontmatter is not a YAML mapping' };
  return { data: value };
}

/** `value` with every NUL removed. */
function withoutNul(value: string): string {
  return value.replaceAll(NUL, '');
}

/** A string field, NUL-free and trimmed — or undefined when absent, not a string, or blank. */
function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = withoutNul(value).trim();
  return cleaned === '' ? undefined : cleaned;
}

/** A list of non-empty, NUL-free strings; anything else in it, or a non-list, contributes nothing. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => withoutNul(item))
    .filter((item) => item.trim() !== '');
}

/**
 * `YYYY-MM-DD` that names a day the calendar has, else undefined. The round trip through `Date`
 * is the calendar check: Feb 30 either fails to parse or rolls into March, and neither prints
 * back as the string it came from.
 */
function realDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10) === value ? value : undefined;
}

/**
 * Blank out code so a link written inside it is not read as a link: fenced blocks first (a
 * backtick or tilde fence, closed by a same-character run at least as long, or by the end of the
 * page), then inline code spans. Every line of a fenced block, fences included, becomes an empty
 * line — which also stops an inline span from reaching across it; an inline span becomes spaces.
 */
function maskCode(text: string): string {
  const lines = text.split('\n');
  let fence: string | undefined;
  const masked = lines.map((line) => {
    const open = FENCE.exec(line)?.[1];
    if (fence === undefined) {
      if (open === undefined) return line;
      fence = open;
      return '';
    }
    if (open !== undefined && open.startsWith(fence.charAt(0)) && open.length >= fence.length) {
      fence = undefined;
    }
    return '';
  });
  return masked.join('\n').replaceAll(INLINE_CODE, (span) => ' '.repeat(span.length));
}

/**
 * Every markdown link target in `text`, in order, with code masked and images skipped. Inline
 * `[text](target)` links only, mirroring the scope of the wiki's own `extractLinks`: a
 * reference-style `[text][ref]` link still renders as a link in the reading room, but produces no
 * backlink.
 */
export function extractLinks(text: string): string[] {
  const targets: string[] = [];
  for (const match of maskCode(text).matchAll(LINK)) {
    const raw = match[1] ?? '';
    targets.push(raw.startsWith('<') ? raw.slice(1, -1) : raw);
  }
  return targets;
}

/**
 * Resolve `href`, as written on the page at `pagePath`, to the wiki page path it names — or
 * undefined when it names none. Resolution is literal (no URL-decoding, like the wiki's lint),
 * relative to the page's folder, with the `#anchor` stripped. Only a `.md` file directly inside
 * one of the four sections counts; a target that climbs out of the repo is not one.
 */
export function resolveLink(pagePath: string, href: string): string | undefined {
  const target = href.split('#', 1)[0] ?? '';
  if (target === '' || target.startsWith('/') || SCHEME.test(target)) return undefined;

  const segments = pagePath.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  const resolved = segments.join('/');
  return WIKI_PAGE_PATH.test(resolved) ? resolved : undefined;
}

/**
 * `items` in plain code-unit order of `key` (stable whatever the locale), as a new array. A binary
 * insertion rather than `.sort()` (unicorn/no-array-sort) or `.toSorted()` (not in this package's
 * ES2022 lib) — see the eslint skill's circular-constraint note — and binary so a first sync over
 * a whole tree stays O(n log n) comparisons inside the 10ms CPU budget.
 */
export function sortedBy<T>(items: Iterable<T>, key: (item: T) => string): T[] {
  const sorted: T[] = [];
  const keys: string[] = [];
  for (const item of items) {
    const itemKey = key(item);
    let low = 0;
    let high = keys.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((keys[middle] ?? '') <= itemKey) low = middle + 1;
      else high = middle;
    }
    sorted.splice(low, 0, item);
    keys.splice(low, 0, itemKey);
  }
  return sorted;
}

/** The page's outbound wiki links: resolved, deduped, the page itself dropped, sorted. */
function linksOf(pagePath: string, body: string): string[] {
  const resolved = new Set<string>();
  for (const href of extractLinks(body)) {
    const path = resolveLink(pagePath, href);
    if (path !== undefined && path !== pagePath) resolved.add(path);
  }
  return sortedBy(resolved, (path) => path);
}

/** A page as the snapshot stores it when there is no frontmatter to trust. */
function bare(path: string, body: string, parseError?: string): ParsedPage {
  return {
    path,
    section: sectionOf(path),
    title: stemOf(path),
    summary: '',
    tags: [],
    sources: [],
    links: linksOf(path, body),
    created: undefined,
    updated: undefined,
    body,
    parse_error: parseError,
  };
}

/**
 * Parse one page's text into its row fields. Invalid frontmatter is recorded, not thrown: the
 * page is still stored, as its whole text under its file stem, with `parse_error` saying why.
 */
export function parsePage(path: string, text: string): ParsedPage {
  const clean = withoutNul(text);
  const { yaml, body } = splitFrontmatter(clean);
  if (yaml === undefined) return bare(path, body);

  const frontmatter = readFrontmatter(yaml);
  if ('error' in frontmatter) return bare(path, clean.replaceAll('\r\n', '\n'), frontmatter.error);

  const { data } = frontmatter;
  return {
    ...bare(path, body),
    title: nonBlankString(data['title']) ?? stemOf(path),
    summary: typeof data['summary'] === 'string' ? withoutNul(data['summary']) : '',
    tags: stringList(data['tags']),
    sources: stringList(data['sources']),
    created: realDate(data['created']),
    updated: realDate(data['updated']),
  };
}

/**
 * The row for a blob the snapshot cannot read as text — binary, or cut short by GitHub. It keeps
 * its place in the index under its file stem, with an empty body and the reason recorded.
 */
export function unreadablePage(path: string, reason: string): ParsedPage {
  return bare(path, '', reason);
}
