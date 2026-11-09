import { XMLParser } from 'fast-xml-parser';

/**
 * The check a feed URL passes before it joins the roster: fetch it once, server-side, and refuse
 * anything that isn't RSS or Atom — a pasted homepage is the likeliest mistake, and it should fail
 * at the field rather than silently on the Worker's next poll. On success the feed's own title
 * names its card.
 *
 * What counts as a feed must agree with the Worker's parser (`workers/src/reader/feeds.ts`): a
 * document whose root is `rss` with a `channel`, Atom's `feed`, or RSS 1.0's `rdf:RDF`. This side
 * needs only that verdict and the title, so it reads no entries.
 */

/** Who alfred says it is to a blog's server — the same as the Worker's feed leg. */
export const FEED_USER_AGENT = 'alfred-reader (+https://github.com/ac3charland/alfred)';

/** How long the feed gets to answer. */
export const FEED_PROBE_TIMEOUT_MS = 10_000;

/** The largest feed document the probe reads. */
export const FEED_PROBE_MAX_BYTES = 5_000_000;

/** What the probe found. */
export type FeedProbe =
  | { kind: 'feed'; title: string | undefined }
  | { kind: 'not-a-feed' }
  /** No answer, a timeout, or a non-2xx — `status` is the answer when there was one. */
  | { kind: 'unreachable'; status?: number };

const parser = new XMLParser({
  ignoreAttributes: true,
  textNodeName: '#text',
  parseTagValue: false,
  // Only the title is read, so nothing below the channel needs to survive as anything useful.
  stopNodes: ['*.item', '*.entry'],
});

function isRecord(node: unknown): node is Record<string, unknown> {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

/** A node's text, whether the parser made it a string or an element with a `#text`. */
function textOf(node: unknown): string | undefined {
  const single: unknown = Array.isArray(node) ? (node as unknown[])[0] : node;
  if (typeof single === 'string') return single;
  if (isRecord(single) && typeof single['#text'] === 'string') return single['#text'];
  return undefined;
}

/** A numeric character reference's character, or the reference itself when it names none. */
function codePoint(reference: string, digits: string, radix: number): string {
  const code = Number.parseInt(digits, radix);
  return Number.isNaN(code) || code > 0x10_ff_ff ? reference : String.fromCodePoint(code);
}

/**
 * Markup out, character references decoded, whitespace collapsed. The parser decodes the XML
 * layer; an HTML-typed title (`type="html"`, or an RSS title escaped twice) still carries tags and
 * references of its own.
 */
function plainTitle(raw: string | undefined): string | undefined {
  const text = (raw ?? '')
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll(/&#x([\da-f]+);/gi, (reference, hex: string) => codePoint(reference, hex, 16))
    .replaceAll(/&#(\d+);/g, (reference, decimal: string) => codePoint(reference, decimal, 10))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return text === '' ? undefined : text;
}

/**
 * Whether a document is a feed, and its title if so. `undefined` for anything else: not XML, or
 * XML whose root is none of the three feed roots — an HTML page among them.
 */
export function sniffFeed(xml: string): { title: string | undefined } | undefined {
  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch {
    return undefined;
  }
  if (!isRecord(document)) return undefined;

  // An empty `<channel></channel>` parses as a string rather than an element: it is still a feed.
  const rss = document['rss'];
  if (isRecord(rss) && rss['channel'] !== undefined) {
    const channel = rss['channel'];
    return { title: plainTitle(isRecord(channel) ? textOf(channel['title']) : undefined) };
  }
  const atom = document['feed'];
  if (isRecord(atom)) return { title: plainTitle(textOf(atom['title'])) };
  const rdf = document['rdf:RDF'];
  if (isRecord(rdf)) {
    const channel = rdf['channel'];
    return { title: plainTitle(isRecord(channel) ? textOf(channel['title']) : undefined) };
  }
  return undefined;
}

/**
 * A feed URL as the roster stores it: trimmed, scheme and host lower-cased (the `URL` parser does
 * both), the fragment dropped, the path and query as typed. `undefined` for anything not
 * `http(s)`.
 */
export function normaliseFeedUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  url.hash = '';
  return url.href;
}

/** The name a feed with no title of its own is given: its host, without `www.`. */
export function feedHostName(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

/** A body as text, read no further than `maxBytes`; `undefined` when it runs past. */
async function readCapped(response: Response, maxBytes: number): Promise<string | undefined> {
  const declared = Number.parseInt(response.headers.get('Content-Length') ?? '', 10);
  if (!Number.isNaN(declared) && declared > maxBytes) {
    await response.body?.cancel();
    return undefined;
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Fetch a feed URL and say whether it is a feed. A body past the size cap reads as not a feed —
 * nothing that large is a blog's feed, and the Worker would refuse it too.
 */
export async function probeFeed(
  url: string,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<FeedProbe> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: {
        'User-Agent': FEED_USER_AGENT,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(FEED_PROBE_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    return { kind: 'unreachable' };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { kind: 'unreachable', status: response.status };
  }

  let body: string | undefined;
  try {
    body = await readCapped(response, FEED_PROBE_MAX_BYTES);
  } catch {
    return { kind: 'unreachable' };
  }
  const sniffed = body === undefined ? undefined : sniffFeed(body);
  return sniffed === undefined ? { kind: 'not-a-feed' } : { kind: 'feed', title: sniffed.title };
}
