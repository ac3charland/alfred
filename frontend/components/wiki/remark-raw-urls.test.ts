import { remarkRawUrls } from './remark-raw-urls';

interface TestNode {
  type: string;
  url?: string;
  identifier?: string;
  data?: { hProperties?: Record<string, unknown> };
  children?: TestNode[];
}

function run(tree: TestNode): void {
  remarkRawUrls()(tree);
}

describe('remarkRawUrls — the raw URL, as the page wrote it, rides on data-href', () => {
  it.each([
    ['a non-ASCII stem', '../entities/café.md'],
    ['a bare percent', '100%-rule.md'],
    ['a space from an angle-bracket target', 'habit loop.md'],
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
