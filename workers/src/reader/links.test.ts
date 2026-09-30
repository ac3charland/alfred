import { htmlToText } from '../comms/email-text';
import { extractPost } from './extract';
import { ESSAY_MESSAGE, LINK_ROUNDUP_MESSAGE } from './fixtures';
import { READER_MAX_LINK_CANDIDATES, numberLinks } from './links';

/** The stored HTML of a committed fixture, as the tick hands it on. */
function fixtureHtml(message: typeof ESSAY_MESSAGE): { html: string; canonical: string } {
  const post = extractPost(message, { name: 'Fixture' });
  if (post.html === undefined || post.canonical_url === undefined) {
    throw new Error('the fixture should keep its HTML and a canonical URL');
  }
  return { html: post.html, canonical: post.canonical_url };
}

describe('numberLinks — which anchors are candidates', () => {
  it('keeps the essay’s body links and footer links, and drops the chrome and the post itself', () => {
    const { html, canonical } = fixtureHtml(ESSAY_MESSAGE);

    const { links } = numberLinks(html, canonical);

    expect(links).toEqual([
      { n: 1, url: 'https://substack.com/redirect/8f2c0b7e-4d19-4a2b-9c51-6f0ab2e77d41' },
      { n: 2, url: 'https://substack.com/redirect/1b6d40aa-2f77-4c0e-8f13-9a5e2c1d3b88' },
      { n: 3, url: 'https://substack.com/redirect/6c3e19d5-70b8-4a51-bb2f-52f0c8e9a4d7' },
      { n: 4, url: 'https://substack.com/redirect/9a7f22c1-05de-4b39-8c64-1d33ba70e5f2' },
    ]);
  });

  it('numbers a roundup’s items and sponsor, gives a repeated link its first number, and skips the byline, app link and redirect/2 wrappers', () => {
    const { html, canonical } = fixtureHtml(LINK_ROUNDUP_MESSAGE);

    const { links } = numberLinks(html, canonical);
    const urls = links.map((link) => link.url);

    expect(links.map((link) => link.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(urls[0]).toBe('https://substack.com/redirect/3d1f6a52-8b0e-4c7a-9e21-0a4f5c6d7e81');
    // The sponsor is a candidate: telling it from an item is the model's job, not the filter's.
    expect(urls[2]).toBe('https://substack.com/redirect/c4b8e2f0-1a6d-4e97-b3c5-8d2f0a9e7c16');
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.some((url) => url.includes('/@'))).toBe(false);
    expect(urls.some((url) => url.includes('/app-link/'))).toBe(false);
    expect(urls.some((url) => url.includes('/redirect/2/'))).toBe(false);
    expect(urls.some((url) => url.includes('open.substack.com'))).toBe(false);
  });

  it('refuses non-http(s) schemes, relative hrefs and anchors with no visible text', () => {
    const html =
      '<a href="mailto:tips@example.com">Send a tip</a>' +
      '<a href="javascript:void(0)">Click</a>' +
      '<a href="/p/relative">Relative</a>' +
      '<a href="https://example.com/img"><img src="x.png" alt="An image"></a>' +
      '<a href="https://example.com/blank">   </a>' +
      '<a href="https://example.com/kept">Kept</a>';

    expect(numberLinks(html).links).toEqual([{ n: 1, url: 'https://example.com/kept' }]);
  });

  it('drops the canonical URL on origin and path, whatever its query or fragment', () => {
    const html =
      '<a href="https://example.com/p/this-post?utm_source=email#top">This post</a>' +
      '<a href="https://example.com/p/other-post">Another post</a>';

    const { links } = numberLinks(html, 'https://example.com/p/this-post');

    expect(links).toEqual([{ n: 1, url: 'https://example.com/p/other-post' }]);
  });

  it('keeps every link when there is no canonical URL to compare against', () => {
    expect(numberLinks('<a href="https://example.com/p/a">A</a>').links).toHaveLength(1);
  });

  it(`caps the list at ${String(READER_MAX_LINK_CANDIDATES)} numbers, in document order`, () => {
    const html = Array.from(
      { length: READER_MAX_LINK_CANDIDATES + 5 },
      (_, index) => `<a href="https://example.com/${String(index)}">Item ${String(index)}</a>`,
    ).join(' ');

    const { links, markedHtml } = numberLinks(html);

    expect(links).toHaveLength(READER_MAX_LINK_CANDIDATES);
    expect(links.at(-1)).toEqual({
      n: READER_MAX_LINK_CANDIDATES,
      url: `https://example.com/${String(READER_MAX_LINK_CANDIDATES - 1)}`,
    });
    // The anchors past the cap are left exactly as they were: no marker the list cannot resolve.
    expect(htmlToText(markedHtml)).toContain(`Item ${String(READER_MAX_LINK_CANDIDATES)} Item`);
  });
});

describe('numberLinks — the markers in the text', () => {
  it('follows each kept anchor’s text with [n], and a repeat with the number it already has', () => {
    const { html, canonical } = fixtureHtml(LINK_ROUNDUP_MESSAGE);

    const text = htmlToText(numberLinks(html, canonical).markedHtml);

    expect(text).toContain('The sim-to-real gap in dexterous manipulation [1]');
    expect(text).toContain('the sim-to-real paper [1]');
    expect(text).toContain('FoldBench v2 release notes [4]');
  });

  it('leaves the chrome it dropped unmarked', () => {
    const { html, canonical } = fixtureHtml(LINK_ROUNDUP_MESSAGE);

    const text = htmlToText(numberLinks(html, canonical).markedHtml);

    expect(text).toContain('Tove Hallam');
    expect(text).not.toMatch(/Tove Hallam \[\d+]/);
    expect(text).not.toMatch(/READ IN APP \[\d+]/);
    expect(text).not.toMatch(/Subscribe here \[\d+]/);
  });

  it('changes nothing but the markers', () => {
    const { html, canonical } = fixtureHtml(ESSAY_MESSAGE);

    const marked = htmlToText(numberLinks(html, canonical).markedHtml);

    expect(marked.replaceAll(/ \[\d+]/g, '')).toBe(htmlToText(html));
  });
});
