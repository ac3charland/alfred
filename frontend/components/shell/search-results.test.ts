import { buildResults, flattenResults } from '@/components/shell/search-results';
import type { CodeStory, Folder, Item, WikiPageIndexRow } from '@/lib/types';
import { makeWikiPage, toWikiIndexRow } from '@/lib/wiki/fixtures';

/** Fixed residency stamp for a seeded FILED item — fixtures pin the clock, never read it. */
const DISPATCHED_AT = '2025-01-02T00:00:00Z';

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    title: 'A task',
    notes: null,
    status: 'active',
    item_type: 'task',
    folder_id: null,
    // A fixture with a folder is a filed item, so it defaults to dispatched. `...overrides`
    // lands last, so a fixture can still state `dispatched_at: null` for a foldered Inbox item.
    dispatched_at: overrides.folder_id == null ? null : DISPATCHED_AT,
    parent_id: null,
    due_date: null,
    recurrence: null,
    recurrence_series_id: null,
    intended_project_id: null,
    occurrence_index: null,
    sort_order: 0,
    source_url: null,
    completed_at: null,
    created_at: '2025-01-01T00:00:00Z',
    user_id: 'u1',
    raw_capture: null,
    ...overrides,
  } as Item;
}

function makeStory(overrides: Partial<CodeStory> = {}): CodeStory {
  return {
    item_id: 's1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 31,
    ref: 'ALF-31',
    factory_state: 'ready_for_dev',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    blocked_from: null,
    requires_refinement: true,
    code_created_at: '2025-01-01T00:00:00Z',
    code_updated_at: '2025-01-01T00:00:00Z',
    title: 'Communication firewall triage',
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: 'ALF',
    project_name: 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: 'Firewall',
    epic_ref: 'ALF-1',
    epic_archived_at: null,
    epic_spec_path: null,
    priority: 1,
    ...overrides,
  };
}

describe('buildResults', () => {
  it('returns nothing for an empty / whitespace query', () => {
    const results = buildResults(' '.repeat(3), [makeItem()], [makeStory()]);
    expect(results.tasks).toHaveLength(0);
    expect(results.stories).toHaveLength(0);
  });

  it('matches tasks on title and notes (case-insensitively)', () => {
    const byTitle = makeItem({ id: 'a', title: 'Buy Firewall' });
    const byNotes = makeItem({ id: 'b', title: 'Unrelated', notes: 'mentions firewall here' });
    const miss = makeItem({ id: 'c', title: 'nope', notes: 'nothing' });
    const results = buildResults('firewall', [byTitle, byNotes, miss], []);
    const ids = results.tasks.map((result) => result.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).not.toContain('c');
  });

  it('matches a story by its ref so ALF-31 finds it directly', () => {
    const results = buildResults('alf-31', [], [makeStory()]);
    expect(results.stories).toHaveLength(1);
    expect(results.stories[0]?.kind === 'story' && results.stories[0].ref).toBe('ALF-31');
  });

  it('ranks title-prefix > title-substring > notes-only', () => {
    const prefix = makeItem({ id: 'prefix', title: 'fire alarm' });
    const substring = makeItem({ id: 'substring', title: 'a fire alarm' });
    const notes = makeItem({ id: 'notes', title: 'zzz', notes: 'fire' });
    const results = buildResults('fire', [notes, substring, prefix], []);
    expect(results.tasks.map((result) => result.id)).toEqual(['prefix', 'substring', 'notes']);
  });

  it('floats an exact ref match to the top of the stories group', () => {
    const exact = makeStory({ item_id: 'exact', ref: 'ALF-31', title: 'zzz last by title' });
    const titleMatch = makeStory({ item_id: 'title', ref: 'ALF-99', title: 'ALF-31 in the title' });
    const results = buildResults('alf-31', [], [titleMatch, exact]);
    expect(results.stories[0]?.id).toBe('exact');
  });

  it('caps each group at 8 and reports the truncated count', () => {
    const tasks = Array.from({ length: 11 }, (_, index) =>
      makeItem({ id: `t${String(index)}`, title: `firewall ${String(index)}` }),
    );
    const results = buildResults('firewall', tasks, []);
    expect(results.tasks).toHaveLength(8);
    expect(results.truncated.tasks).toBe(3);
  });

  it('flags completed tasks and terminal stories as de-emphasized when included', () => {
    const done = makeItem({ id: 'done', title: 'firewall done', status: 'completed' });
    const abandoned = makeStory({
      item_id: 'ab',
      title: 'firewall abandoned',
      factory_state: 'abandoned',
    });
    const results = buildResults('firewall', [done], [abandoned], [], true);
    expect(results.tasks[0]?.completed).toBe(true);
    expect(results.stories[0]?.completed).toBe(true);
  });

  it('hides completed tasks and terminal stories by default', () => {
    const active = makeItem({ id: 'active', title: 'firewall active' });
    const done = makeItem({ id: 'done', title: 'firewall done', status: 'completed' });
    const ready = makeStory({ item_id: 'ready', title: 'firewall ready' });
    const abandoned = makeStory({
      item_id: 'ab',
      title: 'firewall abandoned',
      factory_state: 'abandoned',
    });
    const doneStory = makeStory({ item_id: 'ds', title: 'firewall done', factory_state: 'done' });
    const results = buildResults('firewall', [active, done], [ready, abandoned, doneStory]);
    expect(results.tasks.map((result) => result.id)).toEqual(['active']);
    expect(results.stories.map((result) => result.id)).toEqual(['ready']);
  });

  it('includes completed tasks and terminal stories when includeCompleted is set', () => {
    const active = makeItem({ id: 'active', title: 'firewall active' });
    const done = makeItem({ id: 'done', title: 'firewall done', status: 'completed' });
    const abandoned = makeStory({
      item_id: 'ab',
      title: 'firewall abandoned',
      factory_state: 'abandoned',
    });
    const results = buildResults('firewall', [active, done], [abandoned], [], true);
    expect(results.tasks.map((result) => result.id)).toEqual(['active', 'done']);
    expect(results.stories.map((result) => result.id)).toEqual(['ab']);
  });

  it('does not count a hidden completed match toward the truncated total', () => {
    const active = Array.from({ length: 8 }, (_, index) =>
      makeItem({ id: `a${String(index)}`, title: `firewall ${String(index)}` }),
    );
    const done = makeItem({ id: 'done', title: 'firewall done', status: 'completed' });
    const results = buildResults('firewall', [...active, done], []);
    expect(results.tasks).toHaveLength(8);
    expect(results.truncated.tasks).toBe(0);
  });
});

