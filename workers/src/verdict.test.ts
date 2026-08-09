import {
  type ClosedWorld,
  type SweepItem,
  type Verdict,
  mergeIntoItem,
  parseVerdict,
  validateVerdict,
} from './verdict';

/** Two projects, each with one epic, so a project/epic mismatch can be expressed. */
function buildWorld(): ClosedWorld {
  return {
    folders: [
      { id: 'folder-work', name: 'Work', description: undefined },
      { id: 'folder-home', name: 'Home', description: undefined },
    ],
    projects: [
      { id: 'project-alf', key: 'ALF', name: 'alfred', description: undefined },
      { id: 'project-oth', key: 'OTH', name: 'other', description: undefined },
    ],
    epics: [
      { id: 'epic-alf', ref: 'ALF-1', name: 'Alfred epic', project_id: 'project-alf' },
      { id: 'epic-oth', ref: 'OTH-1', name: 'Other epic', project_id: 'project-oth' },
    ],
  };
}

/** An all-abstaining verdict by default, so each test states only the fields it varies. */
function buildVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    item_type: undefined,
    priority: undefined,
    due_date: undefined,
    folder_id: undefined,
    intended_project_id: undefined,
    intended_epic_id: undefined,
    ...overrides,
  };
}

/** An eligible Inbox item as the sweep reads it: unclassified, every guessable field empty. */
function buildItem(overrides: Partial<SweepItem> = {}): SweepItem {
  return {
    id: 'item-1',
    title: 'Some captured text',
    notes: undefined,
    raw_capture: undefined,
    source_url: undefined,
    item_type: 'unclassified',
    priority: undefined,
    due_date: undefined,
    folder_id: undefined,
    intended_project_id: undefined,
    intended_epic_id: undefined,
    classify_attempts: 0,
    ...overrides,
  };
}

describe('parseVerdict', () => {
  it('round-trips a well-formed body to a Verdict with all six fields', () => {
    const raw = {
      item_type: 'task',
      priority: 'high',
      due_date: '2026-08-14',
      folder_id: 'folder-work',
      intended_project_id: 'project-alf',
      intended_epic_id: 'epic-alf',
    };
    expect(parseVerdict(raw)).toEqual(raw);
  });

  it('reads a JSON null for any field as undefined', () => {
    // Built via JSON.parse, not an object literal: the package bans the `null` literal, and this
    // is also the actual shape a model response arrives in after JSON.parse.
    const raw = JSON.parse(
      '{"item_type":null,"priority":null,"due_date":null,"folder_id":null,"intended_project_id":null,"intended_epic_id":null}',
    ) as unknown;
    expect(parseVerdict(raw)).toEqual({
      item_type: undefined,
      priority: undefined,
      due_date: undefined,
      folder_id: undefined,
      intended_project_id: undefined,
      intended_epic_id: undefined,
    });
  });

  it.each<[string, unknown]>([
    ['a string', 'not an object'],
    ['a number', 42],
    ['an array', ['task']],
    ['undefined', undefined],
    // `typeof null === 'object'`, so a bare JSON `null` body slips past a naive object guard and
    // then throws on the first property read. It has to be rejected explicitly.
    ['a bare JSON null body', JSON.parse('null')],
  ])('returns undefined for a non-object body (%s)', (_label, raw) => {
    expect(parseVerdict(raw)).toBeUndefined();
  });

  it('drops item_type to undefined when it is outside the enum, without rejecting the rest', () => {
    const result = parseVerdict({ item_type: 'knowledge', priority: 'high' });
    expect(result?.item_type).toBeUndefined();
    expect(result?.priority).toBe('high');
  });

  it('drops priority to undefined when it is outside the enum, without rejecting the rest', () => {
    const result = parseVerdict({ item_type: 'task', priority: 'urgent' });
    expect(result?.item_type).toBe('task');
    expect(result?.priority).toBeUndefined();
  });
});

