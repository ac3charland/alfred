/**
 * Feed fixtures for the feed leg: one per shape the parser has to read. TypeScript modules rather
 * than `.xml` files for the reason `../index.ts` gives — the Worker's tsconfig has no Node types
 * to read a file with. Every word in the synthetic ones is invented; `mlarson.ts` is the one real
 * capture.
 */
export { MLARSON_FEED } from './mlarson';

/** A long paragraph, so a body built from it is an article rather than an excerpt (250+ words). */
export const LONG_PARAGRAPH = Array.from(
  { length: 60 },
  (_, index) => `Sentence ${String(index)} about the harbour.`,
).join(' ');

/** RSS 2.0 with the full article in `content:encoded` and a teaser in `description`. */
export const RSS_FULL_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Harbour &amp; Tide</title>
    <link>https://harbour.example/</link>
    <dc:creator>Ines Calloway</dc:creator>
    <item>
      <title><![CDATA[The   Grain
        Ledger]]></title>
      <link>https://harbour.example/grain-ledger</link>
      <guid isPermaLink="false">harbour-42</guid>
      <pubDate>Sat, 07 Nov 2026 09:30:00 +0000</pubDate>
      <author>ines@harbour.example (Ines Calloway)</author>
      <description>A teaser.</description>
      <content:encoded><![CDATA[<p>${LONG_PARAGRAPH}</p><p>Read <a href="https://elsewhere.example/a">this</a>.</p>]]></content:encoded>
    </item>
    <item>
      <title>Older &#8217;tide&#8217; notes</title>
      <link>/tide-notes</link>
      <guid>https://harbour.example/tide-notes</guid>
      <pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>${LONG_PARAGRAPH}</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

/** RSS 2.0 whose only body is a short `description` ending in a "Read more" link. */
export const RSS_DESCRIPTION_ONLY_FEED = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Quiet Cities</title>
    <item>
      <title>Cities are getting quieter</title>
      <link>https://quiet.example/posts/cities</link>
      <guid>https://quiet.example/posts/cities</guid>
      <pubDate>Sun, 08 Nov 2026 07:00:00 +0000</pubDate>
      <description>&lt;p&gt;Noise maps show a decline.&lt;/p&gt;&lt;a href="https://quiet.example/posts/cities"&gt;Read more&lt;/a&gt;</description>
    </item>
  </channel>
</rss>`;

/** Atom whose entries carry only a `summary`, ending in an ellipsis. */
export const ATOM_SUMMARY_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Lantern Notes</title>
  <author><name>Odile Brand</name></author>
  <id>urn:uuid:lantern</id>
  <entry>
    <title type="html">On &lt;em&gt;lanterns&lt;/em&gt;</title>
    <link rel="alternate" type="text/html" href="https://lantern.example/on-lanterns"/>
    <link rel="replies" href="https://lantern.example/on-lanterns/comments"/>
    <id>tag:lantern.example,2026:on-lanterns</id>
    <published>2026-11-06T12:00:00Z</published>
    <updated>2026-11-08T12:00:00Z</updated>
    <summary>Lanterns were once the only light on the quay…</summary>
  </entry>
</feed>`;

/** RSS 1.0 / RDF: the items are siblings of the channel, dated with `dc:date`. */
export const RDF_FEED = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://almanac.example/">
    <title>The Almanac</title>
  </channel>
  <item rdf:about="https://almanac.example/frost">
    <title>First frost</title>
    <link>https://almanac.example/frost</link>
    <dc:date>2026-11-05T06:00:00Z</dc:date>
    <description>${LONG_PARAGRAPH}</description>
  </item>
</rdf:RDF>`;

/** An RSS feed whose entries carry no date, no guid and no usable link. */
export const UNDATED_FEED = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Undated</title>
    <item>
      <title>No date here</title>
      <link>javascript:alert(1)</link>
      <description>${LONG_PARAGRAPH}</description>
    </item>
    <item>
      <title>From the future</title>
      <pubDate>Fri, 01 Jan 2100 00:00:00 GMT</pubDate>
      <description>${LONG_PARAGRAPH}</description>
    </item>
  </channel>
</rss>`;

/** Not XML at all. */
export const MALFORMED_FEED = 'this is { not xml';

/** A blog's homepage — what an owner most likely pastes by mistake. */
export const HTML_PAGE = `<!DOCTYPE html>
<html>
  <head><title>A blog</title></head>
  <body><main><p>Welcome to the blog.</p></main></body>
</html>`;

/** An entry's own page: chrome around an `<article>`. */
export const ENTRY_PAGE = `<!DOCTYPE html>
<html>
  <head><title>Cities are getting quieter</title><style>p { color: red; }</style></head>
  <body>
    <header><nav><a href="/">Home</a></nav></header>
    <main>
      <article>
        <header><h1>Cities are getting quieter</h1></header>
        <p>${LONG_PARAGRAPH}</p>
        <script>track();</script>
        <aside>Subscribe to the newsletter</aside>
        <form><input name="email"></form>
      </article>
    </main>
    <footer>© Quiet Cities</footer>
  </body>
</html>`;

/** An RSS feed of `count` dated entries, newest first, one hour apart from `newest`. */
export function numberedFeed(count: number, newest: Date): string {
  const items = Array.from({ length: count }, (_, index) => {
    const date = new Date(newest.getTime() - index * 3_600_000).toUTCString();
    return `<item><title>Entry ${String(index)}</title><guid>entry-${String(index)}</guid>
      <link>https://numbered.example/${String(index)}</link><pubDate>${date}</pubDate>
      <description>${LONG_PARAGRAPH}</description></item>`;
  });
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Numbered</title>${items.join('')}</channel></rss>`;
}
