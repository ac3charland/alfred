import { makeWikiPage, toWikiIndexRow } from '@/lib/wiki/fixtures';

import { bodyMatches, titleMatches } from './wiki-search';

function page(path: string, overrides: Parameters<typeof makeWikiPage>[1] = {}) {
  return toWikiIndexRow(makeWikiPage(path, overrides));
}

describe('titleMatches', () => {
  it('ranks a title prefix, then a title substring, then a summary or tag match', () => {
    const tag = page('wiki/concepts/a.md', { title: 'Alpha', tags: ['habit'] });
    const summary = page('wiki/concepts/b.md', { title: 'Beta', summary: 'On every habit' });
    const inside = page('wiki/concepts/c.md', { title: 'The habit loop' });
    const prefix = page('wiki/concepts/d.md', { title: 'Habit stacking' });
    const miss = page('wiki/concepts/e.md', { title: 'Forgetting curve' });

    expect(titleMatches([tag, summary, inside, prefix, miss], 'habit')).toEqual([
      prefix,
      inside,
      tag,
      summary,
    ]);
  });

  it('breaks a rank tie by most recently updated, an undated page last', () => {
    const older = page('wiki/concepts/a.md', { title: 'Habit a', updated: '2026-09-01' });
    const undated = page('wiki/concepts/b.md', { title: 'Habit b', updated: null });
    const newer = page('wiki/concepts/c.md', { title: 'Habit c', updated: '2026-10-01' });

    expect(titleMatches([older, undated, newer], 'habit')).toEqual([newer, older, undated]);
  });

  it('keeps the index order for a full tie', () => {
    const first = page('wiki/concepts/a.md', { title: 'Habit a' });
    const second = page('wiki/concepts/b.md', { title: 'Habit b' });
    expect(titleMatches([first, second], 'habit')).toEqual([first, second]);
  });

  it('matches nothing for a blank query', () => {
    expect(titleMatches([page('wiki/concepts/a.md')], '  ')).toEqual([]);
  });
});

describe('bodyMatches', () => {
  const brainRules = page('wiki/sources/brain-rules.md', { title: 'Brain Rules' });
  const curve = page('wiki/concepts/forgetting-curve.md', { title: 'Forgetting curve' });

  it('keeps the server order, pairing each page with its snippet', () => {
    const hits = [
      { path: brainRules.path, snippet: 'one', rank: 0.3 },
      { path: curve.path, snippet: 'two', rank: 0.2 },
    ];
    expect(bodyMatches(hits, [curve, brainRules], new Set())).toEqual([
      { page: brainRules, snippet: 'one' },
      { page: curve, snippet: 'two' },
    ]);
  });

  it('leaves out every page the title group already lists', () => {
    const hits = [
      { path: curve.path, snippet: 'two', rank: 0.5 },
      { path: brainRules.path, snippet: 'one', rank: 0.3 },
    ];
    expect(bodyMatches(hits, [curve, brainRules], new Set([curve.path]))).toEqual([
      { page: brainRules, snippet: 'one' },
    ]);
  });

  it('leaves out a hit for a page this tab does not hold, and a repeated hit', () => {
    const hits = [
      { path: 'wiki/concepts/newer.md', snippet: 'x', rank: 0.9 },
      { path: brainRules.path, snippet: 'one', rank: 0.3 },
      { path: brainRules.path, snippet: 'again', rank: 0.1 },
    ];
    expect(bodyMatches(hits, [brainRules], new Set())).toEqual([
      { page: brainRules, snippet: 'one' },
    ]);
  });
});
