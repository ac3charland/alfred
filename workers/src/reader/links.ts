/**
 * Numbering a post's links for the summariser, so its Further reading list can name them.
 *
 * The stored text has no URLs in it — `htmlToText` drops every href — so the model could only ever
 * name a link by writing its URL out, and a model-written URL can be mistyped or invented. Instead
 * each candidate anchor gets a number, the number rides in the text right where the link sits
 * (`anchor text [3]`), and the URLs follow in a numbered list; the model answers with numbers, and
 * `normalizeReaderSummary` maps them back to URLs the post really contains.
 *
 * The filter here is deliberately mechanical and minimal: it removes only what can never be worth
 * reading — no visible text, not a web link, the post itself, and Substack's own chrome (the
 * byline, the app link, the `redirect/2/<base64>` wrappers the template puts on subscribe and
 * "read next" links). Everything else is a candidate, sponsors and footers included, because
 * telling a source the argument rests on from a passing citation is a judgment only the prose
 * around the link can support, and that is the model's job. Body links in real Substack mail are
 * opaque `substack.com/redirect/<uuid>` wrappers, so no rule about hosts could make it anyway.
 *
 * Wrappers are never unwrapped or resolved: resolving costs a subrequest per link, and Instapaper
 * follows the redirect itself when a link is saved.
 *
 * Pure: the tick, the eval script and the tests all call it on HTML already in memory.
 */
import { ANCHOR, anchorOf } from './extract';

/** The most links one post can number. Past this, anchors are left unmarked and unlisted. */
export const READER_MAX_LINK_CANDIDATES = 150;

/** One numbered candidate: the number the model sees, and the URL it stands for. */
export interface NumberedLink {
  n: number;
  url: string;
}

/** Substack's own host, where the byline, app link and chrome wrappers live. */
const SUBSTACK_HOST = 'substack.com';

/** Substack paths that are the platform's chrome, never a link the post is making. */
const SUBSTACK_CHROME = /^\/(?:@|app-link\/|redirect\/2\/)/;

/** Origin and path, the part of a URL that says which page it is. Query and fragment are campaign noise. */
function pageOf(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

/** The canonical URL's page, or nothing when there is none or it doesn't parse. */
function canonicalPage(canonicalUrl: string | undefined): string | undefined {
  if (canonicalUrl === undefined) return undefined;
  try {
    return pageOf(new URL(canonicalUrl));
  } catch {
    return undefined;
  }
}

/** Whether an anchor's URL is Substack's own chrome. */
function isSubstackChrome(url: URL): boolean {
  return (
    url.hostname.toLowerCase().replace(/^www\./, '') === SUBSTACK_HOST &&
    SUBSTACK_CHROME.test(url.pathname)
  );
}

/**
 * Number the candidate anchors of a post's HTML.
 *
 * Returns the HTML with ` [n]` inside each kept anchor, just before its `</a>` — so `htmlToText`
 * reads `anchor text [n]` and changes nothing else — and the numbered list, in document order. A
 * URL that appears twice keeps the number it got first. `canonicalUrl` is the post's own address,
 * compared on origin and path, so its "read in app" and title links are never offered as further
 * reading of itself.
 */
export function numberLinks(
  html: string,
  canonicalUrl?: string,
): { markedHtml: string; links: NumberedLink[] } {
  const own = canonicalPage(canonicalUrl);
  const numbers = new Map<string, number>();
  const links: NumberedLink[] = [];

  const markedHtml = html.replaceAll(ANCHOR, (match: string, ...groups: (string | undefined)[]) => {
    const anchor = anchorOf([match, ...groups.slice(0, 4)]);
    if (anchor === undefined || anchor.text === '') return match;
    if (isSubstackChrome(anchor.url) || pageOf(anchor.url) === own) return match;

    const url = anchor.url.toString();
    let n = numbers.get(url);
    if (n === undefined) {
      if (links.length >= READER_MAX_LINK_CANDIDATES) return match;
      n = links.length + 1;
      numbers.set(url, n);
      links.push({ n, url });
    }
    // `</a>` closes every ANCHOR match; the marker goes just inside it.
    return `${match.slice(0, -4)} [${String(n)}]${match.slice(-4)}`;
  });

  return { markedHtml, links };
}
