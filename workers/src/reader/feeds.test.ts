import { htmlToText } from '../comms/email-text';
import {
  type DatedEntry,
  EXCERPT_WORDS,
  FEED_ENTRY_LIMIT,
  type FeedEntry,
  dueFeed,
  entryDate,
  entryIdentity,
  isDue,
  isExcerpt,
  pageArticleHtml,
  parseFeed,
  planFeedEntries,
  webLink,
} from './feeds';
import {
  ATOM_SUMMARY_FEED,
  ENTRY_PAGE,
  HTML_PAGE,
  LONG_PARAGRAPH,
  MALFORMED_FEED,
  MLARSON_FEED,
  RDF_FEED,
  RSS_DESCRIPTION_ONLY_FEED,
  RSS_FULL_FEED,
  UNDATED_FEED,
  numberedFeed,
} from './fixtures/feeds';

/** The mlarson.org capture's day: its newest entry is a day old, the next eight days. */
const NOW = new Date('2026-11-09T12:00:00Z');

function entry(overrides: Partial<FeedEntry> = {}): FeedEntry {
  return { title: 'A title', html: `<p>${LONG_PARAGRAPH}</p>`, summaryOnly: false, ...overrides };
}

function dated(identity: string, date: string, overrides: Partial<FeedEntry> = {}): DatedEntry {
  return { ...entry(overrides), identity, date: new Date(date) };
}

