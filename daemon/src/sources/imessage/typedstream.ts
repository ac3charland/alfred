/**
 * Decodes the text out of chat.db's `attributedBody` column.
 *
 * Since the 2022-era Messages update a growing share of messages leave `message.text` empty and
 * store their body here instead — anything with rich formatting, dictation, or a link preview. A
 * poller that reads only `text` silently loses that content, which is the one failure this whole
 * module exists to prevent.
 *
 * The column holds a `typedstream` archive of an `NSAttributedString`: Apple's pre-plist binary
 * archiver, undocumented and unchanged since NeXTSTEP. Fully parsing it would mean implementing
 * typedstream's class/object graph; every project in this space instead reads the one part that
 * matters, and so do we. After the archived string's class name comes typedstream's type-encoding
 * byte for a C string — `+` — then a length prefix, then the UTF-8 bytes:
 *
 *     … 84 84 84 08 "NSString" 01 94 84 01 2B 17 "Running ten minutes late" 86 …
 *                              └ class → text ┘ └ len
 *
 * The length is one byte for anything under 129 bytes, and otherwise typedstream's own integer
 * markers: `0x81` + uint16 LE, `0x82` + uint32 LE.
 *
 * Being byte-pattern matching, this decode CAN fail — an archive shape we have not seen, a future
 * macOS change. That is why the failure is a value and not an exception: a row whose body will not
 * decode is still ingested, flagged, because a skipped message is a false negative that leaves no
 * trace anywhere for anyone to audit.
 */

/** The decoded text, or a decode that did not work — never a throw, and never a silent empty. */
export type AttributedBodyResult = { text: string } | { failed: true };

/** The class names Messages archives the body under. `NSMutableString` carries both. */
const CLASS_MARKERS = ['NSMutableString', 'NSString'];

/** typedstream's type encoding for the C string that carries the text: '+'. */
const C_STRING_TYPE = 0x2b;

/**
 * How far past the class name the type byte may sit. An `NSMutableString` archive puts a second
 * class name in between, so the window has to clear that without wandering into the text itself.
 */
const TYPE_SEARCH_WINDOW = 48;

/** The gap in the common archive (`01 94 84 01 2B`), used when the type byte is not found. */
const DEFAULT_TYPE_GAP = 5;

const LENGTH_UINT16 = 0x81;
const LENGTH_UINT32 = 0x82;

function indexOfAscii(bytes: Uint8Array, needle: string): number | undefined {
  const codes = new TextEncoder().encode(needle);
  const last = bytes.length - codes.length;
  for (let start = 0; start <= last; start += 1) {
    if (codes.every((code, offset) => bytes[start + offset] === code)) return start + codes.length;
  }
  return undefined;
}

/** The index just past the earliest string class name in the archive. */
function findClassMarker(bytes: Uint8Array): number | undefined {
  let earliest: number | undefined;
  for (const marker of CLASS_MARKERS) {
    const found = indexOfAscii(bytes, marker);
    if (found !== undefined && (earliest === undefined || found < earliest)) earliest = found;
  }
  return earliest;
}

function findLengthPrefix(bytes: Uint8Array, afterMarker: number): number {
  const limit = Math.min(bytes.length, afterMarker + TYPE_SEARCH_WINDOW);
  for (let index = afterMarker; index < limit; index += 1) {
    if (bytes[index] === C_STRING_TYPE) return index + 1;
  }
  return afterMarker + DEFAULT_TYPE_GAP;
}

interface Span {
  start: number;
  length: number;
}

function readSpan(bytes: Uint8Array, at: number): Span | undefined {
  const first = bytes[at];
  if (first === undefined) return undefined;

  if (first === LENGTH_UINT16) {
    const low = bytes[at + 1];
    const high = bytes[at + 2];
    if (low === undefined || high === undefined) return undefined;
    return { start: at + 3, length: low + (high << 8) };
  }

  if (first === LENGTH_UINT32) {
    const octets = [bytes[at + 1], bytes[at + 2], bytes[at + 3], bytes[at + 4]];
    if (octets.includes(undefined)) return undefined;
    const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = octets;
    return { start: at + 5, length: b0 + b1 * 0x1_00 + b2 * 0x1_00_00 + b3 * 0x1_00_00_00 };
  }

  // Anything above the uint32 marker is some other typedstream marker, not a length.
  if (first > LENGTH_UINT32) return undefined;
  return { start: at + 1, length: first };
}

export function decodeAttributedBody(bytes: Uint8Array): AttributedBodyResult {
  const afterMarker = findClassMarker(bytes);
  if (afterMarker === undefined) return { failed: true };

  const span = readSpan(bytes, findLengthPrefix(bytes, afterMarker));
  if (span === undefined || span.start + span.length > bytes.length) return { failed: true };

  try {
    // `fatal` matters: without it a wrong offset decodes into mojibake, which would be stored as
    // if it were the message. A body we cannot read must look like a failure, not like content.
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(span.start, span.start + span.length),
      ),
    };
  } catch {
    return { failed: true };
  }
}
