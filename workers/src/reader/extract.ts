/**
 * Turning one Gmail message into the row the reading list shows and the summariser reads.
 *
 * Pure, like `comms/email-text.ts`, and for the same reason: nothing here fetches, nothing here
 * throws, and every failure to read something comes back as a value — an absent URL, an empty
 * body. A post alfred cannot read is still stored (the tick marks it `failed` without a model
 * call), because a skipped message leaves no trace anywhere and cannot be found again even by
 * someone looking for it.
 *
 * Three fields are worth explaining:
 *
 * The TITLE is the `Subject` header, not the HTML's `<h1>`. Substack puts the post title in the
 * subject line; the `<h1>` markup changes between templates and a wrong pick puts a nav label on
 * the row where the title should be.
 *
 * The CANONICAL URL is the first `/p/<slug>` path on ANY host, with an optional `/pub/<name>`
 * in front of it. A custom-domain publication mails from `news@example.com` and links to
 * `example.substack.com/p/…` or `www.example.com/p/…`, and the live template links to
 * `open.substack.com/pub/<name>/p/<slug>` — so the path is the Substack-specific signal and the
 * host is not. The scheme filter in front of it is a SECURITY rule rather than tidiness: this
 * value is rendered as an `href` the owner clicks, so a `javascript:` bookmarklet or a `mailto:`
 * share link sitting ahead of the real post link must be refused, not merely deprioritised.
 *
 * `html_extracted` records WHICH body produced the text, and is the opposite preference from
 * `extractText`'s. The classifier wants the sender's own plain text; the summariser wants the
 * post. The plain part is NOT a stub — Substack ships a complete text alternative, and a cleaner
 * one than the markup — but it is the markup that carries the structure and the links this file
 * reads, and taking the body from the same place as the URL keeps the two describing one artefact.
 * So HTML wins here and the plain part is the fallback, and the flag says which one it was so a
 * disappointing summary can be traced to the body it was made from.
 */
import {
  decodeEncodedWords,
  decodePart,
  flatten,
  headerValue,
  htmlToText,
  isAttachment,
  parseAddress,
  truncateAtCodePointBoundary,
} from '../comms/email-text';
import type { GmailMessage, GmailPayload } from '../comms/gmail-api';

/**
 * The ceiling on what is STORED. Ten times the comms body cap, because a post is the artefact
 * here rather than context for a one-line verdict — and still bounded, because the column is read
 * back by the summariser and kept until a retention sweep drops it.
 *
 * The model's own input cap is a different, smaller number applied by the summariser
 * (`READER_MODEL_INPUT_CHARS`): the cost is the input, and what is worth keeping is not the
 * same as what is worth paying to read.
 */
export const READER_TEXT_CHARS = 400_000;

/** The title of a post whose subject was empty and whose HTML carried no `<title>` either. */
export const UNTITLED = '(untitled)';

/** What the tick stores and hands the summariser. Exactly the extractable columns of `reader_posts`. */
export interface ExtractedPost {
  title: string;
  author?: string | undefined;
  canonical_url?: string | undefined;
  received_at: string;
  rfc822_message_id?: string | undefined;
  /** Already truncated at `READER_TEXT_CHARS`; empty when nothing readable was found. */
  text: string;
  /** Whitespace-separated tokens of the STORED text, so it never describes text nobody has. */
  word_count: number;
  /** True only when the text came out of an HTML part through `htmlToText`. */
  html_extracted: boolean;
}

/** `<a … href="…" …>text</a>`, href quoted either way or bare, text non-greedy across newlines. */
const ANCHOR = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))[^>]*>([\S\s]*?)<\/a>/gi;

/** `<title>…</title>`, the fallback source for a post whose subject line was empty. */
const HTML_TITLE = /<title[^>]*>([\S\s]*?)<\/title>/i;

/**
 * A Substack post path: `/p/<slug>` with an optional `/pub/<name>` in front, whatever follows it.
 * Query and fragment are not in a path.
 *
 * The `/pub/<name>` prefix is what `open.substack.com` uses, and the live template links the post
 * only that way — a publication-hosted `<pub>.substack.com/p/<slug>` anchor appears in no post
 * mail at all any more, though a reaction notification still carries one (to somebody ELSE's post).
 */
