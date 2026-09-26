import type { GmailMessage } from '../comms/gmail-api';
import { READER_HTML_CHARS, READER_TEXT_CHARS, UNTITLED, extractPost } from './extract';
import {
  ESSAY_MESSAGE,
  PLAIN_TEXT_ONLY_MESSAGE,
  PLATFORM_MAIL_MESSAGE,
  REACTION_NOTIFICATION_MESSAGE,
  READER_FIXTURES,
  READ_IN_APP_MESSAGE,
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
    expect(extractPost(ESSAY_MESSAGE, HARBORLINE).title).toBe(
      'Harborline\u2019s Grain Ledger \u{1F91D} the berth telemetry',
    );
    expect(extractPost(PLAIN_TEXT_ONLY_MESSAGE, HARBORLINE).title).toBe(
      'Notes from the third week',
    );
  });

  it('takes the author from the From display name, without the publication after it', () => {
    // The fixture's `From` is `Mira Vantz from Harborline <harborline@substack.com>`.
    expect(extractPost(ESSAY_MESSAGE, HARBORLINE).author).toBe('Mira Vantz');
  });

  it('falls back to the publication name when From carries a bare address', () => {
    expect(extractPost(PLAIN_TEXT_ONLY_MESSAGE, { name: 'Tallowfield' }).author).toBe(
      'Tallowfield',
    );
  });

  it('takes the post path past the wrappers and strips its query and fragment', () => {
    expect(extractPost(ESSAY_MESSAGE, HARBORLINE).canonical_url).toBe(
      'https://open.substack.com/pub/harborline/p/the-grain-ledger',
    );
  });

  it('never lets a javascript: or mailto: anchor become the URL', () => {
    // The value is rendered as an href the owner clicks, so refusing these is a SECURITY rule
    // rather than a preference — either one sitting ahead of the post link must drop out, not
    // merely lose. Synthetic because the live template carries neither; the rule outlives it.
    const html =
      '<a href="javascript:void(0)">Save this post</a>' +
      '<a href="mailto:friend@example.org?subject=Harborline">Email a friend</a>' +
      '<a href="https://open.substack.com/pub/harborline/p/slug">Read</a>';
    expect(extractPost(htmlMessage(html), HARBORLINE).canonical_url).toBe(
      'https://open.substack.com/pub/harborline/p/slug',
    );
  });

  it('matches the bare "View in browser" wording as well as Substack\u2019s own', () => {
    const bare = extractPost(
      htmlMessage('<a href="https://x.example/i/1/2?t=3">View in browser</a>'),
      HARBORLINE,
    );
    expect(bare.canonical_url).toBe('https://x.example/i/1/2?t=3');
  });

  it('falls back to the anchor text when the mail carries no post path', () => {
    expect(extractPost(READ_IN_APP_MESSAGE, { name: 'The Cadence Weekly' })).toMatchObject({
      canonical_url: 'https://cadence.substack.com/i/149023188/9f2a?utm_source=email',
      html_extracted: true,
    });
  });

  it('resolves a reaction notification to the post it links, which is somebody else\u2019s', () => {
    // Pinned rather than special-cased: the notification is the one mail still carrying a bare
    // `/p/<slug>`, and the rule takes it. Nothing downstream is harmed because the sender never
    // reaches the roster — `discoverPublications` refuses both its local part and its host — so
    // no reaction mail is ever handed to the extractor in the first place.
    expect(extractPost(REACTION_NOTIFICATION_MESSAGE, { name: 'Pell Marrow' })).toMatchObject({
      canonical_url: 'https://tidewrack.substack.com/p/berth-9-at-midnight',
      author: 'Pell Marrow',
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

  it('keeps the raw email HTML for a post whose body came out of it', () => {
    // Raw means raw: the send hands this to Instapaper, whose parser picks the article out of
    // the mail's chrome — so nothing is stripped here, preheaders and footer included.
    const html = extractPost(ESSAY_MESSAGE, HARBORLINE).html;
    expect(html).toContain('<p>');
    expect(html).toContain('Every port keeps two sets of books');
    expect(html).toContain('What three open berth feeds');
    expect(html).toContain('Manage your subscription');
  });

  it('keeps no HTML for a post whose body came from the plain part', () => {
    expect(extractPost(PLAIN_TEXT_ONLY_MESSAGE, HARBORLINE).html).toBeUndefined();
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

  it('strips the markup, and the hidden preheaders with it, out of the HTML body', () => {
    const post = extractPost(ESSAY_MESSAGE, HARBORLINE);
    expect(post.text).toContain('Every port keeps two sets of books');
    expect(post.text).not.toContain('<p>');
    // Both `display:none` divs are gone: the preview line and the invisible padding run.
    expect(post.text).not.toContain('What three open berth feeds');
    expect(post.text).not.toMatch(/\u034F|\u00AD/);
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

describe('extractPost — the canonical URL on the live template', () => {
  /** The anchor order every post mail carries, in document order. */
  const LIVE_TEMPLATE =
    '<a href="https://substack.com/redirect/2/eyJlIjoiaHR0cHM6Ly9leGFtcGxlIn0">Subscribe here</a>' +
    '<a href="https://substack.com/redirect/2/eyJlIjoiaHR0cHM6Ly9leGFtcGxlL3AveCJ9"></a>' +
    '<a href="https://substack.com/app-link/post?token=abc">Open in the app</a>' +
    '<a href="https://substack.com/@miravantz">Mira Vantz</a>' +
    '<a href="https://open.substack.com/pub/harborline/p/the-grain-ledger?utm_source=email"></a>' +
    '<a href="https://open.substack.com/pub/harborline/p/the-grain-ledger?utm_source=email">READ IN APP</a>' +
    '<a href="https://substack.com/redirect/5cfcf664-1dd0-4804-b02c-b610a0e9df6a">a link in the body</a>';

  it('takes the /pub/<name>/p/<slug> link past the wrappers, the app link and the byline', () => {
    expect(extractPost(htmlMessage(LIVE_TEMPLATE), HARBORLINE).canonical_url).toBe(
      'https://open.substack.com/pub/harborline/p/the-grain-ledger',
    );
  });

  it('never unwraps a substack.com/redirect link, however the post URL is buried in it', () => {
    // The base64 payload carries the post's URL in its `e` field, and it is an EXPIRING tracker,
    // not the post's address: stored and opened months later it resolves to nothing. A message
    // whose only link is a wrapper has no canonical URL, and saying so is the honest answer.
    const wrapped =
      '<a href="https://substack.com/redirect/2/eyJlIjoiaHR0cHM6Ly9oYXJib3JsaW5lLnN1YnN0YWNrLmNvbS9wL3gifQ">Read</a>';
    expect(extractPost(htmlMessage(wrapped), HARBORLINE).canonical_url).toBeUndefined();
  });

  it('strips the campaign query and the fragment off a /pub/ link', () => {
    const html =
      '<a href="https://open.substack.com/pub/harborline/p/slug?utm_source=e#top">Read</a>';
    expect(extractPost(htmlMessage(html), HARBORLINE).canonical_url).toBe(
      'https://open.substack.com/pub/harborline/p/slug',
    );
  });

  it('lets document order decide between a publication-hosted link and an open.substack one', () => {
    // One rule, stated once: whichever slug link comes first wins. Both address the same post,
    // and a preference between the two hosts would be a second rule to keep true of a template
    // that changes without telling us.
    const publicationFirst =
      '<a href="https://harborline.substack.com/p/slug">Read</a>' +
      '<a href="https://open.substack.com/pub/harborline/p/slug">READ IN APP</a>';
    expect(extractPost(htmlMessage(publicationFirst), HARBORLINE).canonical_url).toBe(
      'https://harborline.substack.com/p/slug',
    );
  });

  it('falls back to the READ IN APP anchor when no slug link is there to take', () => {
    const html =
      '<a href="https://substack.com/app-link/post?token=abc">READ IN APP</a>' +
      '<a href="https://substack.com/@miravantz">Mira Vantz</a>';
    expect(extractPost(htmlMessage(html), HARBORLINE).canonical_url).toBe(
      'https://substack.com/app-link/post?token=abc',
    );
  });
});

describe('extractPost — the header shapes real mail arrives in', () => {
  it('decodes an RFC 2047 subject, including two words split mid-word', () => {
    const encoded = htmlMessage('<p>body</p>');
    encoded.payload = {
      ...encoded.payload,
      headers: [
        {
          name: 'Subject',
          value: '=?UTF-8?q?Let=E2=80=99s_talk_about_bert?= =?UTF-8?q?hing_fees_=F0=9F=A4=9D?=',
        },
      ],
    };
    expect(extractPost(encoded, HARBORLINE).title).toBe(
      'Let\u2019s talk about berthing fees \u{1F91D}',
    );
  });

  it('drops the " from <publication>" suffix so the author is the person', () => {
    // Substack writes a publication's own byline three ways; this is the one where the display
    // name is the person AND the publication, and the row wants the person.
    const message = htmlMessage('<p>body</p>', [
      { name: 'From', value: 'Mira Vantz from Harborline <harborline@substack.com>' },
    ]);
    expect(extractPost(message, HARBORLINE).author).toBe('Mira Vantz');
  });

  it('matches that suffix however the sender capitalised the publication', () => {
    const message = htmlMessage('<p>body</p>', [
      { name: 'From', value: 'Mira Vantz FROM harborline <harborline@substack.com>' },
    ]);
    expect(extractPost(message, HARBORLINE).author).toBe('Mira Vantz');
  });

  it('leaves a display name that is only the publication name alone', () => {
    const message = htmlMessage('<p>body</p>', [
      { name: 'From', value: 'Harborline <harborline@substack.com>' },
    ]);
    expect(extractPost(message, HARBORLINE).author).toBe('Harborline');
  });

  it('counts only the visible words, not the invisible preheader padding', () => {
    // Substack's second preheader is ~400 characters of `&#847;&nbsp;&#8199;&#173;`, which reach
    // a whitespace split as some 200 empty words and inflate the row's read-minutes estimate.
    const padding = '&#847;&nbsp;&#8199;&#173;'.repeat(60);
    const html =
      '<div style="display:none;max-height:0px;">A preview line the reader never sees</div>' +
      `<div style="display:none;max-height:0px;">${padding}</div>` +
      '<p>Four visible words here</p>';

    const post = extractPost(htmlMessage(html), HARBORLINE);
    expect(post.text).toBe('Four visible words here');
    expect(post.word_count).toBe(4);
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

  it('keeps the HTML up to READER_HTML_CHARS and none past it, never a truncated half', () => {
    // Truncated markup is worse than none: an unclosed tag can swallow the rest of the article
    // in Instapaper's parser, where the stored text is a clean fallback.
    const within = `<p>${'x'.repeat(READER_HTML_CHARS - 7)}</p>`;
    expect(within).toHaveLength(READER_HTML_CHARS);
    expect(extractPost(htmlMessage(within), HARBORLINE).html).toBe(within);

    const over = `<p>${'x'.repeat(READER_HTML_CHARS - 6)}</p>`;
    const post = extractPost(htmlMessage(over), HARBORLINE);
    expect(post.html).toBeUndefined();
    // The body itself is still stored — only the markup is dropped.
    expect(post.text).not.toBe('');
    expect(post.html_extracted).toBe(true);
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
    // The HTML produced nothing, so it is not the body — and not what a send should carry.
    expect(post.html).toBeUndefined();
  });

  it('falls back to the caller’s date when Gmail sent no internalDate', () => {
    const undated: GmailMessage = { ...ESSAY_MESSAGE, internalDate: undefined };
    expect(
      extractPost(undated, HARBORLINE, { receivedAt: '2026-09-16T11:06:40.000Z' }).received_at,
    ).toBe('2026-09-16T11:06:40.000Z');
  });
});
