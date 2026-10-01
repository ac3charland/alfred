import { htmlToText } from '../comms/email-text';
import { extractPost } from './extract';
import { ESSAY_MESSAGE, ROUNDUP_MESSAGE } from './fixtures';
import { READER_MAX_LINK_CANDIDATES, numberLinks } from './links';

/** A fixture's decoded HTML, the way the tick stores it. */
function fixtureHtml(message: typeof ESSAY_MESSAGE): { html: string; canonical?: string } {
  const post = extractPost(message, { name: 'Test' });
  return {
    html: post.html ?? '',
    ...(post.canonical_url === undefined ? {} : { canonical: post.canonical_url }),
  };
}

describe('numberLinks — which anchors are offered', () => {
  it('excludes non-http(s) hrefs, relative hrefs and anchors with no visible text', () => {
    const { links } = numberLinks(
      '<a href="mailto:a@b.example">mail me</a>' +
        '<a href="/relative">relative</a>' +
        '<a href="javascript:void(0)">js</a>' +
        '<a href="https://a.example/empty"></a>' +
        '<a href="https://a.example/blank"> &nbsp; </a>' +
        '<a href="https://a.example/kept">kept</a>',
    );
    expect(links).toEqual([{ n: 1, url: 'https://a.example/kept' }]);
  });

  it('counts an anchor holding only an image as having no visible text', () => {
    const html = '<a href="https://a.example/img"><img src="x.png" alt="a chart"></a>';
    const { links, markedHtml } = numberLinks(html);
    expect(links).toEqual([]);
    expect(markedHtml).toBe(html);
  });

  it('decodes entities in the href and keeps the decoded URL', () => {
    const { links } = numberLinks('<a href="https://a.example/x?a=1&amp;b=2">two params</a>');
    expect(links).toEqual([{ n: 1, url: 'https://a.example/x?a=1&b=2' }]);
  });

  it('excludes the post’s own address, ignoring query and fragment', () => {
    const html =
      '<a href="https://open.substack.com/pub/x/p/slug?utm=1#top">read in app</a>' +
      '<a href="https://other.example/p/slug">elsewhere</a>';
    const { links } = numberLinks(html, 'https://open.substack.com/pub/x/p/slug');
    expect(links).toEqual([{ n: 1, url: 'https://other.example/p/slug' }]);
  });

  it('copes with an absent or unparseable canonical URL', () => {
    const html = '<a href="https://a.example/x">x</a>';
    expect(numberLinks(html).links).toHaveLength(1);
    expect(numberLinks(html, 'not a url').links).toHaveLength(1);
  });

  it('excludes substack.com bylines, app links and redirect/2 wrappers', () => {
    const { links } = numberLinks(
      '<a href="https://substack.com/@author">Author</a>' +
        '<a href="https://substack.com/app-link/post?x=1">app</a>' +
        '<a href="https://substack.com/redirect/2/abc">subscribe</a>',
    );
    expect(links).toEqual([]);
  });

  it('keeps a plain substack.com/redirect/<uuid> body wrapper, never unwrapped', () => {
    const url = 'https://substack.com/redirect/8f2c0b7e-4d19-4a2b-9c51-6f0ab2e77d41';
    expect(numberLinks(`<a href="${url}">a body link</a>`).links).toEqual([{ n: 1, url }]);
  });

  it('keeps an @-path on another host', () => {
    const { links } = numberLinks('<a href="https://medium.example/@someone">a profile</a>');
    expect(links).toHaveLength(1);
  });
});

