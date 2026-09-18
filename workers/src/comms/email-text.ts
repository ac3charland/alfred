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
 *
 * Headers are RFC 2047 decoded on the way OUT of a header, not inside `headerValue`. A header's
 * raw value is what a signature covers and what a comparison against another header has to use,
 * so the decode belongs to the callers that show a header to a person — a subject line, a display
 * name — and `decodeEncodedWords` is what they call.
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

/**
 * `=?charset?encoding?text?=` — one RFC 2047 encoded word. The encoded text may not contain `?`
 * (RFC 2047 §2), which is what makes the non-greedy-free `[^?]*` safe here.
 */
const ENCODED_WORD = /=\?([^\s?]+)\?([^\s?]+)\?([^?]*)\?=/g;

/**
 * The charsets a header is decoded from, mapped to the label `TextDecoder` is built with.
 *
 * Keyed on the charset with its punctuation removed, so `UTF-8`, `utf8` and `UTF_8` are one entry.
 * Deliberately a short list rather than "whatever `TextDecoder` accepts": the Workers runtime's
 * decoder does not carry the whole encoding registry, so a permissive version would decode a
 * charset locally and throw in production. Anything else leaves the word exactly as it arrived,
 * which is readable-ish and honest, where a mis-decode is neither.
 */
const HEADER_CHARSETS: Record<string, string> = {
  utf8: 'utf8',
  usascii: 'utf8',
  iso88591: 'iso-8859-1',
  latin1: 'iso-8859-1',
};

/**
 * Characters that occupy a position and show nothing: the padding run Substack's second preheader
 * is built from (U+034F, U+00AD) plus the zero-width family. They survive entity decoding, so a
 * token made only of them is counted as a word by anything splitting on whitespace — 201 of them
 * ahead of the first real sentence of every post.
 *
 * U+00A0 and U+2007 are deliberately absent: both are whitespace to JavaScript's `\s`, so
 * `collapse` folds them into the surrounding space on its own. An alternation rather than one
 * character class because U+034F is a combining mark, which a class may not carry.
 */
const INVISIBLE = /\u034F|\u00AD|[\u200B-\u200D]|\u2060|\uFEFF/g;

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

/**
 * A header value with its RFC 2047 encoded words decoded — `=?UTF-8?q?Let=E2=80=99s_go?=` into
 * `Let\u2019s go`.
 *
 * Every non-ASCII subject and display name Substack sends arrives this way, and a long one arrives
 * as two ADJACENT encoded words split mid-word. RFC 2047 §6.2 makes the whitespace between two
 * encoded words folding rather than content, so it is dropped — keep it and `Inter` + `pretability`
 * come back as two words. Whitespace next to ordinary text is content and stays.
 *
 * A word this cannot read — an unknown charset, an encoding letter that is neither Q nor B, a
 * truncated hex escape — is left exactly as it arrived. A reader shown `=?Shift_JIS?B?…?=` can
 * still tell what happened; a reader shown a plausible mis-decode cannot.
 */
export function decodeEncodedWords(value: string): string {
  let decoded = '';
  let cursor = 0;
  let afterWord = false;

  for (const match of value.matchAll(ENCODED_WORD)) {
    const word = decodeWord(match[1] ?? '', match[2] ?? '', match[3] ?? '');
    if (word === undefined) continue;

    const between = value.slice(cursor, match.index);
    // Whitespace, and only whitespace, BETWEEN two encoded words is the fold. Anything else —
    // including the text of a word that could not be decoded — is the sender's own.
    if (!(afterWord && between !== '' && between.trim() === '')) decoded += between;

    decoded += word;
    cursor = match.index + match[0].length;
    afterWord = true;
  }
  return decoded + value.slice(cursor);
}

