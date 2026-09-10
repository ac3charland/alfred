/**
 * Hand-built `attributedBody` blobs for the decoder's tests.
 *
 * Messages stores a rich-text body as a `typedstream` archive of an `NSAttributedString`. The
 * bytes that matter are always the same shape: a class name, the type-encoding byte for a C
 * string, a length prefix, and then the UTF-8 text. These builders reproduce that shape byte for
 * byte so the decoder can be tested without a chat.db.
 */

/** The type-encoding byte typedstream writes before the C string that carries the text: '+'. */
const C_STRING_TYPE = 0x2b;

/** What sits between the class name and the type byte in every archive Messages writes. */
const AFTER_CLASS_NAME = [0x01, 0x94, 0x84, 0x01];

/** A plausible archive header. The decoder skips everything before the class name. */
const HEADER = [0x04, 0x0b, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d, 0x74, 0x79, 0x70, 0x65, 0x64];

export type LengthEncoding = 'byte' | 'uint16' | 'uint32';

export interface AttributedBodyOptions {
  /** Which of typedstream's three length prefixes to write. Defaults to the smallest that fits. */
  lengthEncoding?: LengthEncoding;
  /** `NSMutableString` archives carry a second class name before the text; exercise that path. */
  mutable?: boolean;
  /** Write this length instead of the real one, to build a truncated (undecodable) blob. */
  overrideLength?: number;
  /** Replace the UTF-8 text with raw bytes, to build a blob that cannot be decoded as UTF-8. */
  rawBytes?: number[];
}

function ascii(value: string): number[] {
  return [...new TextEncoder().encode(value)];
}

function lengthPrefix(length: number, encoding: LengthEncoding): number[] {
  if (encoding === 'byte') return [length];
  if (encoding === 'uint16') return [0x81, length & 0xff, (length >> 8) & 0xff];
  return [0x82, length & 0xff, (length >> 8) & 0xff, (length >> 16) & 0xff, (length >> 24) & 0xff];
}

export function attributedBodyFor(text: string, options: AttributedBodyOptions = {}): Uint8Array {
  const body = options.rawBytes ?? [...new TextEncoder().encode(text)];
  const encoding = options.lengthEncoding ?? (body.length < 0x81 ? 'byte' : 'uint16');
  const classNames =
    options.mutable === true
      ? [...ascii('NSMutableString'), 0x01, 0x95, 0x84, 0x84, 0x08, ...ascii('NSString')]
      : ascii('NSString');

  return new Uint8Array([
    ...HEADER,
    0x84,
    0x84,
    0x84,
    ...classNames,
    ...AFTER_CLASS_NAME,
    C_STRING_TYPE,
    ...lengthPrefix(options.overrideLength ?? body.length, encoding),
    ...body,
    0x86,
  ]);
}
