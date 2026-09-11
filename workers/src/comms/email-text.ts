/**
 * Turning one Gmail message resource into the fields a `NormalizedMessage` needs: a body, a
 * sender, the people on the thread, and the RFC822 ids the reply drain compares against.
 *
 * Every function here is pure. Nothing fetches, nothing throws, and every failure to read
 * something comes back as a value — an `undefined` header, an `extracted: false` body. That is
 * deliberate rather than tidy: a message alfred cannot decode is stored and flagged, never
 * skipped, because a skipped message leaves no trace anywhere and so cannot be found again even
 * by someone looking. An empty body with the flag set costs a row and keeps the failure visible.
 *
 * Two conventions the callers depend on:
 *
 * Handles come back LOWER-CASED, names do not. An address is not case-sensitive and no two mail
 * clients capitalise one the same way, so the roster lookup, the owner-handle comparison and the
 * participants list would all be subtly unreliable otherwise. A display name is a person's name
 * and is left exactly as it was written.
 *
 * Message ids keep their angle brackets. `<abc@mail.example>` is the id, brackets included, in
 * the `Message-ID`, `In-Reply-To` and `References` headers alike — and the drain matches a reply's
 * references against the stored ids verbatim, so stripping them on one side and not the other
 * would quietly break every reply detection.
 */
import type { GmailHeader, GmailPayload } from './gmail-api';

/**
 * How much of a body is kept. Long enough that no real message is cut off mid-thought, short
 * enough that a runaway digest cannot dominate a classification prompt or a row's storage.
 */
export const MAX_BODY_CHARS = 20_000;

/** A `From`/`To`/`Cc` entry, split into the part that identifies and the part that reads. */
export interface EmailAddress {
  /** Lower-cased, brackets stripped: `dana@example.com`. */
  handle: string;
  /** The display name as written, or undefined when the header carried a bare address. */
  name?: string | undefined;
}

/** What a message's MIME tree yielded. `extracted: false` is the can't-decode flag. */
export interface ExtractedBody {
  body: string;
  extracted: boolean;
  hasAttachments: boolean;
}

/** The entities worth decoding by name. Everything else arrives numerically or not at all. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** `Name <addr>`, greedy on the name so a bracketed address inside a name still ends up last. */
const ANGLE_ADDRESS = /^(.*)<([^<>]*)>[^<>]*$/s;

/** The highest code point `String.fromCodePoint` will accept. */
const MAX_CODE_POINT = 0x10_ff_ff;

/**
 * The highest code point in the Basic Multilingual Plane. Anything above it came from a UTF-16
 * surrogate pair — two code units together encoding one astral character (any emoji, many
 * CJK-extension and other beyond-the-BMP characters). Used by `truncateAtCodePointBoundary`.
 */
const MAX_BMP_CODE_POINT = 0xff_ff;

/** A header's value, matched case-insensitively. A present-but-empty header reads as absent. */
export function headerValue(headers: GmailHeader[] | undefined, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const header of headers ?? []) {
    if (header.name.toLowerCase() !== wanted) continue;
    const value = header.value.trim();
    if (value !== '') return value;
  }
  return undefined;
}

/** One address from a header value. Undefined when there was no address in it to find. */
export function parseAddress(raw?: string): EmailAddress | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  const angled = ANGLE_ADDRESS.exec(trimmed) ?? undefined;
  const handle = (angled?.[2] ?? trimmed).trim().toLowerCase();
  if (handle === '') return undefined;

  return { handle, name: displayName(angled?.[1] ?? '') };
}

/**
 * Every address in a `To`/`Cc` header.
 *
 * The split is hand-rolled rather than `raw.split(',')` because a display name is allowed to
 * contain a comma — `"Whitfield, Dana" <dana@example.com>` is one recipient, and splitting on the
 * comma turns it into two, one of which is a fragment of a name masquerading as an address.
 */
export function parseAddressList(raw?: string): EmailAddress[] {
  if (raw === undefined) return [];

  const entries: string[] = [];
  let current = '';
  let quoted = false;
  let bracketed = false;

  for (const char of raw) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === '<') bracketed = true;
    else if (!quoted && char === '>') bracketed = false;
    else if (char === ',' && !quoted && !bracketed) {
      entries.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  entries.push(current);

  const addresses: EmailAddress[] = [];
  for (const entry of entries) {
    const parsed = parseAddress(entry);
    if (parsed !== undefined) addresses.push(parsed);
  }
  return addresses;
}

/**
 * The message ids in an `In-Reply-To` or `References` header, brackets kept.
 *
 * Bracketed runs are preferred because those headers may carry commentary alongside the ids
 * (`<a@x> (Dana's message)`); when a sender wrote bare ids with no brackets at all, the tokens are
 * returned exactly as written rather than invented into a shape they never had.
 */
export function parseMessageIdList(raw?: string): string[] {
  if (raw === undefined) return [];
  const bracketed = [...raw.matchAll(/<[^<>]*>/g)].map((match) => match[0]);
  if (bracketed.length > 0) return bracketed;
  return raw.split(/[\s,]+/).filter((token) => token !== '');
}

/**
 * The readable text of a message, preferring `text/plain` and falling back to stripped HTML.
 *
 * The order is not a style preference: the plain part is what the sender's own client generated
 * from the same content, so taking it avoids reconstructing prose out of markup whenever the
 * sender bothered to send both.
 */
