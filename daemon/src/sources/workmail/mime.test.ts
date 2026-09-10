import { HTML_ONLY, NEWSLETTER, PLAIN_REPLY, WITH_ATTACHMENT } from './fixtures.ts';
import { MAX_BODY_CHARS, extractMessage, parseMime } from './mime.ts';

describe('extractMessage', () => {
  it('reads the headers a reply is threaded and addressed by', async () => {
    const extracted = await extractMessage(PLAIN_REPLY, parseMime);

    expect(extracted).toEqual({
      messageId: '<reply-1@example.com>',
      inReplyTo: '<queued-1@example.com>',
      references: ['<root-0@example.com>', '<queued-1@example.com>'],
      subject: 'Re: Invoice 42',
      fromAddress: 'ada@example.com',
      fromName: 'Ada Lovelace',
      participants: ['support@realplayapp.com', 'bob@example.com', 'carol@example.com'],
      body: 'Could you re-send the invoice?',
      date: new Date('2025-09-08T10:00:00.000Z'),
      hasAttachments: false,
      listHeaders: [],
    });
  });

  it('reads a body out of a message whose only part is HTML', async () => {
    const extracted = await extractMessage(HTML_ONLY, parseMime);

    expect(extracted?.body).toBe('Hello there.\nSecond paragraph.');
  });

  it('falls back to stripping the HTML itself when the parser produced no text part', async () => {
    const htmlOnly = await extractMessage('ignored', () =>
      Promise.resolve({
        attachments: [],
        headers: new Map(),
        headerLines: [],
        html: '<p>Hello <b>there</b>.</p><p>Second&nbsp;line &amp; more</p>',
      }),
    );

    expect(htmlOnly?.body).toBe('Hello there.\nSecond line & more');
  });

  it('notices an attached file', async () => {
    const extracted = await extractMessage(WITH_ATTACHMENT, parseMime);

    expect(extracted?.hasAttachments).toBe(true);
  });

  it('names the bulk-mail headers a newsletter carries, lower-cased', async () => {
    const extracted = await extractMessage(NEWSLETTER, parseMime);

    expect(extracted?.listHeaders).toEqual(['list-unsubscribe', 'list-id', 'precedence']);
  });

  it('ignores a Precedence that says nothing about bulk mail', async () => {
    const urgent = await extractMessage('ignored', () =>
      Promise.resolve({
        attachments: [],
        headers: new Map(),
        headerLines: [{ key: 'precedence', line: 'Precedence: urgent' }],
        html: false,
      }),
    );

    expect(urgent?.listHeaders).toEqual([]);
  });

  it('truncates a body long enough to bloat every payload it rides in', async () => {
    const long = 'x'.repeat(MAX_BODY_CHARS + 500);
    const extracted = await extractMessage('ignored', () =>
      Promise.resolve({
        attachments: [],
        headers: new Map(),
        headerLines: [],
        html: false,
        text: long,
      }),
    );

    expect(extracted?.body).toHaveLength(MAX_BODY_CHARS);
  });

  it('backs off one code unit rather than splitting a surrogate pair at the cap', async () => {
    // An emoji is two UTF-16 code units; placed to straddle the cap, a naive `slice(0,
    // MAX_BODY_CHARS)` cuts between them and leaves a lone high surrogate dangling at the end —
    // which `TextEncoder` (what `fetch` does to a string body) turns into U+FFFD.
    const emoji = '😀';
    const long = 'x'.repeat(MAX_BODY_CHARS - 1) + emoji + 'y'.repeat(50);
    const extracted = await extractMessage('ignored', () =>
      Promise.resolve({
        attachments: [],
        headers: new Map(),
        headerLines: [],
        html: false,
        text: long,
      }),
    );

    const body = extracted?.body ?? '';
    expect(body).toHaveLength(MAX_BODY_CHARS - 1);
    expect(body.endsWith('x')).toBe(true);
    const lastCode = body.codePointAt(body.length - 1) ?? 0;
    expect(lastCode >= 0xd8_00 && lastCode <= 0xdb_ff).toBe(false);
    // No lone surrogate reaches the wire as a replacement character.
    const encoded = [...new TextEncoder().encode(body)];
    const replacementBytes = [0xef, 0xbf, 0xbd];
    const hasReplacementChar = encoded.some((_, index) =>
      replacementBytes.every((byte, offset) => encoded[index + offset] === byte),
    );
    expect(hasReplacementChar).toBe(false);
  });

  it('gives back nothing when the parser cannot make sense of the message', async () => {
    const extracted = await extractMessage('anything', () => Promise.reject(new Error('bad MIME')));

    expect(extracted).toBeUndefined();
  });
});