/** One encoded word's text, or undefined when nothing here could be trusted to decode it. */
function decodeWord(charset: string, encoding: string, text: string): string | undefined {
  // `=?utf-8*en?q?…?=` — RFC 2231 hangs a language tag off the charset, which changes nothing here.
  const bare = (charset.split('*', 1)[0] ?? '').toLowerCase().replaceAll(/\W|_/g, '');
  const label = HEADER_CHARSETS[bare];
  if (label === undefined) return undefined;

  const letter = encoding.toLowerCase();
  if (letter !== 'q' && letter !== 'b') return undefined;
  const bytes = letter === 'q' ? quotedPrintableBytes(text) : base64Bytes(text);
  if (bytes === undefined) return undefined;

  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * The bytes behind a Q-encoded word. `_` is a space (RFC 2047 §4.2), `=XX` is one hex byte.
 *
 * A `=` that is not followed by two hex digits, and any character above U+00FF, mean this is not
 * the Q encoding it claims to be — undefined rather than a guess.
 */
function quotedPrintableBytes(text: string): Uint8Array | undefined {
  const bytes: number[] = [];
  for (const token of text.matchAll(/=([\da-f]{2})|([\S\s])/gi)) {
    const hex = token[1];
    if (hex !== undefined) {
      bytes.push(Number.parseInt(hex, 16));
      continue;
    }
    const char = token[2] ?? '';
    if (char === '=') return undefined;
    const code = char === '_' ? 0x20 : (char.codePointAt(0) ?? 0);
    if (code > 0xff) return undefined;
    bytes.push(code);
  }
  return Uint8Array.from(bytes);
}

/** The bytes behind a base64 run, padded back to a multiple of four. Undefined when it is not base64. */
function base64Bytes(text: string): Uint8Array | undefined {
  const compact = text.replaceAll(/\s/g, '');
  const padded = compact + '='.repeat((4 - (compact.length % 4)) % 4);

  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return undefined;
  }
  // `atob` yields one latin-1 character per byte; what those bytes mean is the charset's business.
  return Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
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

/**
 * The display name of an address, unquoted and RFC 2047 decoded, or undefined when there wasn't
 * one. Substack encodes a byline the same way it encodes a subject, so a name with an apostrophe
 * or an accent in it reaches the mirror as `=?UTF-8?q?…?=` unless it is decoded here.
 */
function displayName(raw: string): string | undefined {
  const trimmed = decodeEncodedWords(raw.trim())
    .replace(/^"(.*)"$/s, '$1')
    .trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Every leaf of the MIME tree, in order. A `multipart/*` node contributes only its parts. */
export function flatten(payload: GmailPayload): GmailPayload[] {
  const parts = payload.parts ?? [];
  if (parts.length === 0) return [payload];
  return parts.flatMap((part) => flatten(part));
}

/** A part the owner would call an attachment: it has a filename, so it is a file and not prose. */
export function isAttachment(part: GmailPayload): boolean {
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
export function decodePart(part: GmailPayload): string | undefined {
  const data = part.body?.data;
  // A genuinely empty body arrives as a size with no data — empty is not the same as unreadable.
  if (data === undefined) return part.body?.size === 0 ? '' : undefined;
  return decodeBase64Url(data);
}

/** Gmail encodes every part body as base64url, unpadded. The bytes themselves are UTF-8. */
function decodeBase64Url(data: string): string | undefined {
  const bytes = base64Bytes(data.replaceAll('-', '+').replaceAll('_', '/'));
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
}

/**
 * Markup reduced to the words in it. Crude on purpose — the classifier reads prose, not layout.
 *
 * `display:none` elements go the same way `<script>` and `<style>` do, content and all: what the
 * sender hid is not what the reader read. Substack's own preheaders are the case that matters —
 * a preview line repeating the subject, then ~400 characters of invisible padding that reaches a
 * word count as some 200 empty words. The known limit is the same as the script/style strip's:
 * a `<div style="display:none">` holding another `<div>` ends at the INNER closing tag, so the
 * outer element's tail survives. Real mail nests a table in the preheader, never another div.
 */
export function htmlToText(html: string): string {
  const visible = html
    .replaceAll(/<(script|style)[^>]*>[\S\s]*?<\/\1>/gi, ' ')
    .replaceAll(/<(\w+)[^>]*style\s*=\s*"[^"]*display\s*:\s*none[^"]*"[^>]*>[\S\s]*?<\/\1>/gi, ' ');
  const broken = visible
    .replaceAll(/<br[^>]*>/gi, '\n')
    .replaceAll(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n');
  // The invisible strip runs AFTER the entities are decoded: the padding is written `&#173;`, so
  // there is nothing to strip until it is a character.
  return collapse(decodeEntities(broken.replaceAll(/<[^>]*>/g, ' ')).replaceAll(INVISIBLE, ''));
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
