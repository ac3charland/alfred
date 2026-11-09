import { spyOnFetch } from '../fetch-stub';
import { READER_HTML_CHARS } from './extract';
import {
  type DueFeed,
  FEED_USER_AGENT,
  type FeedHttp,
  type FeedResponse,
  type Fetcher,
  entryBody,
  feedHttp,
  intakeFeedEntry,
  openFeedPoll,
} from './feed-leg';
import { type DatedEntry, FEED_MAX_BYTES } from './feeds';
import { ENTRY_PAGE, LONG_PARAGRAPH, numberedFeed } from './fixtures/feeds';

const NOW = new Date('2026-11-09T12:00:00.000Z');
const NOW_ISO = NOW.toISOString();
/** A JSON `null` — how PostgREST spells "clear this column". This package bans the literal. */
const WIRE_NULL: unknown = JSON.parse('null');
const SUPABASE_URL = 'https://proj.supabase.co';
const env = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'key' };
const FEED: DueFeed = {
  id: 'pub-feed',
  name: 'Numbered',
  enabled: true,
  feed_url: 'https://numbered.example/feed.xml',
};

/** A `FeedHttp` that answers the feed with `feed` and every page with `page`. */
function fakeHttp(feed: FeedResponse, page?: string): FeedHttp & { pages: string[] } {
  const pages: string[] = [];
  return {
    pages,
    getFeed: () => Promise.resolve(feed),
    getPage: (url) => {
      pages.push(url);
      return Promise.resolve(page);
    },
  };
}