describe('validateVerdict', () => {
  describe('drops an id that is not in the world that was sent (deleted between prompt and write-back)', () => {
    it('folder_id', () => {
      const verdict = buildVerdict({ item_type: 'task', folder_id: 'folder-ghost' });
      expect(validateVerdict(verdict, buildWorld()).folder_id).toBeUndefined();
    });

    it('intended_project_id', () => {
      const verdict = buildVerdict({ item_type: 'code', intended_project_id: 'project-ghost' });
      expect(validateVerdict(verdict, buildWorld()).intended_project_id).toBeUndefined();
    });

    it('intended_epic_id, keeping a live intended_project_id', () => {
      const verdict = buildVerdict({
        item_type: 'code',
        intended_project_id: 'project-alf',
        intended_epic_id: 'epic-ghost',
      });
      const result = validateVerdict(verdict, buildWorld());
      expect(result.intended_epic_id).toBeUndefined();
      expect(result.intended_project_id).toBe('project-alf');
    });
  });

  it("drops priority, due_date and folder_id when item_type is not 'task'", () => {
    const verdict = buildVerdict({
      item_type: 'code',
      priority: 'high',
      due_date: '2026-08-14',
      folder_id: 'folder-work',
      intended_project_id: 'project-alf',
    });
    const result = validateVerdict(verdict, buildWorld());
    expect(result.priority).toBeUndefined();
    expect(result.due_date).toBeUndefined();
    expect(result.folder_id).toBeUndefined();
    expect(result.intended_project_id).toBe('project-alf');
  });

  it("drops intended_project_id and intended_epic_id when item_type is not 'code'", () => {
    const verdict = buildVerdict({
      item_type: 'task',
      priority: 'high',
      intended_project_id: 'project-alf',
      intended_epic_id: 'epic-alf',
    });
    const result = validateVerdict(verdict, buildWorld());
    expect(result.intended_project_id).toBeUndefined();
    expect(result.intended_epic_id).toBeUndefined();
    expect(result.priority).toBe('high');
  });

  it('drops an intended_epic_id whose epic belongs to a different project than intended_project_id, keeping the project', () => {
    const verdict = buildVerdict({
      item_type: 'code',
      intended_project_id: 'project-alf',
      intended_epic_id: 'epic-oth', // belongs to project-oth, not project-alf
    });
    const result = validateVerdict(verdict, buildWorld());
    expect(result.intended_epic_id).toBeUndefined();
    expect(result.intended_project_id).toBe('project-alf');
  });

  it('drops an intended_epic_id that has no intended_project_id', () => {
    const verdict = buildVerdict({ item_type: 'code', intended_epic_id: 'epic-alf' });
    expect(validateVerdict(verdict, buildWorld()).intended_epic_id).toBeUndefined();
  });

  it.each([
    ['a non-ISO format', '7 August 2026'],
    ['an impossible calendar date', '2026-02-30'],
  ])('drops a due_date that does not name a real YYYY-MM-DD date (%s)', (_label, due_date) => {
    const verdict = buildVerdict({ item_type: 'task', due_date });
    expect(validateVerdict(verdict, buildWorld()).due_date).toBeUndefined();
  });

  it('keeps a real due_date', () => {
    const verdict = buildVerdict({ item_type: 'task', due_date: '2026-08-14' });
    expect(validateVerdict(verdict, buildWorld()).due_date).toBe('2026-08-14');
  });

  it('leaves a fully-abstaining verdict untouched — abstention is a legal answer, not a failure', () => {
    const verdict = buildVerdict();
    expect(validateVerdict(verdict, buildWorld())).toEqual(verdict);
  });

  it('keeps a coherent task verdict whole', () => {
    const verdict = buildVerdict({
      item_type: 'task',
      priority: 'medium',
      due_date: '2026-08-14',
      folder_id: 'folder-work',
    });
    expect(validateVerdict(verdict, buildWorld())).toEqual(verdict);
  });

  it('keeps a coherent code verdict whole', () => {
    const verdict = buildVerdict({
      item_type: 'code',
      intended_project_id: 'project-alf',
      intended_epic_id: 'epic-alf',
    });
    expect(validateVerdict(verdict, buildWorld())).toEqual(verdict);
  });
});

describe('mergeIntoItem', () => {
  type OverwriteCase = [field: keyof Verdict, item: SweepItem, verdict: Verdict];

  it.each<OverwriteCase>([
    [
      'priority',
      buildItem({ item_type: 'task', priority: 'high' }),
      buildVerdict({ item_type: 'task', priority: 'low' }),
    ],
    [
      'due_date',
      buildItem({ item_type: 'task', due_date: '2026-08-01' }),
      buildVerdict({ item_type: 'task', due_date: '2026-08-14' }),
    ],
    [
      'folder_id',
      buildItem({ item_type: 'task', folder_id: 'folder-home' }),
      buildVerdict({ item_type: 'task', folder_id: 'folder-work' }),
    ],
    [
      'intended_project_id',
      buildItem({ item_type: 'code', intended_project_id: 'project-oth' }),
      buildVerdict({ item_type: 'code', intended_project_id: 'project-alf' }),
    ],
    [
      'intended_epic_id',
      buildItem({ item_type: 'code', intended_epic_id: 'epic-oth' }),
      buildVerdict({ item_type: 'code', intended_epic_id: 'epic-alf' }),
    ],
  ])('never overwrites the existing %s with a different guess', (field, item, verdict) => {
    expect(mergeIntoItem(verdict, item)[field]).toBeUndefined();
  });

  it("treats item_type 'unclassified' as empty, writing the guessed type", () => {
    const item = buildItem({ item_type: 'unclassified' });
    const verdict = buildVerdict({ item_type: 'task', priority: 'medium' });
    const result = mergeIntoItem(verdict, item);
    expect(result.item_type).toBe('task');
    expect(result.priority).toBe('medium');
  });

  it("keeps an item's existing item_type 'code' and drops a task-shaped guess's priority, due_date and folder_id (would violate items_task_only_fields)", () => {
    const item = buildItem({ item_type: 'code' });
    const verdict = buildVerdict({
      item_type: 'task',
      priority: 'high',
      due_date: '2026-08-14',
      folder_id: 'folder-work',
    });
    const result = mergeIntoItem(verdict, item);
    expect(result.item_type).toBeUndefined();
    expect(result.priority).toBeUndefined();
    expect(result.due_date).toBeUndefined();
    expect(result.folder_id).toBeUndefined();
  });

  it('lets an ALF:-prefixed capture keep its project and gain the guessed epic', () => {
    const item = buildItem({ item_type: 'code', intended_project_id: 'project-alf' });
    const verdict = buildVerdict({ item_type: 'code', intended_epic_id: 'epic-alf' });
    const result = mergeIntoItem(verdict, item);
    expect(result.item_type).toBeUndefined();
    expect(result.intended_project_id).toBeUndefined();
    expect(result.intended_epic_id).toBe('epic-alf');
  });

  it('carries no field the item already had, so JSON.stringify produces only the keys that will actually be written', () => {
    const item = buildItem({ item_type: 'task', priority: 'high', folder_id: 'folder-work' });
    const verdict = buildVerdict({
      item_type: 'task',
      priority: 'low',
      due_date: '2026-08-14',
      folder_id: 'folder-home',
    });
    const result = mergeIntoItem(verdict, item);
    // Serialised, because that is exactly what becomes the PATCH body: an untouched field is
    // `undefined`, and `JSON.stringify` drops it, so it never reaches the wire at all.
    expect(JSON.stringify(result)).toBe('{"due_date":"2026-08-14"}');
  });
});