const POST_PATH = /^(?:\/pub\/[^/?#]+)?\/p\/[^/?#]+/;

/**
 * The anchor text a template uses for the link to the post's own web version.
 *
 * This is the fallback for mail that carries NO slug link at all, and nothing more. The live
 * template's `READ IN APP` sits on the `/pub/…/p/…` link, which the path rule takes first and
 * without needing to read any anchor text; the wordings kept here are the ones older and
 * hand-rolled templates use, where the anchor text is the only route from the row to the post.
 * Each addition is a strict widening — every string the previous pattern matched still matches.
 */
const VIEW_IN_BROWSER =
  /view (this )?(post )?(in|on) (your )?browser|read online|view online|read in app/i;

/** The entities worth decoding by name inside an `href`. Everything else arrives numerically. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** The highest code point `String.fromCodePoint` will accept. */
const MAX_CODE_POINT = 0x10_ff_ff;

/** The one instant an extraction can fall back to when the message carries no date at all. */
const EPOCH = new Date(0).toISOString();

/**
 * The named and numeric entities an `href` can carry.
 *
 * A local copy rather than an import: `comms/email-text.ts` keeps its own `decodeEntities`
 * module-private, and the comms module exports exactly four functions from that file for this one — widening
 * that export list to save six lines here would be an edit to another module's surface made for
 * this one's convenience.
 */
function decodeEntities(text: string): string {
  return text.replaceAll(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const named = NAMED_ENTITIES[entity.toLowerCase()];
    if (named !== undefined) return named;
    if (!entity.startsWith('#')) return match;

    const hex = entity.toLowerCase().startsWith('#x');
    const code = Number.parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10);
    if (Number.isNaN(code) || code < 0 || code > MAX_CODE_POINT) return match;
    return String.fromCodePoint(code);
  });
}

/** Runs of whitespace to one space, ends trimmed. What a title and an anchor's text go through. */
function collapse(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

/** The first non-attachment leaf of this type whose body decodes, exactly as `extractText` picks. */
function firstDecodable(leaves: GmailPayload[], mimeType: string): string | undefined {
  for (const leaf of leaves) {
    // An attached `.html` is a file the sender chose to attach, not the post they wrote.
    if (isAttachment(leaf)) continue;
    // RFC 2045 makes text/plain the default when no Content-Type was declared.
    if (!(leaf.mimeType ?? 'text/plain').toLowerCase().startsWith(mimeType)) continue;
    const decoded = decodePart(leaf);
    if (decoded !== undefined) return decoded;
  }
  return undefined;
}

/** One anchor: its href as a parsed `http(s)` URL, and its visible text. */
interface Anchor {
  url: URL;
  text: string;
}

/**
 * Every anchor whose href is a URL the owner can safely be sent to, in document order.
 *
 * `new URL` both parses and rejects: a relative path, a malformed href and a `javascript:` or
 * `mailto:` scheme all drop out here rather than downstream, so nothing past this function has to
 * remember that the value ends up in an `href`.
 */
function anchors(html: string): Anchor[] {
  const found: Anchor[] = [];
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

    found.push({
      url,
      text: collapse(decodeEntities((match[4] ?? '').replaceAll(/<[^>]*>/g, ' '))),
    });
  }
  return found;
}

/** The post's own address: the first `/p/` path, else the "view in browser" line. */
function canonicalUrl(html: string | undefined): string | undefined {
  if (html === undefined) return undefined;
  const found = anchors(html);

  // Query and fragment are stripped from the post link on purpose: what Substack appends there is
  // the campaign that delivered this copy of the email, and it has no business in a stored URL
  // the owner may open months later.
  //
  // First in DOCUMENT ORDER wins, full stop — including when a publication-hosted `/p/<slug>` and
  // an `open.substack.com/pub/…/p/…` both appear. They address the same post, so a preference
  // between the two hosts would buy nothing and leave a second rule to keep true of a template
  // that changes without telling us. A `substack.com/redirect/…` wrapper is never unwrapped: the
  // post's URL is in its base64 payload, but the wrapper is an EXPIRING tracker, so the link the
  // owner opens months from now has to be one that still resolves.
  const post = found.find((anchor) => POST_PATH.test(anchor.url.pathname));
  if (post !== undefined) return `${post.url.origin}${post.url.pathname}`;

  // The fallback link keeps its query: on the roundup template it is an opaque per-post token,
  // and stripping it leaves a URL that does not resolve to anything.
  const browser = found.find((anchor) => VIEW_IN_BROWSER.test(anchor.text));
  return browser?.url.toString();
}

