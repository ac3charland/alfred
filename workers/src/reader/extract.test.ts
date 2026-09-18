import type { GmailMessage } from '../comms/gmail-api';
import { READER_TEXT_CHARS, UNTITLED, extractPost } from './extract';
import {
  ESSAY_MESSAGE,
  PLAIN_TEXT_ONLY_MESSAGE,
  PLATFORM_MAIL_MESSAGE,
  READER_FIXTURES,
  ROUNDUP_VIEW_IN_BROWSER_MESSAGE,
  encodeBody,
} from './fixtures';

const HARBORLINE = { name: 'Harborline' };

/** A message carrying exactly one `text/html` part, for the synthetic cases. */
function htmlMessage(html: string, headers: { name: string; value: string }[] = []): GmailMessage {
  return {
    id: 'synthetic-1',
    threadId: 'thread-synthetic-1',
    internalDate: '1789000000000',
    payload: {
      mimeType: 'text/html',
      headers: [{ name: 'Subject', value: 'Synthetic' }, ...headers],
      body: { size: html.length, data: encodeBody(html) },
    },
  };
}

describe('extractPost — the fixtures', () => {
  it('takes the title from the Subject header, never from the markup', () => {
    // Substack puts the post title in the subject line; the `<h1>` markup changes between
    // templates, and a wrong pick puts a nav label where the title belongs.
    expect(extractPost(ESSAY_MESSAGE, HARBORLINE).title).toBe('The Grain Ledger');
    expect(extractPost(PLAIN_TEXT_ONLY_MESSAGE, HARBORLINE).title).toBe(
      'Notes from the third week',
    );
  });

  it('takes the author from the From display name when there is one', () => {
    expect(extractPost(ESSAY_MESSAGE, HARBORLINE).author).toBe('Mira Vantz');
  });

  it('falls back to the publication name when From carries a bare address', () => {
    expect(extractPost(PLAIN_TEXT_ONLY_MESSAGE, { name: 'Tallowfield' }).author).toBe(
      'Tallowfield',
    );
  });

  it('takes the first /p/ link and strips its query and fragment', () => {
    expect(extractPost(ESSAY_MESSAGE, HARBORLINE).canonical_url).toBe(
      'https://harborline.substack.com/p/the-grain-ledger',
    );
  });

  it('never lets a javascript: or mailto: anchor become the URL', () => {
    // Both sit AHEAD of the post link in the essay fixture, so an "first anchor wins" rule would
    // take one of them. The value is rendered as an href, so this is a security rule.
    const url = extractPost(ESSAY_MESSAGE, HARBORLINE).canonical_url ?? '';
    expect(url.startsWith('https://')).toBe(true);
    expect(url).not.toContain('javascript');
    expect(url).not.toContain('mailto');
  });

  it('matches the bare "View in browser" wording as well as Substack\u2019s own', () => {
    const bare = extractPost(
      htmlMessage('<a href="https://x.example/i/1/2?t=3">View in browser</a>'),
      HARBORLINE,
    );
    expect(bare.canonical_url).toBe('https://x.example/i/1/2?t=3');
  });

  it('falls back to the view-in-browser anchor when there is no /p/ link', () => {
    expect(
      extractPost(ROUNDUP_VIEW_IN_BROWSER_MESSAGE, { name: 'The Cadence Weekly' }),
    ).toMatchObject({
      canonical_url: 'https://cadence.substack.com/i/149023188/9f2a?utm_source=email',
      html_extracted: true,
    });
  });

  it('reports no URL at all for a post with no links', () => {
    expect(extractPost(PLAIN_TEXT_ONLY_MESSAGE, HARBORLINE).canonical_url).toBeUndefined();
  });

  it('flags html_extracted both ways', () => {
    expect(extractPost(ESSAY_MESSAGE, HARBORLINE).html_extracted).toBe(true);
    // The plain-text fixture has no HTML part at all, so the plain body is the post.
    expect(extractPost(PLAIN_TEXT_ONLY_MESSAGE, HARBORLINE).html_extracted).toBe(false);
  });

  it('keeps the Message-ID with its angle brackets, as comms stores it', () => {
    expect(extractPost(ESSAY_MESSAGE, HARBORLINE).rfc822_message_id).toBe(
      '<essay-1@mail.harborline.substack.com>',
    );
  });

  it('reads received_at from internalDate', () => {
    expect(extractPost(ESSAY_MESSAGE, HARBORLINE).received_at).toBe(
      new Date(1_789_000_000_000).toISOString(),
    );
  });

  it('counts words on the stored text', () => {
    const post = extractPost(ESSAY_MESSAGE, HARBORLINE);
    expect(post.word_count).toBe(post.text.split(/\s+/).filter((token) => token !== '').length);
    expect(post.word_count).toBeGreaterThan(100);
  });

  it('strips the markup out of the HTML body', () => {
    const post = extractPost(ESSAY_MESSAGE, HARBORLINE);
    expect(post.text).toContain('Every port keeps two sets of books');
    expect(post.text).not.toContain('<p>');
    // The subscription footer and the share chrome come through as prose too — the summariser's
    // prompt is what tells the model to ignore them, not the extractor.
    expect(post.text).toContain('Manage your subscription');
  });

  it('never resolves platform mail to somebody else’s post', () => {
    // A digest has no canonical post of its own; resolving it to one of the posts it links would
    // put the wrong URL behind the row's "Open" verb.
    expect(extractPost(PLATFORM_MAIL_MESSAGE, { name: 'Substack' }).canonical_url).toBeUndefined();
  });

  it('extracts every committed fixture into something storable', () => {
    for (const fixture of READER_FIXTURES) {
      const post = extractPost(fixture.message, { name: fixture.name });
      expect(post.title).not.toBe('');
      expect(post.text.length).toBeGreaterThan(0);
      expect(post.received_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});

describe('extractPost — the edges', () => {
  it('truncates the stored text at READER_TEXT_CHARS', () => {
    const body = `<p>${'word '.repeat(120_000)}</p>`;
    const post = extractPost(htmlMessage(body), HARBORLINE);

    expect(body.length).toBeGreaterThan(READER_TEXT_CHARS);
    expect(post.text.length).toBeLessThanOrEqual(READER_TEXT_CHARS);
    // The count describes what was STORED, so it can never claim words nobody has.
    expect(post.word_count).toBe(post.text.split(/\s+/).filter((token) => token !== '').length);
  });

  it('returns empty text for a message whose every part is an attachment', () => {
    const message: GmailMessage = {
      id: 'attachments-only',
      threadId: 'thread-attachments-only',
      internalDate: '1789000000000',
      payload: {
        mimeType: 'multipart/mixed',
        headers: [{ name: 'Subject', value: 'Quarterly figures' }],
        parts: [
          {
            mimeType: 'application/pdf',
            filename: 'figures.pdf',
            body: { size: 12, data: encodeBody('not a post') },
          },
          {
            // An attached `.html` is a file the sender chose to attach, not the post they wrote.
            mimeType: 'text/html',
            filename: 'figures.html',
            body: { size: 20, data: encodeBody('<p>not a post</p>') },
          },
        ],
      },
    };

    const post = extractPost(message, HARBORLINE);
    expect(post.text).toBe('');
    expect(post.word_count).toBe(0);
    expect(post.html_extracted).toBe(false);
  });

  it('decodes entities in an href before parsing it', () => {
    const post = extractPost(
      htmlMessage('<a href="https://x.example/p/slug?a=1&amp;b=2">Read</a>'),
      HARBORLINE,
    );
    expect(post.canonical_url).toBe('https://x.example/p/slug');
  });

  it('refuses a relative href, which is not a URL the owner can be sent to', () => {
    expect(
      extractPost(htmlMessage('<a href="/p/slug">Read</a>'), HARBORLINE).canonical_url,
    ).toBeUndefined();
  });

  it('falls back to the HTML title, then to (untitled), when the subject is empty', () => {
    const titled = htmlMessage('<html><head><title>A fallback title</title></head></html>');
    titled.payload = { ...titled.payload, headers: [{ name: 'Subject', value: ' '.repeat(3) }] };
    expect(extractPost(titled, HARBORLINE).title).toBe('A fallback title');

    const bare = htmlMessage('<p>no head at all</p>');
    bare.payload = { ...bare.payload, headers: [] };
    expect(extractPost(bare, HARBORLINE).title).toBe(UNTITLED);
  });

  it('collapses whitespace in a subject that wrapped across header lines', () => {
    const wrapped = htmlMessage('<p>body</p>', []);
    wrapped.payload = {
      ...wrapped.payload,
      headers: [{ name: 'Subject', value: 'The Grain\n  Ledger' }],
    };
    expect(extractPost(wrapped, HARBORLINE).title).toBe('The Grain Ledger');
  });

  it('prefers the plain part when the HTML part is empty', () => {
    // A template that shipped an empty `text/html` part beside a real `text/plain` one must not
    // produce a body-less row whose flag says the body was read fine.
    const message: GmailMessage = {
      id: 'empty-html',
      threadId: 'thread-empty-html',
      internalDate: '1789000000000',
      payload: {
        mimeType: 'multipart/alternative',
        headers: [{ name: 'Subject', value: 'Still readable' }],
        parts: [
          { mimeType: 'text/html', body: { size: 0 } },
          { mimeType: 'text/plain', body: { size: 5, data: encodeBody('hello there') } },
        ],
      },
    };

    const post = extractPost(message, HARBORLINE);
    expect(post.text).toBe('hello there');
    expect(post.html_extracted).toBe(false);
  });

  it('falls back to the caller’s date when Gmail sent no internalDate', () => {
    const undated: GmailMessage = { ...ESSAY_MESSAGE, internalDate: undefined };
    expect(
      extractPost(undated, HARBORLINE, { receivedAt: '2026-09-16T11:06:40.000Z' }).received_at,
    ).toBe('2026-09-16T11:06:40.000Z');
  });
});
