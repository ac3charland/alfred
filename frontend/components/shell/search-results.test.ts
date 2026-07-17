import { buildResults, flattenResults } from '@/components/shell/search-results';
import type { CodeStory, Folder, Item } from '@/lib/types';

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    title: 'A task',
    notes: null,
    status: 'active',
    item_type: 'task',
    folder_id: null,
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

  it('flags completed tasks and terminal stories as de-emphasized', () => {
    const done = makeItem({ id: 'done', title: 'firewall done', status: 'completed' });
    const abandoned = makeStory({
      item_id: 'ab',
      title: 'firewall abandoned',
      factory_state: 'abandoned',
    });
    const results = buildResults('firewall', [done], [abandoned]);
    expect(results.tasks[0]?.completed).toBe(true);
    expect(results.stories[0]?.completed).toBe(true);
  });
});

describe('flattenResults', () => {
  it('concatenates tasks then stories in order', () => {
    const results = buildResults(
      'firewall',
      [makeItem({ title: 'firewall task' })],
      [makeStory({ title: 'firewall story' })],
    );
    const flat = flattenResults(results);
    expect(flat.map((result) => result.kind)).toEqual(['task', 'story']);
  });
});

describe('subtitles', () => {
  it('uses the folder name when available', () => {
    const folders: Folder[] = [{ id: 'f1', name: 'Software' } as Folder];
    const item = makeItem({ title: 'firewall', folder_id: 'f1' });
    const results = buildResults('firewall', [item], [], folders);
    expect(results.tasks[0]?.subtitle).toBe('Software');
  });

  it('shows a story epic and state', () => {
    const results = buildResults('firewall', [], [makeStory({ title: 'firewall' })]);
    expect(results.stories[0]?.subtitle).toBe('Firewall · Ready for Dev');
  });
});
