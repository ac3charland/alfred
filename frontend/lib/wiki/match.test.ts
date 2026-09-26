import { makeWikiPage, toWikiIndexRow } from '@/lib/wiki/fixtures';

import { rankWikiPage } from './match';

const PAGE = toWikiIndexRow(
  makeWikiPage('wiki/concepts/habit-stacking.md', {
    title: 'Habit stacking',
    summary: 'Anchoring a new behaviour to an existing routine rather than a clock time.',
    tags: ['habits', 'Behaviour-design'],
  }),
);

describe('rankWikiPage', () => {
  it('ranks a title prefix 0, a title substring 1, a summary or tag match 2', () => {
    expect(rankWikiPage('hab', PAGE)).toBe(0);
    expect(rankWikiPage('stack', PAGE)).toBe(1);
    expect(rankWikiPage('clock time', PAGE)).toBe(2);
    expect(rankWikiPage('design', PAGE)).toBe(2);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(rankWikiPage('  HABIT ', PAGE)).toBe(0);
    expect(rankWikiPage('BEHAVIOUR', PAGE)).toBe(2);
  });

  it('is null for no match and for an empty query', () => {
    expect(rankWikiPage('zettelkasten', PAGE)).toBeNull();
    expect(rankWikiPage('', PAGE)).toBeNull();
    expect(rankWikiPage(' '.repeat(3), PAGE)).toBeNull();
  });

  it('prefers the title over the summary when both match', () => {
    const both = { ...PAGE, summary: 'habit talk' };
    expect(rankWikiPage('habit', both)).toBe(0);
  });
});
