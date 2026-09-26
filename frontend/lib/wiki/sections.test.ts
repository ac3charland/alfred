import { makeWikiPage, toWikiIndexRow } from '@/lib/wiki/fixtures';

import {
  WIKI_PAGE_PATH,
  WIKI_SECTIONS,
  isWikiSection,
  sortWikiPages,
  splitWikiPath,
  wikiPageHref,
  wikiPagePath,
} from './sections';

describe('sections', () => {
  it("lists the wiki's four folders in its own order", () => {
    expect(WIKI_SECTIONS).toEqual(['concepts', 'entities', 'sources', 'questions']);
    expect(isWikiSection('concepts')).toBe(true);
    expect(isWikiSection('raw')).toBe(false);
  });

  it.each([
    ['wiki/concepts/habit-stacking.md', { section: 'concepts', name: 'habit-stacking' }],
    ['wiki/questions/why.md', { section: 'questions', name: 'why' }],
    ['wiki/raw/x.md', undefined],
    ['wiki/concepts/x', undefined],
    ['wiki/concepts/a/b.md', undefined],
    ['raw/2026/x/source.md', undefined],
  ])('splits %j into %j', (path, expected) => {
    expect(splitWikiPath(path)).toEqual(expected);
    expect(WIKI_PAGE_PATH.test(path)).toBe(expected !== undefined);
  });

  it('round-trips a path through its href', () => {
    expect(wikiPagePath('entities', 'james-clear')).toBe('wiki/entities/james-clear.md');
    expect(wikiPageHref('wiki/entities/james-clear.md')).toBe('/wiki/entities/james-clear');
    expect(wikiPageHref('not/a/page')).toBe('/wiki');
  });
});

describe('sortWikiPages', () => {
  it('orders section by section, then lower-cased title in code-unit order, then path', () => {
    const pages = [
      makeWikiPage('wiki/questions/q.md', { title: 'A question' }),
      makeWikiPage('wiki/concepts/b.md', { title: 'beta' }),
      makeWikiPage('wiki/concepts/a2.md', { title: 'Alpha' }),
      makeWikiPage('wiki/concepts/a1.md', { title: 'alpha' }),
      makeWikiPage('wiki/sources/s.md', { title: 'Source' }),
      makeWikiPage('wiki/entities/e.md', { title: 'Entity' }),
      makeWikiPage('wiki/concepts/z.md', { title: 'Zebra' }),
    ].map((page) => toWikiIndexRow(page));

    expect(sortWikiPages(pages).map((page) => page.path)).toEqual([
      'wiki/concepts/a1.md',
      'wiki/concepts/a2.md',
      'wiki/concepts/b.md',
      'wiki/concepts/z.md',
      'wiki/entities/e.md',
      'wiki/sources/s.md',
      'wiki/questions/q.md',
    ]);
    // A copy, never a sort in place.
    expect(pages[0]?.path).toBe('wiki/questions/q.md');
  });
});