/** The `<title>` of the HTML body, used only when the `Subject` header was empty. */
function htmlTitle(html: string | undefined): string {
  if (html === undefined) return '';
  const match = HTML_TITLE.exec(html);
  return collapse(decodeEntities((match?.[1] ?? '').replaceAll(/<[^>]*>/g, ' ')));
}

/**
 * The person on the byline.
 *
 * Substack writes a `From` display name three ways: the publication's name, the author's name, and
 * `<Author> from <Publication>`. The third is the one worth undoing — the row already shows the
 * publication, so leaving the suffix on prints it twice and pushes the name that matters left.
 * The match is against the ROSTER's name for the publication, so an author whose own name happens
 * to end in "from something" keeps it.
 */
function authorName(displayName: string | undefined, publication: string): string {
  if (displayName === undefined) return publication;

  const suffix = ` from ${publication}`;
  if (!displayName.toLowerCase().endsWith(suffix.toLowerCase())) return displayName;

  const person = displayName.slice(0, -suffix.length).trim();
  // A display name that is ONLY the suffix leaves no person behind it; keep what was written.
  return person === '' ? displayName : person;
}

/** `internalDate` is milliseconds since the epoch AS A STRING — the time the message ARRIVED. */
function receivedAt(message: GmailMessage, fallback?: { receivedAt: string }): string {
  const raw = message.internalDate;
  const millis = raw === undefined ? Number.NaN : Number(raw);
  if (Number.isFinite(millis)) return new Date(millis).toISOString();
  // The tick always passes the comms row's own `received_at`, so the epoch is reachable only from
  // the eval script replaying a fixture that carries no date at all — where an obviously-wrong
  // 1970 in the printout is a better answer than a value invented from the clock.
  return fallback?.receivedAt ?? EPOCH;
}

/**
 * Read one message into a post.
 *
 * `publication` supplies the name the author falls back to, so a newsletter that mails from a
 * bare address still shows something a human recognises. `fallback` is the comms row the tick
 * already holds — used only for the date, which Gmail may omit.
 */
export function extractPost(
  message: GmailMessage,
  publication: { name: string },
  fallback?: { receivedAt: string },
): ExtractedPost {
  const payload = message.payload;
  const leaves = payload === undefined ? [] : flatten(payload);
  const html = firstDecodable(leaves, 'text/html');
  const plain = firstDecodable(leaves, 'text/plain');

  // HTML wins, but only when it actually yielded prose: a template that shipped an empty
  // `text/html` part beside a real `text/plain` one would otherwise produce an empty post
  // flagged as HTML-extracted — a body-less row whose flag says the body was read fine.
  const fromHtml = html === undefined ? '' : htmlToText(html);
  const htmlExtracted = fromHtml !== '';
  const text = truncateAtCodePointBoundary(
    htmlExtracted ? fromHtml : (plain ?? ''),
    READER_TEXT_CHARS,
  );

  const headers = payload?.headers;
  // Every non-ASCII subject arrives RFC 2047 encoded, and a long one as two adjacent encoded
  // words split mid-word — the row's title is read by a person, so it is decoded before it is one.
  const subject = collapse(decodeEncodedWords(headerValue(headers, 'Subject') ?? ''));
  const from = parseAddress(headerValue(headers, 'From'));
  const fallbackTitle = htmlTitle(html);

  return {
    title: subject === '' ? (fallbackTitle === '' ? UNTITLED : fallbackTitle) : subject,
    author: authorName(from?.name, publication.name),
    canonical_url: canonicalUrl(html),
    received_at: receivedAt(message, fallback),
    // Brackets kept, as comms stores them: `<abc@mail.example>` is the id, brackets included.
    rfc822_message_id: headerValue(headers, 'Message-ID'),
    text,
    // Counted on the STORED text rather than the full body, so the read-minutes estimate the UI
    // derives from it never describes words the summariser was not given either.
    word_count: text.split(/\s+/).filter((token) => token !== '').length,
    html_extracted: htmlExtracted,
  };
}
