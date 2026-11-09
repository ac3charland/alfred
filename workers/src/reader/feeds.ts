/**
 * RSS and Atom feeds, read: everything the feed leg decides that does not touch the network.
 *
 * A feed is a roster row with a `feed_url` rather than a sender handle. The leg (`feed-leg.ts`)
 * polls one due feed per tick; this module turns the feed's XML into entries, decides each
 * entry's identity, date and whether its body is only an excerpt, picks the entries a poll takes,
 * and reads an entry page's article when the feed carried only an excerpt.
 *
 * Workers have no `DOMParser`, so the XML is read with `fast-xml-parser` (pure JS). A feed is a
 * document whose root is `rss` (with a `channel`), Atom's `feed`, or RSS 1.0's `rdf:RDF` —
 * `frontend/lib/reader/feed-probe.ts` applies the same test when a feed is added, so a URL the
 * route accepted is one the leg can read.
 */
import { XMLParser } from 'fast-xml-parser';

import { htmlToText } from '../comms/email-text';

/** How far back a poll looks: an entry dated earlier is never imported. Mirrors the worklist's. */
export const FEED_HORIZON_MS = 7 * 24 * 60 * 60_000;

/** How long a checked feed rests before it is due again. */
export const FEED_POLL_INTERVAL_MS = 60 * 60_000;

/**
 * How many entries, from the top of the document, a poll considers. Bounds an undated feed — its
 * every entry is dated at the poll instant, so in-horizon — and a feed that republishes its
 * archive.
 */
export const FEED_ENTRY_LIMIT = 20;

/** A body under this many words is an excerpt, and the entry's own page is read for the article. */
export const EXCERPT_WORDS = 250;

/** The largest feed document or entry page the leg reads. */
export const FEED_MAX_BYTES = 5_000_000;

/** One entry as the feed wrote it, before the poll decides anything about it. */
export interface FeedEntry {
  /** Atom `id`, RSS `guid` or RDF `rdf:about`, as written. */
  id?: string | undefined;
  /** The title, tags stripped, entities decoded and whitespace collapsed. Empty when it has none. */
  title: string;
  /** The entry's page: an `http(s)` URL, a relative one already resolved against the feed's. */
  link?: string | undefined;
  author?: string | undefined;
  /** The date as written, unparsed: Atom `published` ?? `updated`, RSS `pubDate` ?? `dc:date`. */
  rawDate?: string | undefined;
  /** The body's HTML: Atom `content` ?? `summary`, RSS `content:encoded` ?? `description`. */
  html: string;
  /** True when the body is only the summary field — the case a trailing "…" marks as an excerpt. */
  summaryOnly: boolean;
}

/** A parsed feed: its own title and author, and its entries in document order. */
export interface ParsedFeed {
  title?: string | undefined;
  author?: string | undefined;
  entries: FeedEntry[];
}

/** An entry once the poll has given it an identity and a date. */
export interface DatedEntry extends FeedEntry {
  identity: string;
  /** Clamped to the poll instant: a missing or future date reads as now. */
  date: Date;
}

/** One roster row as the leg's choice of feed needs it. */
export interface FeedRosterRow {
  id: string;
  name: string;
  enabled: boolean;
  feed_url?: string | undefined;
  feed_checked_at?: string | undefined;
}

/** Elements that can repeat, kept as arrays even when a document carries one. */
const REPEATING = new Set(['entry', 'item', 'link', 'author', 'guid']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // Every value a string: a numeric guid or title must not arrive as a number.
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => REPEATING.has(name),
});

/** A parsed XML node: a string, or an element object with attributes and children. */
type XmlNode = unknown;

function isRecord(node: XmlNode): node is Record<string, unknown> {
  return typeof node === 'object' && Boolean(node) && !Array.isArray(node);
}

/** The first of a node that may be an array. */
function first(node: XmlNode): XmlNode {
  return Array.isArray(node) ? (node as unknown[])[0] : node;
}