interface Rest {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

/** Stub PostgREST: the "already a post?" read answers `existing`, an insert `insertStatus`. */
function rest(options: { existing?: string[]; insertStatus?: number } = {}): Rest[] {
  const calls: Rest[] = [];
  spyOnFetch().mockImplementation((input, init) => {
    const url = input as string;
    const method = init?.method ?? 'GET';
    calls.push({
      url,
      method,
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
        string,
        unknown
      >,
    });
    if (method === 'POST') {
      return Promise.resolve(
        options.insertStatus === 409
          ? new Response('duplicate key', { status: 409 })
          : Response.json([{ id: 'post-new' }]),
      );
    }
    if (method === 'PATCH') return Promise.resolve(Response.json([{ id: 'pub-feed' }]));
    return Promise.resolve(
      Response.json((options.existing ?? []).map((id) => ({ feed_entry_id: id }))),
    );
  });
  return calls;
}

function dated(overrides: Partial<DatedEntry> = {}): DatedEntry {
  return {
    identity: 'entry-1',
    title: 'Cities are getting quieter',
    link: 'https://quiet.example/posts/cities',
    html: '<p>Noise maps show a decline.</p>',
    summaryOnly: true,
    date: new Date('2026-11-08T07:00:00.000Z'),
    ...overrides,
  };
}

/** A fetcher that answers every call with `response` and records what it was asked. */
function recordingFetcher(response: () => Response): {
  fetcher: Fetcher;
  seen: { url: string; init: RequestInit }[];
} {
  const seen: { url: string; init: RequestInit }[] = [];
  return {
    seen,
    fetcher: (url, init) => {
      seen.push({ url, init });
      return Promise.resolve(response());
    },
  };
}

describe('feedHttp', () => {
  it('sends the conditional-GET validators and alfred’s User-Agent, and reads the new ones back', async () => {
    const { fetcher, seen } = recordingFetcher(
      () => new Response('<rss/>', { headers: { ETag: '"v2"', 'Last-Modified': 'Sun' } }),
    );

    const response = await feedHttp(fetcher).getFeed(FEED.feed_url, {
      etag: '"v1"',
      lastModified: 'Sat',
    });

    const headers = new Headers(seen[0]?.init.headers);
    expect(headers.get('If-None-Match')).toBe('"v1"');
    expect(headers.get('If-Modified-Since')).toBe('Sat');
    expect(headers.get('User-Agent')).toBe(FEED_USER_AGENT);
    expect(seen[0]?.init.redirect).toBe('follow');
    expect(seen[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(response).toEqual({
      kind: 'ok',
      body: '<rss/>',
      validators: { etag: '"v2"', lastModified: 'Sun' },
    });
  });

  it.each([
    ['a 304', () => new Response(undefined, { status: 304 }), { kind: 'not-modified' }],
    [
      'a 404',
      () => new Response('gone', { status: 404 }),
      { kind: 'failed', error: 'it answered 404' },
    ],
    [
      'a body declared over the cap',
      () => new Response('x', { headers: { 'Content-Length': String(FEED_MAX_BYTES + 1) } }),
      { kind: 'failed', error: "it's too large to read" },
    ],
    [
      'a body that streams past the cap',
      () => new Response('x'.repeat(FEED_MAX_BYTES + 1)),
      { kind: 'failed', error: "it's too large to read" },
    ],
  ])('reads %s', async (_label, response, expected) => {
    const { fetcher } = recordingFetcher(response);
    await expect(feedHttp(fetcher).getFeed(FEED.feed_url, {})).resolves.toEqual(expected);
  });

  it('reads a network failure or a timeout as no answer', async () => {
    const http = feedHttp(() => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    await expect(http.getFeed(FEED.feed_url, {})).resolves.toEqual({
      kind: 'failed',
      error: "it didn't answer",
    });
    await expect(http.getPage('https://quiet.example/')).resolves.toBeUndefined();
  });

  it('reads an oversize page up to the cap rather than dropping it', async () => {
    const page = `<article><p>${'word '.repeat(10)}</p></article>${'x'.repeat(READER_HTML_CHARS)}`;
    const read = await feedHttp(() => Promise.resolve(new Response(page))).getPage(
      'https://a.example/',
    );
    expect(read).toHaveLength(READER_HTML_CHARS);
    expect(read?.startsWith('<article><p>word')).toBe(true);
  });

  it('reads a page, and nothing for a page that answers an error', async () => {
    await expect(
      feedHttp(() => Promise.resolve(new Response('<p>hi</p>'))).getPage('https://a.example/'),
    ).resolves.toBe('<p>hi</p>');
    await expect(
      feedHttp(() => Promise.resolve(new Response('no', { status: 403 }))).getPage(
        'https://a.example/',
      ),
    ).resolves.toBeUndefined();
  });
});

describe('openFeedPoll', () => {
  it('stamps a 304 as checked and read', async () => {
    const calls = rest();
    const poll = await openFeedPoll(env, fakeHttp({ kind: 'not-modified' }), FEED, NOW, 5);

    expect(poll).toEqual({ kind: 'not-modified' });
    expect(calls).toEqual([
      {
        url: `${SUPABASE_URL}/rest/v1/reader_publications?id=eq.pub-feed`,
        method: 'PATCH',
        body: { feed_checked_at: NOW_ISO, feed_last_success_at: NOW_ISO },
      },
    ]);
  });

  it('stamps a 404 as the feed’s error, and checked, so it is retried hourly', async () => {
    const calls = rest();
    const poll = await openFeedPoll(
      env,
      fakeHttp({ kind: 'failed', error: 'it answered 404' }),
      FEED,
      NOW,
      5,
    );

    expect(poll).toEqual({ kind: 'failed', error: 'it answered 404' });
    expect(calls.map((call) => call.body)).toEqual([
      { feed_checked_at: NOW_ISO, feed_last_error: 'it answered 404', feed_last_error_at: NOW_ISO },
    ]);
  });

  it('stamps a 200 that is not a feed any more', async () => {
    const calls = rest();
    const poll = await openFeedPoll(
      env,
      fakeHttp({ kind: 'ok', body: '<html><body>hi</body></html>', validators: {} }),
      FEED,
      NOW,
      5,
    );

    expect(poll).toEqual({ kind: 'failed', error: "it isn't an RSS or Atom feed any more" });
    expect(calls[0]?.body).toMatchObject({
      feed_last_error: "it isn't an RSS or Atom feed any more",
    });
  });

  it('reads which entries are already posts in one fetch, and plans the rest oldest first', async () => {
    const calls = rest({ existing: ['entry-0'] });
    const poll = await openFeedPoll(
      env,
      fakeHttp({ kind: 'ok', body: numberedFeed(3, NOW), validators: { etag: '"v2"' } }),
      FEED,
      NOW,
      5,
    );

    expect(calls).toHaveLength(1);
    const read = new URL(calls[0]?.url ?? '');
    expect(read.searchParams.get('feed_entry_id')).toBe('in.("entry-0","entry-1","entry-2")');
    expect(read.searchParams.get('publication_id')).toBe('eq.pub-feed');
    expect(poll).toMatchObject({ kind: 'polled', drained: true });
    expect(poll.kind === 'polled' && poll.entries.map((entry) => entry.identity)).toEqual([
      'entry-2',
      'entry-1',
    ]);
  });

  it('takes no more than its slots and says it did not drain — the feed stays due', async () => {
    const calls = rest();
    const poll = await openFeedPoll(
      env,
      fakeHttp({ kind: 'ok', body: numberedFeed(4, NOW), validators: {} }),
      FEED,
      NOW,
      2,
    );

    expect(poll).toMatchObject({ kind: 'polled', drained: false });
    expect(poll.kind === 'polled' && poll.entries.map((entry) => entry.identity)).toEqual([
      'entry-3',
      'entry-2',
    ]);
    // Only the read: no stamp until the entries are taken, and none at all when not drained.
    expect(calls.map((call) => call.method)).toEqual(['GET']);
  });

  it('stamps a drained poll that found nothing new at once, validators and all', async () => {
    const calls = rest({ existing: ['entry-0'] });
    await openFeedPoll(
      env,
      fakeHttp({ kind: 'ok', body: numberedFeed(1, NOW), validators: { etag: '"v3"' } }),
      FEED,
      NOW,
      5,
    );

    expect(calls.at(-1)).toMatchObject({
      method: 'PATCH',
      body: {
        feed_checked_at: NOW_ISO,
        feed_last_success_at: NOW_ISO,
        feed_etag: '"v3"',
        feed_last_modified: WIRE_NULL,
      },
    });
  });

  it('dates an entry with no date at the poll instant and gives it the feed’s author', async () => {
    rest();
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>F</title>
      <author><name>Odile Brand</name></author>
      <entry><id>x</id><title>T</title><content type="html">${LONG_PARAGRAPH}</content></entry></feed>`;
    const poll = await openFeedPoll(
      env,
      fakeHttp({ kind: 'ok', body: xml, validators: {} }),
      FEED,
      NOW,
      5,
    );

    expect(poll.kind === 'polled' && poll.entries[0]).toMatchObject({
      identity: 'x',
      date: NOW,
      author: 'Odile Brand',
    });
  });
});

describe('entryBody', () => {
  it('reads no page for a full-content entry', async () => {
    const http = fakeHttp({ kind: 'not-modified' }, ENTRY_PAGE);
    const body = await entryBody(
      http,
      dated({ html: `<p>${LONG_PARAGRAPH}</p>`, summaryOnly: false }),
    );

    expect(http.pages).toEqual([]);
    expect(body.text).toBe(LONG_PARAGRAPH);
    expect(body.html).toBe(`<p>${LONG_PARAGRAPH}</p>`);
  });

  it('reads an excerpt’s page and keeps its article when it is longer', async () => {
    const http = fakeHttp({ kind: 'not-modified' }, ENTRY_PAGE);
    const body = await entryBody(http, dated());

    expect(http.pages).toEqual(['https://quiet.example/posts/cities']);
    expect(body.text).toBe(LONG_PARAGRAPH);
    expect(body.html).not.toContain('Subscribe');
    expect(body.wordCount).toBe(300);
  });

  it('keeps the excerpt when the page can’t be read', async () => {
    const http = fakeHttp({ kind: 'not-modified' });
    const body = await entryBody(http, dated());

    expect(body.text).toBe('Noise maps show a decline.');
    expect(body.html).toBe('<p>Noise maps show a decline.</p>');
  });

  it('keeps the excerpt when the page’s article is shorter', async () => {
    const http = fakeHttp({ kind: 'not-modified' }, '<article><p>Hi.</p></article>');
    const body = await entryBody(http, dated());

    expect(body.text).toBe('Noise maps show a decline.');
  });

  it('reads no page for an excerpt with no link', async () => {
    const http = fakeHttp({ kind: 'not-modified' }, ENTRY_PAGE);
    await entryBody(http, dated({ link: undefined }));

    expect(http.pages).toEqual([]);
  });
});

describe('intakeFeedEntry', () => {
  it('inserts the floor with the lease taken, the entry’s date as received_at', async () => {
    const calls = rest();
    const taken = await intakeFeedEntry(
      env,
      fakeHttp({ kind: 'not-modified' }),
      'pub-feed',
      dated({ title: '  Cities\n are   quieter ', author: 'Odile Brand' }),
      NOW,
    );

    expect(taken).toMatchObject({ kind: 'ready', id: 'post-new', title: 'Cities are quieter' });
    expect(calls[0]?.body).toEqual({
      source: 'feed',
      publication_id: 'pub-feed',
      feed_entry_id: 'entry-1',
      title: 'Cities are quieter',
      author: 'Odile Brand',
      canonical_url: 'https://quiet.example/posts/cities',
      received_at: '2026-11-08T07:00:00.000Z',
      text: 'Noise maps show a decline.',
      word_count: 5,
      html_extracted: true,
      html: '<p>Noise maps show a decline.</p>',
      summary_state: 'pending',
      summarizing_since: NOW_ISO,
    });
  });

  it('files an entry with no text as failed in the same insert, and titles an untitled one', async () => {
    const calls = rest();
    const taken = await intakeFeedEntry(
      env,
      fakeHttp({ kind: 'not-modified' }),
      'pub-feed',
      dated({ title: ' ', html: '', link: undefined }),
      NOW,
    );

    expect(taken).toEqual({ kind: 'filed' });
    expect(calls[0]?.body).toMatchObject({
      title: 'Untitled',
      summary_state: 'failed',
      last_error: 'no readable body',
    });
    expect(calls[0]?.body).not.toHaveProperty('summarizing_since');
  });

  it('reads a unique violation as a lost race', async () => {
    rest({ insertStatus: 409 });
    const taken = await intakeFeedEntry(
      env,
      fakeHttp({ kind: 'not-modified' }),
      'pub-feed',
      dated(),
      NOW,
    );

    expect(taken).toEqual({ kind: 'conflict' });
  });
});
