import {
  MAX_BODY_CHARS,
  extractText,
  headerValue,
  parseAddress,
  parseAddressList,
  parseMessageIdList,
  truncateAtCodePointBoundary,
} from './email-text';
import type { GmailPayload } from './gmail-api';

/** Encode text the way Gmail encodes a part body: base64url, unpadded. */
function b64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** A leaf MIME part carrying encoded text. */
function part(mimeType: string, text: string, overrides: Partial<GmailPayload> = {}): GmailPayload {
  return { mimeType, body: { data: b64url(text) }, ...overrides };
}

describe('headerValue', () => {
  it('matches case-insensitively, because header casing is a client-by-client habit', () => {
    const headers = [{ name: 'List-Id', value: '<news.example.com>' }];
    expect(headerValue(headers, 'List-ID')).toBe('<news.example.com>');
  });

  it('reads a present-but-empty header as absent', () => {
    expect(headerValue([{ name: 'Subject', value: ' '.repeat(3) }], 'Subject')).toBeUndefined();
  });

  it('reads a missing header list as absent', () => {
    expect(headerValue(undefined, 'Subject')).toBeUndefined();
  });
});

describe('parseAddress', () => {
  it('splits a display name from its address and lower-cases only the address', () => {
    expect(parseAddress('Dana Whitfield <Dana@Example.com>')).toEqual({
      handle: 'dana@example.com',
      name: 'Dana Whitfield',
    });
  });

  it('reads a bare address with no name', () => {
    expect(parseAddress('BARE@example.com')).toEqual({
      handle: 'bare@example.com',
      name: undefined,
    });
  });

  it('unquotes a quoted display name', () => {
    expect(parseAddress('"Whitfield, Dana" <dana@example.com>')).toEqual({
      handle: 'dana@example.com',
      name: 'Whitfield, Dana',
    });
  });

  it('has nothing to report for a missing or empty header', () => {
    expect(parseAddress()).toBeUndefined();
    expect(parseAddress(' '.repeat(3))).toBeUndefined();
  });
});

describe('parseAddressList', () => {
  it('splits on commas between addresses', () => {
    expect(parseAddressList('a@x.com, B@y.com')).toEqual([
      { handle: 'a@x.com', name: undefined },
      { handle: 'b@y.com', name: undefined },
    ]);
  });

  it('keeps a comma inside a quoted name from splitting one recipient into two', () => {
    expect(parseAddressList('"Whitfield, Dana" <dana@x.com>, sam@y.com')).toEqual([
      { handle: 'dana@x.com', name: 'Whitfield, Dana' },
      { handle: 'sam@y.com', name: undefined },
    ]);
  });

  it('has nothing to report for a missing header', () => {
    expect(parseAddressList()).toEqual([]);
  });
});

describe('parseMessageIdList', () => {
  it('keeps the angle brackets, because the drain compares stored ids verbatim', () => {
    expect(parseMessageIdList('<a@x> <b@x>')).toEqual(['<a@x>', '<b@x>']);
  });

  it('ignores commentary alongside the ids', () => {
    expect(parseMessageIdList("<a@x> (Dana's message)")).toEqual(['<a@x>']);
  });

  it('returns bare tokens as written when a sender used no brackets at all', () => {
    expect(parseMessageIdList('a@x, b@x')).toEqual(['a@x', 'b@x']);
  });

  it('has nothing to report for a missing header', () => {
    expect(parseMessageIdList()).toEqual([]);
  });
});

