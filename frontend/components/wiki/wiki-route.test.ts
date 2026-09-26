import { parseWikiRoute } from './wiki-route';

const INDEX = new Set([
  'wiki/concepts/habit-stacking.md',
  'wiki/concepts/habit loop.md',
  'wiki/entities/habit%20loop.md',
]);

describe('parseWikiRoute', () => {
  it.each(['/wiki', '/wiki/'])('reads %s as the index', (pathname) => {
    expect(parseWikiRoute(pathname, INDEX)).toEqual({ kind: 'index' });
  });

  it('reads a section', () => {
    expect(parseWikiRoute('/wiki/concepts', INDEX)).toEqual({
      kind: 'section',
      section: 'concepts',
    });
  });

  it('reads a page in the snapshot', () => {
    expect(parseWikiRoute('/wiki/concepts/habit-stacking', INDEX)).toEqual({
      kind: 'page',
      path: 'wiki/concepts/habit-stacking.md',
    });
  });

  it('decodes a percent-encoded stem', () => {
    expect(parseWikiRoute('/wiki/concepts/habit%20loop', INDEX)).toEqual({
      kind: 'page',
      path: 'wiki/concepts/habit loop.md',
    });
  });

  it('keeps a stem literally named with a percent sequence', () => {
    expect(parseWikiRoute('/wiki/entities/habit%20loop', INDEX)).toEqual({
      kind: 'page',
      path: 'wiki/entities/habit%20loop.md',
    });
  });

  it.each([
    '/wiki/elsewhere',
    '/wiki/raw/habit-stacking',
    '/wiki/concepts/not-yet',
    '/wiki/concepts/habit-stacking/extra',
    '/wiki/concepts/%E0%A4%A',
    '/reader',
  ])('reads %s as not found', (pathname) => {
    expect(parseWikiRoute(pathname, INDEX)).toEqual({ kind: 'not-found' });
  });
});
