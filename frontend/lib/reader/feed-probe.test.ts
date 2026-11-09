/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  FEED_PROBE_MAX_BYTES,
  FEED_USER_AGENT,
  feedHostName,
  normaliseFeedUrl,
  probeFeed,
  sniffFeed,
} from './feed-probe';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
  <title>Harbour &amp; Tide</title><item><title>Not the feed title</title></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Mark Larson</title>
  <entry><title>2026, Week 45</title></entry></feed>`;

const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
  <channel rdf:about="https://almanac.example/"><title>The Almanac</title></channel>
</rdf:RDF>`;

const HOMEPAGE = '<!DOCTYPE html><html><head><title>A blog</title></head><body></body></html>';

describe('sniffFeed', () => {
  it.each([
    ['RSS 2.0', RSS, 'Harbour & Tide'],
    ['Atom', ATOM, 'Mark Larson'],
    ['RSS 1.0 / RDF', RDF, 'The Almanac'],
    [
      'an HTML-typed title with markup and references',
      '<feed><title type="html">On &lt;em&gt;lanterns&lt;/em&gt; &amp;#8217;n</title></feed>',
      'On lanterns ’n',
    ],
  ])('reads %s as a feed with its title', (_label, xml, title) => {
    expect(sniffFeed(xml)).toEqual({ title });
  });

  it('reads a feed with no title as a feed with none', () => {
    expect(sniffFeed('<rss><channel></channel></rss>')).toEqual({ title: undefined });
  });

  it.each([
    ['an HTML page', HOMEPAGE],
    ['plain text', 'this is { not xml'],
    ['an empty body', ''],
    ['an rss root with no channel', '<rss></rss>'],
  ])('refuses %s', (_label, xml) => {
    expect(sniffFeed(xml)).toBeUndefined();
  });
});

describe('normaliseFeedUrl', () => {
  it('trims, lower-cases the scheme and host, drops the fragment, keeps the path and query', () => {
    expect(normaliseFeedUrl('  HTTPS://MLarson.ORG/Feed.xml?Format=Atom#top ')).toBe(
      'https://mlarson.org/Feed.xml?Format=Atom',
    );
  });

  it.each(['mlarson.org/feed.xml', 'ftp://mlarson.org/feed.xml', 'javascript:alert(1)'])(
    'refuses %s',
    (raw) => {
      expect(normaliseFeedUrl(raw)).toBeUndefined();
    },
  );
});

describe('feedHostName', () => {
  it('names a feed by its host, without www.', () => {
    expect(feedHostName('https://www.mlarson.org/feed.xml')).toBe('mlarson.org');
    expect(feedHostName('https://blog.example.com/rss')).toBe('blog.example.com');
  });
});

function answering(response: () => Response): {
  fetcher: typeof fetch;
  init: () => RequestInit | undefined;
} {
  let seen: RequestInit | undefined;
  return {
    fetcher: (_input, requestInit) => {
      seen = requestInit;
      return Promise.resolve(response());
    },
    init: () => seen,
  };
}

describe('probeFeed', () => {
  it('reads a feed and its title, sending alfred’s User-Agent and a timeout', async () => {
    const { fetcher, init } = answering(() => new Response(ATOM));

    await expect(probeFeed('https://mlarson.org/feed.xml', fetcher)).resolves.toEqual({
      kind: 'feed',
      title: 'Mark Larson',
    });
    expect(new Headers(init()?.headers).get('User-Agent')).toBe(FEED_USER_AGENT);
    expect(init()?.signal).toBeInstanceOf(AbortSignal);
    expect(init()?.redirect).toBe('follow');
  });

  it('calls a homepage not a feed', async () => {
    const { fetcher } = answering(() => new Response(HOMEPAGE));
    await expect(probeFeed('https://mlarson.org', fetcher)).resolves.toEqual({
      kind: 'not-a-feed',
    });
  });

  it('quotes a non-2xx status as unreachable', async () => {
    const { fetcher } = answering(() => new Response('gone', { status: 404 }));
    await expect(probeFeed('https://mlarson.org/feed.xml', fetcher)).resolves.toEqual({
      kind: 'unreachable',
      status: 404,
    });
  });

  it('calls a network failure or a timeout unreachable with no status', async () => {
    await expect(
      probeFeed('https://mlarson.org/feed.xml', () =>
        Promise.reject(new DOMException('timed out', 'TimeoutError')),
      ),
    ).resolves.toEqual({ kind: 'unreachable' });
  });

  it('calls a body past the size cap not a feed', async () => {
    const { fetcher } = answering(
      () => new Response(`<rss><channel>${' '.repeat(FEED_PROBE_MAX_BYTES)}</channel></rss>`),
    );
    await expect(probeFeed('https://big.example/feed.xml', fetcher)).resolves.toEqual({
      kind: 'not-a-feed',
    });
  });

  it('refuses a declared body past the cap without reading it', async () => {
    const { fetcher } = answering(
      () => new Response(RSS, { headers: { 'Content-Length': String(FEED_PROBE_MAX_BYTES + 1) } }),
    );
    await expect(probeFeed('https://big.example/feed.xml', fetcher)).resolves.toEqual({
      kind: 'not-a-feed',
    });
  });
});