describe('flattenResults', () => {
  it('concatenates tasks, then stories, then wiki, in order', () => {
    const results = buildResults(
      'firewall',
      [makeItem({ title: 'firewall task' })],
      [makeStory({ title: 'firewall story' })],
      [],
      false,
      [toWikiIndexRow(makeWikiPage('wiki/concepts/firewall.md', { title: 'Firewall' }))],
    );
    const flat = flattenResults(results);
    expect(flat.map((result) => result.kind)).toEqual(['task', 'story', 'wiki']);
  });
});

function wikiIndexPage(path: string, overrides: Partial<WikiPageIndexRow> = {}): WikiPageIndexRow {
  return toWikiIndexRow(makeWikiPage(path, overrides));
}

describe('wiki results', () => {
  it('matches on title, summary, and tags via rankWikiPage, ranked ahead of a summary/tag hit', () => {
    const titlePrefix = wikiIndexPage('wiki/concepts/habit-stacking.md', {
      title: 'Habit stacking',
    });
    const summaryOnly = wikiIndexPage('wiki/concepts/other.md', {
      title: 'Unrelated',
      summary: 'mentions habit here',
    });
    const tagOnly = wikiIndexPage('wiki/concepts/tagged.md', {
      title: 'Unrelated too',
      summary: 'nothing here',
      tags: ['habit'],
    });
    const miss = wikiIndexPage('wiki/concepts/miss.md', { title: 'nope', summary: 'nothing' });
    const results = buildResults('habit', [], [], [], false, [
      summaryOnly,
      titlePrefix,
      tagOnly,
      miss,
    ]);
    expect(results.wiki.map((result) => result.id)).toEqual([
      titlePrefix.path,
      summaryOnly.path,
      tagOnly.path,
    ]);
  });

  it('does not match on body text — the index row carries no body field to search', () => {
    const bodyOnly = makeWikiPage('wiki/concepts/body-only.md', {
      title: 'Unrelated title',
      summary: 'unrelated summary',
      tags: [],
      body: 'mentions habit deep in the body text',
    });
    const results = buildResults('habit', [], [], [], false, [toWikiIndexRow(bodyOnly)]);
    expect(results.wiki).toHaveLength(0);
  });

  it('ranks a title-prefix match ahead of an older-but-otherwise-newer summary/tag match', () => {
    // Rank must win over recency: a plain updated-first tie-break would put the newer,
    // worse-ranked summary hit ahead of the older, better-ranked title match.
    const prefix = wikiIndexPage('wiki/concepts/habit-stacking.md', {
      title: 'Habit stacking',
      updated: '2026-01-01',
    });
    const summaryHit = wikiIndexPage('wiki/concepts/other.md', {
      title: 'Unrelated',
      summary: 'mentions habit here',
      updated: '2026-09-01',
    });
    const results = buildResults('habit', [], [], [], false, [summaryHit, prefix]);
    expect(results.wiki.map((result) => result.id)).toEqual([prefix.path, summaryHit.path]);
  });

  it('breaks a rank tie by `updated` descending, with a never-updated page last', () => {
    const older = wikiIndexPage('wiki/concepts/a.md', { title: 'Habit a', updated: '2026-01-01' });
    const newer = wikiIndexPage('wiki/concepts/b.md', { title: 'Habit b', updated: '2026-06-01' });
    const never = wikiIndexPage('wiki/concepts/c.md', { title: 'Habit c', updated: null });
    const results = buildResults('habit', [], [], [], false, [older, never, newer]);
    expect(results.wiki.map((result) => result.id)).toEqual([newer.path, older.path, never.path]);
  });

  it('caps wiki matches at 8 and reports the truncated count', () => {
    const pages = Array.from({ length: 11 }, (_, index) =>
      wikiIndexPage(`wiki/concepts/habit-${String(index)}.md`, { title: `Habit ${String(index)}` }),
    );
    const results = buildResults('habit', [], [], [], false, pages);
    expect(results.wiki).toHaveLength(8);
    expect(results.truncated.wiki).toBe(3);
  });

  it('maps a page to a SearchResult with the wiki href, summary subtitle, and never completed', () => {
    const habit = wikiIndexPage('wiki/concepts/habit-stacking.md', {
      title: 'Habit stacking',
      summary: 'Anchoring a habit.',
    });
    const results = buildResults('habit', [], [], [], false, [habit]);
    expect(results.wiki[0]).toMatchObject({
      kind: 'wiki',
      id: 'wiki/concepts/habit-stacking.md',
      title: 'Habit stacking',
      subtitle: 'Anchoring a habit.',
      href: '/wiki/concepts/habit-stacking',
      completed: false,
    });
  });

  it('is unaffected by includeCompleted, which only governs tasks and stories', () => {
    const habit = wikiIndexPage('wiki/concepts/habit-stacking.md', { title: 'Habit stacking' });
    const results = buildResults('habit', [], [], [], true, [habit]);
    expect(results.wiki).toHaveLength(1);
  });
});

describe('subtitles', () => {
  it('uses the folder name when available', () => {
    const folders: Folder[] = [{ id: 'f1', name: 'Software' } as Folder];
    const item = makeItem({ title: 'firewall', folder_id: 'f1' });
    const results = buildResults('firewall', [item], [], folders);
    expect(results.tasks[0]?.subtitle).toBe('Software');
  });

  it('says Inbox for an undispatched task, even one carrying a folder', () => {
    // The subtitle names the view the result jumps to, and that view is the Inbox until a human
    // dispatches the item — otherwise the label would send the user to a folder it isn't in.
    const folders: Folder[] = [{ id: 'f1', name: 'Software' } as Folder];
    const item = makeItem({ title: 'firewall', folder_id: 'f1', dispatched_at: null });
    const results = buildResults('firewall', [item], [], folders);
    expect(results.tasks[0]?.subtitle).toBe('Inbox');
  });

  it('shows a story epic and state', () => {
    const results = buildResults('firewall', [], [makeStory({ title: 'firewall' })]);
    expect(results.stories[0]?.subtitle).toBe('Firewall · Ready for Dev');
  });
});