/** A node's own text. An element of nested markup (Atom `type="xhtml"`) gives its text runs. */
function textOf(node: XmlNode): string | undefined {
  const single = first(node);
  if (typeof single === 'string') return single;
  if (!isRecord(single)) return undefined;
  const own = single['#text'];
  if (typeof own === 'string') return own;
  const runs = Object.entries(single)
    .filter(([key]) => !key.startsWith('@_'))
    .map(([, child]) => textOf(child) ?? '')
    .filter((run) => run !== '');
  return runs.length === 0 ? undefined : runs.join(' ');
}

/** An attribute of a node. */
function attribute(node: XmlNode, name: string): string | undefined {
  const single = first(node);
  if (!isRecord(single)) return undefined;
  const value = single[`@_${name}`];
  return typeof value === 'string' ? value : undefined;
}

/** A trimmed, non-empty string, or nothing. */
function present(value?: string): string | undefined {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? undefined : trimmed;
}

/** Markup and entities out, whitespace collapsed to single spaces. */
function plain(value?: string): string {
  return htmlToText(value ?? '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/**
 * A link as a row may hold it: resolved against `base` when relative, and kept only when the
 * result is `http`/`https` — a `javascript:` or `mailto:` link is no link at all.
 */
export function webLink(href: string | undefined, base?: string): string | undefined {
  const trimmed = present(href);
  if (trimmed === undefined) return undefined;
  try {
    const url = base === undefined ? new URL(trimmed) : new URL(trimmed, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** The document's root, named, when it is one of the three feed roots. */
function feedRoot(
  document: Record<string, unknown>,
): { kind: 'rss' | 'atom' | 'rdf'; node: Record<string, unknown> } | undefined {
  // An empty `<channel></channel>` parses as a string rather than an element: it is still a feed.
  const rss = first(document['rss']);
  if (isRecord(rss) && rss['channel'] !== undefined) return { kind: 'rss', node: rss };
  const atom = first(document['feed']);
  if (isRecord(atom)) return { kind: 'atom', node: atom };
  const rdf = first(document['rdf:RDF']);
  if (isRecord(rdf)) return { kind: 'rdf', node: rdf };
  return undefined;
}

/** The entries' array, whatever the parser made of it. */
function nodes(value: unknown): Record<string, unknown>[] {
  const list = Array.isArray(value) ? (value as unknown[]) : [value];
  return list.filter((node) => isRecord(node));
}

/** An Atom entry's page: the `alternate` link (or one with no `rel`), preferring HTML. */
function atomLink(entry: Record<string, unknown>): string | undefined {
  const links = nodes(entry['link']);
  const alternates = links.filter((link) => {
    const rel = attribute(link, 'rel');
    return rel === undefined || rel === 'alternate';
  });
  const html = alternates.find((link) => attribute(link, 'type')?.includes('html') === true);
  return attribute(html ?? alternates[0], 'href');
}

/** An Atom author's name. */
function atomAuthor(node: Record<string, unknown>): string | undefined {
  const author = first(node['author']);
  return isRecord(author) ? present(textOf(author['name'])) : undefined;
}

function atomEntry(entry: Record<string, unknown>, base?: string): FeedEntry {
  const content = textOf(entry['content']);
  const summary = textOf(entry['summary']);
  return {
    id: present(textOf(entry['id'])),
    title: plain(textOf(entry['title'])),
    link: webLink(atomLink(entry), base),
    author: atomAuthor(entry),
    rawDate: present(textOf(entry['published'])) ?? present(textOf(entry['updated'])),
    html: content ?? summary ?? '',
    summaryOnly: present(content) === undefined,
  };
}

/** An RSS `author` is an address with the name in parentheses: `a@b.example (Ines Calloway)`. */
function rssAuthor(item: Record<string, unknown>): string | undefined {
  const creator = present(textOf(item['dc:creator']));
  if (creator !== undefined) return creator;
  const author = present(textOf(item['author']));
  if (author === undefined) return undefined;
  return present(/\(([^)]+)\)/.exec(author)?.[1]) ?? author;
}

function rssEntry(item: Record<string, unknown>, base?: string): FeedEntry {
  const encoded = textOf(item['content:encoded']);
  const description = textOf(item['description']);
  const guid = item['guid'];
  const guidText = present(textOf(guid));
  // A guid is the entry's page unless it says it isn't (`isPermaLink="false"`).
  const permalink = attribute(guid, 'isPermaLink') === 'false' ? undefined : guidText;
  return {
    id: guidText ?? present(attribute(item, 'rdf:about')),
    title: plain(textOf(item['title'])),
    link: webLink(textOf(item['link']), base) ?? webLink(permalink, base),
    author: rssAuthor(item),
    rawDate: present(textOf(item['pubDate'])) ?? present(textOf(item['dc:date'])),
    html: encoded ?? description ?? '',
    summaryOnly: present(encoded) === undefined,
  };
}

/**
 * Parse a feed document, or say it isn't one (`undefined`): not XML, or XML whose root is none of
 * `rss`/`channel`, Atom `feed` or `rdf:RDF`. `base` is the feed's own URL, which relative entry
 * links resolve against.
 */
export function parseFeed(xml: string, base?: string): ParsedFeed | undefined {
  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch {
    return undefined;
  }
  if (!isRecord(document)) return undefined;
  const root = feedRoot(document);
  if (root === undefined) return undefined;

  if (root.kind === 'atom') {
    return {
      title: present(plain(textOf(root.node['title']))),
      author: atomAuthor(root.node),
      entries: nodes(root.node['entry']).map((entry) => atomEntry(entry, base)),
    };
  }

  const channel = first(root.node['channel']);
  const channelNode = isRecord(channel) ? channel : {};
  // RSS 2.0 nests its items in the channel; RSS 1.0 makes them the channel's siblings.
  const items = root.kind === 'rss' ? channelNode['item'] : root.node['item'];
  return {
    title: present(plain(textOf(channelNode['title']))),
    author: present(textOf(channelNode['dc:creator'])),
    entries: nodes(items).map((item) => rssEntry(item, base)),
  };
}

/** Lower-case hex of a SHA-256. */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * An entry's identity within its feed: Atom `id`, else RSS `guid`, else its link, else a hash of
 * its title and date. Never its date alone, so an entry whose `updated` moves is still the same
 * entry and is never imported twice.
 */
export async function entryIdentity(entry: FeedEntry): Promise<string> {
  return (
    entry.id ?? entry.link ?? `sha256:${await sha256(`${entry.title}\n${entry.rawDate ?? ''}`)}`
  );
}

/**
 * An entry's date, clamped to `now`: a date that won't parse, or none, is the poll instant — and
 * so is a future one, which would otherwise sit at the top of a newest-first list for good.
 */
export function entryDate(entry: FeedEntry, now: Date): Date {
  const parsed = entry.rawDate === undefined ? Number.NaN : Date.parse(entry.rawDate);
  if (Number.isNaN(parsed) || parsed > now.getTime()) return now;
  return new Date(parsed);
}

/** Words in a stretch of plain text. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((token) => token !== '').length;
}

/** A summary's last words: an ellipsis, or a "read more"-style link. */
const EXCERPT_ENDING = /(?:…|\.\.\.|\[…]|\[\.\.\.])\s*$/;
const READ_MORE_LINK =
  /<a\b[^>]*>\s*(?:read|continue|keep)(?:\s+reading|\s+more)?[^<]{0,40}<\/a>\s*(?:<\/p>\s*)?$/i;

/**
 * Whether an entry's body is an excerpt — under `EXCERPT_WORDS` words, or a summary-only body
 * that trails off in an ellipsis or a "read more" link — so the leg reads the entry's page.
 */
export function isExcerpt(entry: FeedEntry): boolean {
  const text = htmlToText(entry.html);
  if (wordCount(text) < EXCERPT_WORDS) return true;
  if (!entry.summaryOnly) return false;
  return EXCERPT_ENDING.test(text) || READ_MORE_LINK.test(entry.html.trim());
}

/** The chrome around an article: never part of what the summary reads. */
const CHROME = /<(script|style|nav|header|footer|aside|form|noscript)\b[^>]*>[\S\s]*?<\/\1\s*>/gi;

/** From the first opening of `tag` to its last closing: the whole element, nesting and all. */
function section(html: string, tag: string): string | undefined {
  const open = new RegExp(String.raw`<${tag}\b[^>]*>`, 'i').exec(html);
  if (open === null) return undefined;
  const closeIndex = html.toLowerCase().lastIndexOf(`</${tag}`);
  if (closeIndex <= open.index) return undefined;
  return html.slice(open.index + open[0].length, closeIndex);
}

/**
 * An entry page's article as HTML: the first `<article>`, else `<main>`, else `<body>`, with its
 * scripts, styles, navigation, headers, footers, asides and forms removed. No readability
 * library: the blogs that publish feeds are overwhelmingly simple templates, and the summary
 * needs only the prose.
 */
export function pageArticleHtml(html: string): string {
  const article =
    section(html, 'article') ?? section(html, 'main') ?? section(html, 'body') ?? html;
  // Twice: a `<header>` inside an `<article>` survives a pass that ended on the page header.
  return article.replaceAll(CHROME, ' ').replaceAll(CHROME, ' ').trim();
}

/** Whether a feed is due: enabled, and never checked or checked over an hour ago. */
export function isDue(row: FeedRosterRow, now: Date): boolean {
  if (row.feed_url === undefined || !row.enabled) return false;
  if (row.feed_checked_at === undefined) return true;
  return now.getTime() - Date.parse(row.feed_checked_at) >= FEED_POLL_INTERVAL_MS;
}

/**
 * The one feed this tick polls: the most overdue — never-checked first, then the oldest check. A
 * tie falls to the lower id, so two ticks choose alike.
 */
export function dueFeed<Row extends FeedRosterRow>(
  roster: readonly Row[],
  now: Date,
): (Row & { feed_url: string }) | undefined {
  const due = roster.filter((row): row is Row & { feed_url: string } => isDue(row, now));
  due.sort((left, right) => {
    const leftChecked = left.feed_checked_at === undefined ? 0 : Date.parse(left.feed_checked_at);
    const rightChecked =
      right.feed_checked_at === undefined ? 0 : Date.parse(right.feed_checked_at);
    return leftChecked - rightChecked || (left.id < right.id ? -1 : 1);
  });
  return due[0];
}

/** What a poll takes: the new entries it has slots for, and whether that was all of them. */
export interface FeedPlan {
  take: DatedEntry[];
  /** Every new in-horizon entry is in `take`: the feed can be stamped checked. */
  drained: boolean;
}

/**
 * The entries a poll takes: the first `FEED_ENTRY_LIMIT` in the document, those dated within the
 * horizon, not already a post (or repeated earlier in the same document), oldest first, up to
 * `slots`. Oldest first so a feed whose backlog spans ticks drains in the order it was written.
 */
export function planFeedEntries(
  entries: readonly DatedEntry[],
  existing: ReadonlySet<string>,
  now: Date,
  slots: number,
): FeedPlan {
  const seen = new Set(existing);
  const fresh: DatedEntry[] = [];
  for (const entry of entries.slice(0, FEED_ENTRY_LIMIT)) {
    if (now.getTime() - entry.date.getTime() > FEED_HORIZON_MS) continue;
    if (seen.has(entry.identity)) continue;
    seen.add(entry.identity);
    fresh.push(entry);
  }
  // Sorted in place, on the fresh copy: `toSorted` is not in this package's ES2022 lib. A tie
  // keeps document order reversed — a feed lists newest first, so the later entry is the older.
  const indexed = fresh.map((entry, index) => ({ entry, index }));
  indexed.sort(
    (left, right) =>
      left.entry.date.getTime() - right.entry.date.getTime() || right.index - left.index,
  );
  const take = indexed.slice(0, Math.max(0, slots)).map(({ entry }) => entry);
  return { take, drained: take.length === fresh.length };
}