export function extractText(payload?: GmailPayload): ExtractedBody {
  if (payload === undefined) return { body: '', extracted: false, hasAttachments: false };

  const leaves = flatten(payload);
  const hasAttachments = leaves.some((leaf) => isAttachment(leaf));

  const plain = firstDecodable(leaves, 'text/plain');
  if (plain !== undefined) return { body: truncate(plain), extracted: true, hasAttachments };

  const html = firstDecodable(leaves, 'text/html');
  if (html !== undefined) {
    return { body: truncate(htmlToText(html)), extracted: true, hasAttachments };
  }

  // Nothing readable came out. A message whose every part is an attachment genuinely has no text
  // and is not a failure; anything else means a part we could not read, which is the flag's whole
  // purpose — the row still gets written, marked, and takes the can't-judge path.
  const onlyAttachments = leaves.length > 0 && leaves.every((leaf) => isAttachment(leaf));
  return { body: '', extracted: onlyAttachments, hasAttachments };
}

/** The display name of an address, unquoted, or undefined when there wasn't one. */
function displayName(raw: string): string | undefined {
  const trimmed = raw
    .trim()
    .replace(/^"(.*)"$/s, '$1')
    .trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Every leaf of the MIME tree, in order. A `multipart/*` node contributes only its parts. */
function flatten(payload: GmailPayload): GmailPayload[] {
  const parts = payload.parts ?? [];
  if (parts.length === 0) return [payload];
  return parts.flatMap((part) => flatten(part));
}

/** A part the owner would call an attachment: it has a filename, so it is a file and not prose. */
function isAttachment(part: GmailPayload): boolean {
  return (part.filename ?? '') !== '';
}

/**
 * The first non-attachment part of this type whose body decodes. An attached `.txt` is skipped on
 * purpose: it is a file the sender chose to attach, not the message they wrote.
 */
function firstDecodable(leaves: GmailPayload[], mimeType: string): string | undefined {
  for (const leaf of leaves) {
    if (isAttachment(leaf)) continue;
    // RFC 2045 makes text/plain the default when no Content-Type was declared.
    if (!(leaf.mimeType ?? 'text/plain').toLowerCase().startsWith(mimeType)) continue;
    const decoded = decodePart(leaf);
    if (decoded !== undefined) return decoded;
  }
  return undefined;
}

/** One part's text, or undefined when there was nothing readable there. */
function decodePart(part: GmailPayload): string | undefined {
  const data = part.body?.data;
  // A genuinely empty body arrives as a size with no data — empty is not the same as unreadable.
  if (data === undefined) return part.body?.size === 0 ? '' : undefined;
  return decodeBase64Url(data);
}

/** Gmail encodes every part body as base64url, unpadded. */
function decodeBase64Url(data: string): string | undefined {
  const base64 = data.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return undefined;
  }
  // `atob` yields one latin-1 character per byte; the bytes themselves are UTF-8.
  const bytes = Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
  return new TextDecoder().decode(bytes);
}

/** Markup reduced to the words in it. Crude on purpose — the classifier reads prose, not layout. */
function htmlToText(html: string): string {
  const visible = html.replaceAll(/<(script|style)[^>]*>[\S\s]*?<\/\1>/gi, ' ');
  const broken = visible
    .replaceAll(/<br[^>]*>/gi, '\n')
    .replaceAll(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n');
  return collapse(decodeEntities(broken.replaceAll(/<[^>]*>/g, ' ')));
}

/** The named and numeric entities that survive into a stripped body. */
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

/** Runs of spaces to one space, runs of blank lines to one newline. */
function collapse(text: string): string {
  return text
    .replaceAll(/[^\S\n]+/g, ' ')
    .replaceAll(/\s*\n\s*/g, '\n')
    .trim();
}

/** Bodies are stored, prompted with and shipped to the browser — one of them has to be bounded. */
function truncate(text: string): string {
  return truncateAtCodePointBoundary(text, MAX_BODY_CHARS);
}

/**
 * Slice to at most `maxChars` UTF-16 code units without splitting a surrogate pair in half.
 *
 * A plain `text.slice(0, maxChars)` cuts by code unit with no regard for where a pair lands. When
 * the cutoff falls between a pair's two halves, the result keeps the high surrogate and drops the
 * low one — a lone high surrogate is invalid UTF-16. `JSON.stringify` lets it through unnoticed,
 * but the standard UTF-8 encoder does not: a `TextEncoder`/`TextDecoder` round trip — exactly what
 * `fetch` does to a string body — replaces the unpaired surrogate with U+FFFD, so the character
 * silently becomes a replacement glyph once it is on the wire (e.g. this Worker's PostgREST upsert).
 *
 * `Array.from(text).slice(0, maxChars).join('')` would count code points instead of code units and
 * sidestep the whole problem, but it allocates an array holding every code point in `text` first —
 * wasteful for a body this large when it happens once per message this CPU-bounded Worker ingests.
 * `codePointAt` at the boundary is O(1) instead: called on the high half of a pair it returns the
 * two code units combined (> `MAX_BMP_CODE_POINT`), which is exactly the signal that the other half
 * is about to be cut off — so back the boundary up by one and drop the whole character.
 */
export function truncateAtCodePointBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const boundary =
    (text.codePointAt(maxChars - 1) ?? 0) > MAX_BMP_CODE_POINT ? maxChars - 1 : maxChars;
  return text.slice(0, boundary);
}
