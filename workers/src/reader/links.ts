/**
 * Numbering a post's links, so the model can point at one by number instead of typing a URL.
 *
 * The summariser's Further reading section names links, and a model asked to copy a URL out of a
 * long post will eventually mangle or invent one. So the post's HTML is walked once here: every
 * anchor worth offering gets a number in document order, a ` [n]` marker is written into the
 * anchor text so the stripped prose reads "the study [3]", and the numbered list travels beside
 * the text. The model answers with numbers; `schema.ts` maps them back to URLs and drops any it
 * was never given, so a URL that was not in the mail cannot reach storage.
 *
 * Pure and total: no fetch, no throw. A post whose HTML has no usable anchor simply yields none.
 * Substack's own redirect wrappers on BODY links are kept and never unwrapped — they are the real
 * body links in Substack mail, and opening one is the owner's own redirect to the real page.
 */
import { ANCHOR, collapse, decodeEntities } from './extract';

/**
 * The most distinct links one post offers the model. A link-heavy roundup carries a few dozen; the
 * cap is only the guard against a mail that is nothing but anchors inflating the prompt, and it
 * is applied in document order so what is dropped is the tail, never the lede.
 */
export const READER_MAX_LINK_CANDIDATES = 150;

/** One numbered link: its 1-based number in document order, and its exact URL. */
export interface NumberedLink {
  n: number;
  url: string;
}

/** The paths on `substack.com` that are chrome, not the post's own links: bylines, app links, wrappers. */
const SUBSTACK_CHROME_PATHS = ['/@', '/app-link/', '/redirect/2/'];

/** Whether this is one of the platform's own chrome links rather than something the author linked. */
function isSubstackChrome(url: URL): boolean {
  return (
    url.hostname.toLowerCase() === 'substack.com' &&
    SUBSTACK_CHROME_PATHS.some((prefix) => url.pathname.startsWith(prefix))
  );
}

/** `origin + pathname` of a URL string, the key a link is compared to the post's own address by. */
function identity(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return undefined;
  }
}

/**
 * Number the anchors worth offering and mark them in the HTML.
 *
 * An anchor is kept when its href is an `http(s)` URL, it has visible text (an image-only anchor
 * has none, and says nothing a model could name the link by), it is not the post's own address
 * (compared on origin and path, so a campaign query does not hide it) and it is not Substack
 * chrome. One exact URL repeated shares the number of its first appearance. A non-kept anchor is
 * left byte for byte as it was.
 */
export function numberLinks(
  html: string,
  canonicalUrl?: string,
): { markedHtml: string; links: NumberedLink[] } {
  const own = identity(canonicalUrl);
  const links: NumberedLink[] = [];
  const numbers = new Map<string, number>();

  let markedHtml = '';
  let cursor = 0;
  for (const match of html.matchAll(ANCHOR)) {
    const href = decodeEntities(match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (href === '') continue;

    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    if (collapse(decodeEntities((match[4] ?? '').replaceAll(/<[^>]*>/g, ' '))) === '') continue;
    if (own !== undefined && url.origin + url.pathname === own) continue;
    if (isSubstackChrome(url)) continue;

    let n = numbers.get(href);
    if (n === undefined) {
      // Past the cap an anchor gets no number — but a repeat of a numbered URL still does.
      if (links.length >= READER_MAX_LINK_CANDIDATES) continue;
      n = links.length + 1;
      numbers.set(href, n);
      links.push({ n, url: href });
    }

    // The marker goes just inside the closing tag, so it reads as part of the anchor's text.
    const closeAt = match.index + match[0].length - '</a>'.length;
    markedHtml += `${html.slice(cursor, closeAt)} [${String(n)}]`;
    cursor = closeAt;
  }
  return { markedHtml: markedHtml + html.slice(cursor), links };
}
