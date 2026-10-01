import { htmlToText } from '../comms/email-text';
import { extractPost } from './extract';
import { ESSAY_MESSAGE, LINK_ROUNDUP_MESSAGE } from './fixtures';
import { READER_MAX_LINK_CANDIDATES, numberLinks } from './links';

/** A fixture's stored HTML and canonical URL, exactly as intake keeps them. */
function stored(message: typeof ESSAY_MESSAGE): { html: string; canonical: string | undefined } {
  const post = extractPost(message, { name: 'Fixture' });
  if (post.html === undefined) throw new Error('fixture kept no HTML');
  return { html: post.html, canonical: post.canonical_url };
}

/** Text with every run of whitespace removed. */
function bare(text: string): string {
  return text.replaceAll(/\s+/g, '');
}

const ROUNDUP_ITEM = 'https://substack.com/redirect/3f1e0c2a-6b7d-4e58-9a14-2c8d5e7f9b01';

describe('numberLinks — which anchors are candidates', () => {
  it('keeps the roundup’s body links and sponsor, in document order, and drops the chrome', () => {
    const { html, canonical } = stored(LINK_ROUNDUP_MESSAGE);

    expect(numberLinks(html, canonical).links).toEqual([
      { n: 1, url: ROUNDUP_ITEM },
      { n: 2, url: 'https://substack.com/redirect/7a2b9d4e-1c3f-4a6b-8d05-e9f2c1b4a736' },
      { n: 3, url: 'https://substack.com/redirect/c5d8e1f3-2a4b-4c7d-9e60-1b3a5c7d9e2f' },
      { n: 4, url: 'https://substack.com/redirect/e9b4c2a1-8d6f-4b3e-a705-4f1d2c8e6b93' },
      { n: 5, url: 'https://substack.com/redirect/1d7f3b5c-9e2a-4d8b-b316-7c4e2a9f1d58' },
      // The sponsor stays a candidate: telling an ad from a source is the model's judgment.
      { n: 6, url: 'https://substack.com/redirect/88a1b2c3-d4e5-4f60-8a71-b2c3d4e5f607' },
    ]);
  });

  it('keeps the essay’s two body links and its footer wrappers, and nothing of the chrome', () => {
    const { html, canonical } = stored(ESSAY_MESSAGE);
    const urls = numberLinks(html, canonical).links.map((link) => link.url);

    expect(urls).toEqual([
      'https://substack.com/redirect/8f2c0b7e-4d19-4a2b-9c51-6f0ab2e77d41',
      'https://substack.com/redirect/1b6d40aa-2f77-4c0e-8f13-9a5e2c1d3b88',
      'https://substack.com/redirect/6c3e19d5-70b8-4a51-bb2f-52f0c8e9a4d7',
      'https://substack.com/redirect/9a7f22c1-05de-4b39-8c64-1d33ba70e5f2',
    ]);
  });

  it.each([
    ['a mailto link', '<a href="mailto:a@example.com">write to me</a>'],
    ['a javascript link', '<a href="javascript:alert(1)">click</a>'],
    ['a relative link', '<a href="/p/elsewhere">elsewhere</a>'],
    ['an image-only link', '<a href="https://example.com/a"><img src="x.png" alt="chart"></a>'],
    ['a link of whitespace', '<a href="https://example.com/a">  &nbsp; </a>'],
    ['a byline', '<a href="https://substack.com/@someone">Someone</a>'],
    ['an app link', '<a href="https://substack.com/app-link/post?id=1">Open in the app</a>'],
    ['a chrome wrapper', '<a href="https://substack.com/redirect/2/eyJlIjoiaHR0cHMifQ">Share</a>'],
  ])('drops %s', (_name, anchor) => {
    expect(numberLinks(`<p>${anchor}</p>`).links).toEqual([]);
  });

  it('keeps an ordinary http link and a body redirect wrapper', () => {
    const html =
      '<a href="https://example.com/essay">an essay</a>' +
      '<a href="https://substack.com/redirect/5cfcf664-1dd0-4804-b02c-b610a0e9df6a">a source</a>';

    expect(numberLinks(html).links).toEqual([
      { n: 1, url: 'https://example.com/essay' },
      { n: 2, url: 'https://substack.com/redirect/5cfcf664-1dd0-4804-b02c-b610a0e9df6a' },
    ]);
  });

  it('drops the post’s own address, compared on origin and path whatever the query', () => {
    const html =
      '<a href="https://open.substack.com/pub/x/p/post?utm_source=email">READ IN APP</a>' +
      '<a href="https://open.substack.com/pub/x/p/other">another post</a>';

    expect(numberLinks(html, 'https://open.substack.com/pub/x/p/post').links).toEqual([
      { n: 1, url: 'https://open.substack.com/pub/x/p/other' },
    ]);
  });

  it('gives a repeated URL the number it first had', () => {
    const { html, canonical } = stored(LINK_ROUNDUP_MESSAGE);
    const { links, markedHtml } = numberLinks(html, canonical);

    expect(links.filter((link) => link.url === ROUNDUP_ITEM)).toHaveLength(1);
    expect(htmlToText(markedHtml)).toContain('the gap paper [1].');
  });

  it(`stops numbering at ${String(READER_MAX_LINK_CANDIDATES)} distinct URLs, in document order`, () => {
    const anchors = Array.from(
      { length: READER_MAX_LINK_CANDIDATES + 5 },
      (_, index) => `<a href="https://example.com/${String(index)}">item ${String(index)}</a>`,
    );
    const { links, markedHtml } = numberLinks(anchors.join(' '));

    expect(links).toHaveLength(READER_MAX_LINK_CANDIDATES);
    expect(links.at(-1)).toEqual({
      n: READER_MAX_LINK_CANDIDATES,
      url: `https://example.com/${String(READER_MAX_LINK_CANDIDATES - 1)}`,
    });
    const text = htmlToText(markedHtml);
    expect(text).toContain(`item 149 [150]`);
    expect(text).not.toContain('[151]');
    expect(text).toContain('item 150 item 151');
  });
});

describe('numberLinks — the markers in the text', () => {
  it('follows each kept anchor’s text with its number, and leaves dropped anchors unmarked', () => {
    const { html, canonical } = stored(LINK_ROUNDUP_MESSAGE);
    const text = htmlToText(numberLinks(html, canonical).markedHtml);

    expect(text).toContain('The sim-to-real gap in dexterous manipulation [1]');
    expect(text).toContain('A sceptic’s reply to “scale the simulator” [5]');
    expect(text).toContain('Gridline, the GPU cloud for evals [6]');
    expect(text).toContain('Jonas Kettle ·');
    expect(text).not.toContain('Jonas Kettle [');
    expect(text).not.toContain('READ IN APP [');
    expect(text).not.toContain('unsubscribe [');
  });

  it('changes nothing but the markers: stripping them gives the stored text back', () => {
    const { html, canonical } = stored(LINK_ROUNDUP_MESSAGE);
    const marked = htmlToText(numberLinks(html, canonical).markedHtml);
    // Whitespace aside: a marker sits where a closing tag's space used to.

    expect(bare(marked.replaceAll(/ \[\d+]/g, ''))).toBe(bare(htmlToText(html)));
  });

  it('returns HTML with no candidates unchanged', () => {
    const html = '<p>No links here, only <a href="mailto:a@example.com">mail</a>.</p>';

    expect(numberLinks(html)).toEqual({ markedHtml: html, links: [] });
  });
});