describe('parseFeed', () => {
  it('reads the captured mlarson.org Atom feed', () => {
    const feed = parseFeed(MLARSON_FEED, 'https://mlarson.org/feed.xml');
    expect(feed?.title).toBe('Mark Larson');
    expect(feed?.author).toBe('Mark Larson');
    expect(feed?.entries).toHaveLength(3);
    const [newest] = feed?.entries ?? [];
    expect(newest).toMatchObject({
      id: 'https://mlarson.org/2026/11/08/2026-week-45/',
      title: '2026, Week 45',
      link: 'https://mlarson.org/2026/11/08/2026-week-45/',
      rawDate: '2026-11-08T08:11:17.000Z',
      summaryOnly: false,
    });
    expect(newest?.html).toContain("<p>I'm taking much earlier bedtimes");
  });

  it('carries full content, so no mlarson.org entry is an excerpt', () => {
    const feed = parseFeed(MLARSON_FEED);
    expect(feed?.entries.map((item) => isExcerpt(item))).toStrictEqual([false, false, false]);
  });

  it('reads RSS 2.0: content:encoded over description, guid, pubDate, author and dc:creator', () => {
    const feed = parseFeed(RSS_FULL_FEED, 'https://harbour.example/feed.xml');
    expect(feed?.title).toBe('Harbour & Tide');
    expect(feed?.author).toBe('Ines Calloway');
    const [first, second] = feed?.entries ?? [];
    expect(first).toMatchObject({
      id: 'harbour-42',
      title: 'The Grain Ledger',
      link: 'https://harbour.example/grain-ledger',
      author: 'Ines Calloway',
      rawDate: 'Sat, 07 Nov 2026 09:30:00 +0000',
      summaryOnly: false,
    });
    expect(first?.html).toContain('elsewhere.example');
    // A relative link resolves against the feed's own URL; entities in a title are decoded.
    expect(second).toMatchObject({
      title: 'Older ’tide’ notes',
      link: 'https://harbour.example/tide-notes',
    });
  });

  it('reads Atom: the alternate HTML link, published over updated, summary as the body', () => {
    const feed = parseFeed(ATOM_SUMMARY_FEED);
    expect(feed?.author).toBe('Odile Brand');
    const [first] = feed?.entries ?? [];
    expect(first).toMatchObject({
      id: 'tag:lantern.example,2026:on-lanterns',
      title: 'On lanterns',
      link: 'https://lantern.example/on-lanterns',
      author: undefined,
      rawDate: '2026-11-06T12:00:00Z',
      summaryOnly: true,
    });
  });

  it('reads RSS 1.0 / RDF: items beside the channel, rdf:about and dc:date', () => {
    const feed = parseFeed(RDF_FEED);
    expect(feed?.title).toBe('The Almanac');
    expect(feed?.entries).toStrictEqual([
      expect.objectContaining({
        id: 'https://almanac.example/frost',
        title: 'First frost',
        rawDate: '2026-11-05T06:00:00Z',
      }),
    ]);
  });

  it('reads Atom xhtml content and titles as markup, every word in order', () => {
    const [first] =
      parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>x</id>
        <title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">My <b>Blog</b> post</div></title>
        <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Hello <em>world</em> there &amp; back</p></div></content>
      </entry></feed>`)?.entries ?? [];
    expect(first?.title).toBe('My Blog post');
    expect(first?.html).toContain('<p>Hello <em>world</em> there &amp; back</p>');
    expect(htmlToText(first?.html ?? '')).toBe('Hello world there & back');
  });

  it('reads an escaped html body and a CDATA body as the same HTML', () => {
    const escaped = parseFeed(
      '<rss><channel><item><description>&lt;p&gt;A &amp;amp; B&lt;/p&gt;</description></item></channel></rss>',
    );
    const cdata = parseFeed(
      '<rss><channel><item><description><![CDATA[<p>A &amp; B</p>]]></description></item></channel></rss>',
    );
    expect(escaped?.entries[0]?.html).toBe('<p>A &amp; B</p>');
    expect(cdata?.entries[0]?.html).toBe('<p>A &amp; B</p>');
  });

  it('never keeps a non-http link', () => {
    const [first] = parseFeed(UNDATED_FEED)?.entries ?? [];
    expect(first?.link).toBeUndefined();
  });

  it('reads an RSS feed with an empty channel as a feed with no entries', () => {
    expect(parseFeed('<rss><channel></channel></rss>')).toEqual({
      title: undefined,
      author: undefined,
      entries: [],
    });
  });

  it.each([
    ['an rss root with no channel', '<rss></rss>'],
    ['malformed text', MALFORMED_FEED],
    ['an HTML page', HTML_PAGE],
    ['an empty document', ''],
  ])('refuses %s', (_label, xml) => {
    expect(parseFeed(xml)).toBeUndefined();
  });
});

describe('webLink', () => {
  it.each([
    ['https://a.example/x', undefined, 'https://a.example/x'],
    ['/x', 'https://a.example/feed.xml', 'https://a.example/x'],
    ['javascript:alert(1)', 'https://a.example/', undefined],
    ['mailto:a@b.example', undefined, undefined],
    ['/relative-without-base', undefined, undefined],
    ['  ', undefined, undefined],
  ])('reads %s (base %s) as %s', (href, base, expected) => {
    expect(webLink(href, base)).toBe(expected);
  });
});

describe('entryIdentity', () => {
  it('prefers the id, then the link', async () => {
    await expect(entryIdentity(entry({ id: 'id-1', link: 'https://a.example/' }))).resolves.toBe(
      'id-1',
    );
    await expect(entryIdentity(entry({ link: 'https://a.example/' }))).resolves.toBe(
      'https://a.example/',
    );
  });

  it('falls back to a hash of the title and date, stable across polls', async () => {
    const one = await entryIdentity(entry({ title: 'T', rawDate: 'D' }));
    expect(one).toMatch(/^sha256:[\da-f]{64}$/);
    await expect(entryIdentity(entry({ title: 'T', rawDate: 'D' }))).resolves.toBe(one);
    await expect(entryIdentity(entry({ title: 'T', rawDate: 'E' }))).resolves.not.toBe(one);
  });

  it('is unmoved by an edit to the updated date when the entry has an id', async () => {
    const before = await entryIdentity(entry({ id: 'x', rawDate: '2026-11-01T00:00:00Z' }));
    const after = await entryIdentity(entry({ id: 'x', rawDate: '2026-11-08T00:00:00Z' }));
    expect(after).toBe(before);
  });
});

describe('entryDate', () => {
  it('parses RFC 822 and ISO dates', () => {
    expect(
      entryDate(entry({ rawDate: 'Sat, 07 Nov 2026 09:30:00 +0000' }), NOW).toISOString(),
    ).toBe('2026-11-07T09:30:00.000Z');
    expect(entryDate(entry({ rawDate: '2026-11-05T06:00:00Z' }), NOW).toISOString()).toBe(
      '2026-11-05T06:00:00.000Z',
    );
  });

  it.each([
    ['no date', undefined],
    ['an unparsable date', 'last Tuesday'],
    ['a future date', 'Fri, 01 Jan 2100 00:00:00 GMT'],
  ])('dates %s at the poll instant', (_label, rawDate) => {
    expect(entryDate(entry({ rawDate }), NOW)).toStrictEqual(NOW);
  });
});

describe('isExcerpt', () => {
  it(`calls a body under ${String(EXCERPT_WORDS)} words an excerpt`, () => {
    expect(isExcerpt(entry({ html: '<p>Short.</p>' }))).toBe(true);
  });

  it('calls a long full-content body the article', () => {
    expect(isExcerpt(entry())).toBe(false);
  });

  it('calls a long summary-only body that trails off an excerpt', () => {
    expect(isExcerpt(entry({ html: `${LONG_PARAGRAPH} And then…`, summaryOnly: true }))).toBe(true);
    expect(
      isExcerpt(
        entry({
          html: `<p>${LONG_PARAGRAPH}</p><a href="https://x.example">Continue reading →</a>`,
          summaryOnly: true,
        }),
      ),
    ).toBe(true);
  });

  it('does not call a long full-content body that happens to end in an ellipsis an excerpt', () => {
    expect(isExcerpt(entry({ html: `${LONG_PARAGRAPH} And then…`, summaryOnly: false }))).toBe(
      false,
    );
  });

  it('reads the fixtures: the description-only and summary-only feeds are excerpts', () => {
    expect(
      parseFeed(RSS_DESCRIPTION_ONLY_FEED)?.entries.map((item) => isExcerpt(item)),
    ).toStrictEqual([true]);
    expect(parseFeed(ATOM_SUMMARY_FEED)?.entries.map((item) => isExcerpt(item))).toStrictEqual([
      true,
    ]);
    expect(parseFeed(RSS_FULL_FEED)?.entries.map((item) => isExcerpt(item))).toStrictEqual([
      false,
      false,
    ]);
  });
});

describe('pageArticleHtml', () => {
  it('keeps the article and drops the chrome around and inside it', () => {
    const article = pageArticleHtml(ENTRY_PAGE);
    expect(article).toContain('Sentence 0 about the harbour.');
    for (const chrome of [
      'Home',
      'track()',
      'Subscribe',
      'email',
      '© Quiet Cities',
      'color: red',
    ]) {
      expect(article).not.toContain(chrome);
    }
  });

  it('takes only the first article, not the related posts after it', () => {
    expect(
      pageArticleHtml(
        '<body><article><p>Main</p><article><p>Nested</p></article></article>' +
          '<section><article>Teaser A</article><article>Teaser B</article></section></body>',
      ),
    ).toBe('<p>Main</p><article><p>Nested</p></article>');
  });

  it('falls back to main, then body', () => {
    expect(pageArticleHtml('<body><main><p>In main</p></main><p>Out</p></body>')).toBe(
      '<p>In main</p>',
    );
    expect(pageArticleHtml('<html><head><title>T</title></head><body><p>B</p></body></html>')).toBe(
      '<p>B</p>',
    );
  });

  it('does not mistake <head> for <header>', () => {
    expect(pageArticleHtml('<head><title>T</title></head><body><p>B</p></body>')).toBe('<p>B</p>');
  });
});

describe('isDue / dueFeed', () => {
  const feed = {
    id: 'a',
    name: 'A',
    enabled: true,
    feed_url: 'https://a.example/feed.xml',
  };

  it('is due when never checked, or checked an hour ago or more', () => {
    expect(isDue(feed, NOW)).toBe(true);
    expect(isDue({ ...feed, feed_checked_at: '2026-11-09T11:00:00Z' }, NOW)).toBe(true);
    expect(isDue({ ...feed, feed_checked_at: '2026-11-09T11:30:00Z' }, NOW)).toBe(false);
  });

  it('is never due when paused or not a feed', () => {
    expect(isDue({ ...feed, enabled: false }, NOW)).toBe(false);
    expect(isDue({ id: 'b', name: 'B', enabled: true }, NOW)).toBe(false);
  });

  it('picks the never-checked feed first, then the oldest check, then the lower id', () => {
    const roster = [
      { ...feed, id: 'c', feed_checked_at: '2026-11-09T09:00:00Z' },
      { ...feed, id: 'b', feed_checked_at: '2026-11-09T08:00:00Z' },
      { ...feed, id: 'z' },
      { ...feed, id: 'y' },
      { id: 'sender', name: 'S', enabled: true },
    ];
    expect(dueFeed(roster, NOW)?.id).toBe('y');
    expect(dueFeed(roster.slice(0, 2), NOW)?.id).toBe('b');
    expect(dueFeed([{ ...feed, feed_checked_at: '2026-11-09T11:59:00Z' }], NOW)).toBeUndefined();
  });
});

describe('planFeedEntries', () => {
  it('takes only entries inside the seven-day horizon', () => {
    const plan = planFeedEntries(
      [dated('new', '2026-11-08T08:00:00Z'), dated('old', '2026-11-01T11:00:00Z')],
      new Set(),
      NOW,
      6,
    );
    expect(plan.take.map((item) => item.identity)).toStrictEqual(['new']);
    expect(plan.drained).toBe(true);
  });

  it('skips entries already posts, and an id repeated in one document', () => {
    const plan = planFeedEntries(
      [
        dated('a', '2026-11-08T00:00:00Z'),
        dated('b', '2026-11-07T00:00:00Z'),
        dated('a', '2026-11-06T00:00:00Z'),
      ],
      new Set(['b']),
      NOW,
      6,
    );
    expect(plan.take.map((item) => item.identity)).toStrictEqual(['a']);
  });

  it('takes the oldest first up to the slots, and says it did not drain', () => {
    const plan = planFeedEntries(
      [
        dated('newest', '2026-11-08T00:00:00Z'),
        dated('middle', '2026-11-07T00:00:00Z'),
        dated('oldest', '2026-11-06T00:00:00Z'),
      ],
      new Set(),
      NOW,
      2,
    );
    expect(plan.take.map((item) => item.identity)).toStrictEqual(['oldest', 'middle']);
    expect(plan.drained).toBe(false);
  });

  it(`considers only the first ${String(FEED_ENTRY_LIMIT)} entries of the document`, async () => {
    const feed = parseFeed(numberedFeed(25, NOW));
    const entries = await Promise.all(
      (feed?.entries ?? []).map(
        async (item): Promise<DatedEntry> => ({
          ...item,
          identity: await entryIdentity(item),
          date: entryDate(item, NOW),
        }),
      ),
    );
    const plan = planFeedEntries(entries, new Set(), NOW, 100);
    expect(plan.take).toHaveLength(FEED_ENTRY_LIMIT);
    expect(plan.take.map((item) => item.identity)).not.toContain('entry-20');
  });

  it('keeps undated entries in the horizon, at most twenty of them', async () => {
    const feed = parseFeed(UNDATED_FEED);
    const entries = await Promise.all(
      (feed?.entries ?? []).map(
        async (item): Promise<DatedEntry> => ({
          ...item,
          identity: await entryIdentity(item),
          date: entryDate(item, NOW),
        }),
      ),
    );
    const plan = planFeedEntries(entries, new Set(), NOW, 6);
    expect(plan.take.map((item) => item.date)).toStrictEqual([NOW, NOW]);
  });
});