describe('numberLinks — numbering and markers', () => {
  it('numbers from 1 in document order and shares a number across repeats of one URL', () => {
    const { links, markedHtml } = numberLinks(
      '<a href="https://a.example/1">one</a>' +
        '<a href="https://a.example/2">two</a>' +
        '<a href="https://a.example/1">one again</a>' +
        '<a href="https://a.example/3">three</a>',
    );
    expect(links.map((link) => link.n)).toEqual([1, 2, 3]);
    expect(links.map((link) => link.url)).toEqual([
      'https://a.example/1',
      'https://a.example/2',
      'https://a.example/3',
    ]);
    expect(markedHtml).toContain('one again [1]</a>');
    expect(markedHtml).toContain('three [3]</a>');
  });

  it('writes the marker just inside the closing tag and leaves other anchors untouched', () => {
    const skipped = '<a href="mailto:x@y.example">mail</a>';
    const { markedHtml } = numberLinks(
      `${skipped}<p>hi <a href="https://a.example/x" class="c">some <b>anchor</b> text</a>!</p>`,
    );
    expect(markedHtml).toBe(
      `${skipped}<p>hi <a href="https://a.example/x" class="c">some <b>anchor</b> text [1]</a>!</p>`,
    );
  });

  it('puts the marker into the stripped text', () => {
    const { markedHtml } = numberLinks(
      '<p><a href="https://a.example/1">first</a> and <a href="https://a.example/2">second</a> ' +
        'and <a href="https://a.example/3">some anchor text</a>.</p>',
    );
    expect(htmlToText(markedHtml)).toContain('some anchor text [3]');
  });

  it('caps at 150 distinct links: later anchors get no marker, repeats of numbered ones still do', () => {
    const anchors = Array.from(
      { length: 160 },
      (_, index) => `<a href="https://a.example/${String(index)}">link ${String(index)}</a>`,
    ).join('');
    const { links, markedHtml } = numberLinks(`${anchors}<a href="https://a.example/0">again</a>`);
    expect(READER_MAX_LINK_CANDIDATES).toBe(150);
    expect(links).toHaveLength(150);
    expect(links.at(-1)).toEqual({ n: 150, url: 'https://a.example/149' });
    expect(markedHtml).toContain('link 149 [150]</a>');
    expect(markedHtml).toContain('link 150</a>');
    expect(markedHtml).toContain('again [1]</a>');
  });

  it('returns the html unchanged when there is no anchor', () => {
    expect(numberLinks('<p>nothing here</p>')).toEqual({
      markedHtml: '<p>nothing here</p>',
      links: [],
    });
  });
});

describe('numberLinks — the committed fixtures', () => {
  it('numbers the essay’s two body links and none of its chrome', () => {
    const { html, canonical } = fixtureHtml(ESSAY_MESSAGE);
    const { links } = numberLinks(html, canonical);
    expect(links.map((link) => link.url)).toEqual([
      'https://substack.com/redirect/8f2c0b7e-4d19-4a2b-9c51-6f0ab2e77d41',
      'https://substack.com/redirect/1b6d40aa-2f77-4c0e-8f13-9a5e2c1d3b88',
      'https://substack.com/redirect/6c3e19d5-70b8-4a51-bb2f-52f0c8e9a4d7',
      'https://substack.com/redirect/9a7f22c1-05de-4b39-8c64-1d33ba70e5f2',
    ]);
  });

  it('numbers the roundup’s items, the repeat once, the sponsor and the own piece', () => {
    const { html, canonical } = fixtureHtml(ROUNDUP_MESSAGE);
    const { links, markedHtml } = numberLinks(html, canonical);
    expect(links.map((link) => link.url)).toEqual([
      'https://substack.com/redirect/3d7a91c2-6b04-4e58-a1f3-0c52de9b7e10',
      'https://substack.com/redirect/b82e4f10-93ac-4d6e-8c17-5a0e61f3d2b9',
      'https://substack.com/redirect/f4c06d3e-1a85-47b2-9e60-b7d3c8a15f24',
      'https://substack.com/redirect/0e9b5a77-c2d1-4f38-b64a-3187ad5c9e02',
      'https://substack.com/redirect/6a1d38f9-47b0-4c25-93e8-d2f70b4c1a66',
      'https://tideline.substack.com/p/the-quiet-berth',
      'https://substack.com/redirect/c71f20ab-85e3-4d96-b0c4-9e1a3f6d8b57',
      'https://substack.com/redirect/1fd84c06-2b9e-4a73-85d1-e60c97a3b2f8',
    ]);
    const text = htmlToText(markedHtml);
    expect(text).toContain('A tidal barrage costed honestly [2]');
    expect(text).toContain('the honest barrage costing [2]');
    expect(text).not.toContain('Subscribe here [');
    expect(text).not.toContain('Odelia Hart [');
  });
});
