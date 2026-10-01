/**
 * The links a post makes, numbered for the summariser — the input half of Further reading.
 *
 * The stored text carries no URLs (`htmlToText` drops every href), so the model could otherwise
 * never point at a source. This pure pass numbers the post's candidate anchors in document order
 * and writes ` [n]` after each one's text in the HTML, so that the text built from it shows every
 * number exactly where the post makes the link. The model is shown those markers plus a numbered
 * list of URLs, judges each link by what the surrounding prose does with it, and answers with
 * numbers only — which is what lets `normalizeReaderSummary` store nothing but URLs the post
 * really contains.
 *
 * The filter here is MECHANICAL and deliberately minimal: it removes only what can never be worth
 * reading in full — non-`http(s)` hrefs, anchors with no visible text, the post's own address, and
 * Substack's own chrome (bylines, app links, `redirect/2/` wrappers). Every judgment past that,
 * sponsors included, is the model's. Body links in Substack mail are opaque
 * `substack.com/redirect/<uuid>` wrappers; they are kept as they are, never resolved here, because
 * resolving costs a subrequest per link and Instapaper follows the redirect itself when a link is
 * saved.
 */
import { ANCHOR, type Anchor, readAnchor } from './extract';

/**
 * The most links one post is numbered for. A roundup runs to a few dozen; past this the list
 * costs input tokens for links no summary would pick.
 */
export const READER_MAX_LINK_CANDIDATES = 150;

/** One candidate link: its number in the model's input, and the href as the post wrote it. */
export interface NumberedLink {
  n: number;
  url: string;
}

/** Substack's own hosts, whose byline, app and chrome-wrapper paths are never a source. */
const SUBSTACK_HOSTS = new Set(['substack.com', 'www.substack.com']);

/** Bylines (`/@author`), app links, and the `redirect/2/<base64>` wrappers on subscribe and share. */
const SUBSTACK_CHROME = /^\/(?:@|app-link\/|redirect\/2\/)/;

/** A URL with its query and fragment dropped — how the post's own address is compared. */
function originAndPath(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

/** The canonical URL's origin and path, or undefined when there is none or it does not parse. */
function ownAddress(canonicalUrl: string | undefined): string | undefined {
  if (canonicalUrl === undefined) return undefined;
  try {
    return originAndPath(new URL(canonicalUrl));
  } catch {
    return undefined;
  }
}

/** Whether an anchor can ever be further reading — the whole of the mechanical filter. */
function isCandidate(anchor: Anchor, own: string | undefined): boolean {
  if (anchor.text === '') return false;
  if (own !== undefined && originAndPath(anchor.url) === own) return false;
  return !(SUBSTACK_HOSTS.has(anchor.url.hostname) && SUBSTACK_CHROME.test(anchor.url.pathname));
}

/**
 * Number a post's candidate links and mark each in its HTML.
 *
 * Repeats of one URL share the number it first had, and every occurrence is marked. Past
 * {@link READER_MAX_LINK_CANDIDATES} distinct URLs, later anchors are left unmarked. The URL kept
 * is the parsed href's serialisation, so an `&amp;` in the markup is a `&` here.
 */
export function numberLinks(
  html: string,
  canonicalUrl?: string,
): { markedHtml: string; links: NumberedLink[] } {
  const own = ownAddress(canonicalUrl);
  const numbers = new Map<string, number>();
  const links: NumberedLink[] = [];
  const parts: string[] = [];
  let from = 0;

  for (const match of html.matchAll(ANCHOR)) {
    const anchor = readAnchor(match);
    if (anchor === undefined || !isCandidate(anchor, own)) continue;

    const url = anchor.url.toString();
    let n = numbers.get(url);
    if (n === undefined) {
      if (links.length >= READER_MAX_LINK_CANDIDATES) continue;
      n = links.length + 1;
      numbers.set(url, n);
      links.push({ n, url });
    }

    const end = match.index + match[0].length;
    parts.push(html.slice(from, end), ` [${String(n)}]`);
    from = end;
  }

  parts.push(html.slice(from));
  return { markedHtml: parts.join(''), links };
}