describe('extractText', () => {
  it('prefers the text/plain part when a message carries both', () => {
    const payload: GmailPayload = {
      mimeType: 'multipart/alternative',
      parts: [part('text/plain', 'the plain one'), part('text/html', '<p>the html one</p>')],
    };
    expect(extractText(payload)).toEqual({
      body: 'the plain one',
      extracted: true,
      hasAttachments: false,
    });
  });

  it('falls back to HTML, stripped to its words with entities decoded', () => {
    const payload = part(
      'text/html',
      '<style>p{color:red}</style><p>Hi&nbsp;Dana</p><div>R&amp;D  &#39;26</div>',
    );
    expect(extractText(payload)).toEqual({
      body: "Hi Dana\nR&D '26",
      extracted: true,
      hasAttachments: false,
    });
  });

  it('turns a <br> into a line break rather than gluing two lines together', () => {
    expect(extractText(part('text/html', 'one<br>two')).body).toBe('one\ntwo');
  });

  it('reports an attachment anywhere in the tree', () => {
    const payload: GmailPayload = {
      mimeType: 'multipart/mixed',
      parts: [
        part('text/plain', 'see attached'),
        { mimeType: 'application/pdf', filename: 'invoice.pdf', body: { size: 900 } },
      ],
    };
    expect(extractText(payload)).toEqual({
      body: 'see attached',
      extracted: true,
      hasAttachments: true,
    });
  });

  it('counts a message that is only an attachment as extracted — it genuinely has no text', () => {
    const payload: GmailPayload = {
      mimeType: 'multipart/mixed',
      parts: [{ mimeType: 'image/png', filename: 'shot.png', body: { size: 40 } }],
    };
    expect(extractText(payload)).toEqual({ body: '', extracted: true, hasAttachments: true });
  });

  it('never reads an attached text file as the body the sender wrote', () => {
    const payload: GmailPayload = {
      mimeType: 'multipart/mixed',
      parts: [part('text/plain', 'contents of the file', { filename: 'notes.txt' })],
    };
    expect(extractText(payload)).toEqual({ body: '', extracted: true, hasAttachments: true });
  });

  it('flags a part it could not read rather than dropping the message', () => {
    const payload: GmailPayload = {
      mimeType: 'application/octet-stream',
      body: { size: 12 },
    };
    expect(extractText(payload)).toEqual({ body: '', extracted: false, hasAttachments: false });
  });

  it('flags a message with no payload at all', () => {
    expect(extractText()).toEqual({
      body: '',
      extracted: false,
      hasAttachments: false,
    });
  });

  it('treats a genuinely empty body as read, not as a decode failure', () => {
    expect(extractText({ mimeType: 'text/plain', body: { size: 0 } })).toEqual({
      body: '',
      extracted: true,
      hasAttachments: false,
    });
  });

  it('decodes multi-byte UTF-8 through base64url', () => {
    expect(extractText(part('text/plain', 'déjà vu — ok')).body).toBe('déjà vu — ok');
  });

  it('truncates a runaway body so one digest cannot dominate a prompt', () => {
    const body = extractText(part('text/plain', 'x'.repeat(MAX_BODY_CHARS + 500))).body;
    expect(body).toHaveLength(MAX_BODY_CHARS);
  });

  it('does not split a surrogate pair sitting at the truncation boundary', () => {
    // The 20,000th character is an emoji — a two-code-unit surrogate pair straddling the naive
    // `slice(0, MAX_BODY_CHARS)` cutoff. A lone high surrogate at the tail is invalid UTF-16: a
    // `TextEncoder`/`TextDecoder` round trip (exactly what `fetch` does to a string body sent to
    // PostgREST) silently turns it into U+FFFD.
    const longBody = 'x'.repeat(MAX_BODY_CHARS - 1) + '😀' + 'y'.repeat(50);
    const body = extractText(part('text/plain', longBody)).body;

    const roundTripped = new TextDecoder().decode(new TextEncoder().encode(body));
    expect(roundTripped).toBe(body);
    expect(body).not.toContain('�');
    expect(body.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
  });
});

describe('truncateAtCodePointBoundary', () => {
  it('backs the cut off by one when the boundary splits a surrogate pair', () => {
    const text = 'ab😀cd'; // the emoji occupies indices 2 and 3
    expect(truncateAtCodePointBoundary(text, 3)).toBe('ab');
  });

  it('cuts cleanly when the boundary does not land inside a pair', () => {
    expect(truncateAtCodePointBoundary('abcdef', 3)).toBe('abc');
  });

  it('leaves text alone when it is already within the cap', () => {
    expect(truncateAtCodePointBoundary('short', 100)).toBe('short');
  });

  it('keeps a pair that ends exactly on the boundary', () => {
    const text = 'ab😀'; // the emoji ends exactly at length 4
    expect(truncateAtCodePointBoundary(text, 4)).toBe(text);
  });
});
