import { remarkRawUrls } from './remark-raw-urls';

interface TestPosition {
  start: { offset?: number };
  end: { offset?: number };
}

interface TestNode {
  type: string;
  url?: string;
  position?: TestPosition;
  identifier?: string;
  data?: { hProperties?: Record<string, unknown> };
  children?: TestNode[];
}

function run(tree: TestNode, source?: string): void {
  remarkRawUrls()(tree, source === undefined ? undefined : { value: source });
}

/** A node spanning `[start, end)` of the source, as mdast positions it. */
function at(start: number, end: number): TestPosition {
  return { start: { offset: start }, end: { offset: end } };
}

describe('remarkRawUrls — the raw URL, as the page wrote it, rides on data-href', () => {
  it.each([
    ['a non-ASCII stem', '../entities/café.md'],
    ['a bare percent', '100%-rule.md'],
    ['a space', 'habit loop.md'],
    ['a literal percent sequence', 'habit%20loop.md'],
  ])('keeps %s unencoded on a link', (_label, url) => {
    const link: TestNode = { type: 'link', url, children: [] };
    run({ type: 'root', children: [{ type: 'paragraph', children: [link] }] });
    expect(link.data?.hProperties).toEqual({ 'data-href': url });
  });

  it('keeps an image source unencoded, and the node’s other properties', () => {
    const image: TestNode = {
      type: 'image',
      url: '../../raw/2026/é/fig.png',
      data: { hProperties: { className: 'kept' } },
    };
    run({ type: 'root', children: [image] });
    expect(image.data?.hProperties).toEqual({
      className: 'kept',
      'data-href': '../../raw/2026/é/fig.png',
    });
  });

  // The offsets are the ones mdast-util-from-markdown gives each source; the parser hands every one
  // of these links the url with its angle brackets stripped.
  describe('an angle-bracket destination, which the wiki reads literally', () => {
    it.each([
      ['[a](<habit-loop.md>)', 0, [1, 2], '<habit-loop.md>'],
      ['See [a](<habit-loop.md>) now.', 4, [5, 6], '<habit-loop.md>'],
      ['[b](<habit loop.md>)', 0, [1, 2], '<habit loop.md>'],
      ['[a](   <habit-loop.md> "t")', 0, [1, 2], '<habit-loop.md>'],
      ['[a [b] c](<habit-loop.md>)', 0, [1, 8], '<habit-loop.md>'],
    ] as const)('keeps the brackets of %j', (source, start, [textStart, textEnd], raw) => {
      const url = raw.slice(1, -1);
      const link: TestNode = {
        type: 'link',
        url,
        position: at(start, source.length),
        children: [{ type: 'text', position: at(textStart, textEnd) }],
      };
      run({ type: 'root', children: [link] }, source);
      expect(link.data?.hProperties).toEqual({ 'data-href': raw });
    });

    it('keeps the brackets of an empty-text link', () => {
      const link: TestNode = { type: 'link', url: 'x.md', position: at(0, 10), children: [] };
      run({ type: 'root', children: [link] }, '[](<x.md>)');
      expect(link.data?.hProperties).toEqual({ 'data-href': '<x.md>' });
    });

    it.each([
      ["[a](habit-loop.md 'T')", 'habit-loop.md'],
      ['[a](habit-loop.md "<b>")', 'habit-loop.md'],
      ['[a]( habit-loop.md )', 'habit-loop.md'],
    ])('leaves a plain destination as it is: %j', (source, url) => {
      const link: TestNode = {
        type: 'link',
        url,
        position: at(0, source.length),
        children: [{ type: 'text', position: at(1, 2) }],
      };
      run({ type: 'root', children: [link] }, source);
      expect(link.data?.hProperties).toEqual({ 'data-href': url });
    });

    it('leaves an image as it is — an image is never a page link', () => {
      const image: TestNode = { type: 'image', url: 'fig.png', position: at(0, 15) };
      run({ type: 'root', children: [image] }, '![i](<fig.png>)');
      expect(image.data?.hProperties).toEqual({ 'data-href': 'fig.png' });
    });
  });

  it('gives a reference-style link its definition’s URL', () => {
    const reference: TestNode = { type: 'linkReference', identifier: 'clear', children: [] };
    const image: TestNode = { type: 'imageReference', identifier: 'fig' };
    const orphan: TestNode = { type: 'linkReference', identifier: 'missing', children: [] };
    run({
      type: 'root',
      children: [
        { type: 'paragraph', children: [reference, image, orphan] },
        { type: 'definition', identifier: 'clear', url: '../entities/café.md' },
        { type: 'definition', identifier: 'fig', url: 'fig.png' },
      ],
    });
    expect(reference.data?.hProperties).toEqual({ 'data-href': '../entities/café.md' });
    expect(image.data?.hProperties).toEqual({ 'data-href': 'fig.png' });
    expect(orphan.data).toBeUndefined();
  });
});
