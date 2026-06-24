import {
  createFolderSchema,
  createItemSchema,
  createProjectSchema,
  listItemsQuerySchema,
  moveCodeSchema,
  recurrenceSchema,
  reorderCodeSchema,
  updateCodeSchema,
  updateEpicSchema,
  updateFolderSchema,
  updateItemSchema,
} from './schemas';

describe('createItemSchema', () => {
  it('accepts a minimal body with title', () => {
    const result = createItemSchema.safeParse({ title: 'Buy milk' });
    expect(result.success).toBe(true);
  });

  it('accepts raw Siri body with text field only', () => {
    const result = createItemSchema.safeParse({ text: 'Add to shopping list' });
    expect(result.success).toBe(true);
  });

  it('rejects body with neither title nor text', () => {
    const result = createItemSchema.safeParse({ notes: 'just notes' });
    expect(result.success).toBe(false);
  });

  it('provides error path ["title"] when neither title nor text provided', () => {
    const result = createItemSchema.safeParse({ notes: 'just notes' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue).toBeDefined();
      expect(issue?.path).toStrictEqual(['title']);
      expect(issue?.message).toBe('Either "title" or "text" is required');
    }
  });

  it('accepts all optional fields', () => {
    const result = createItemSchema.safeParse({
      title: 'A task',
      notes: 'some notes',
      source_url: 'https://example.com',
      raw_capture: 'raw',
      item_type: 'task',
      due_date: '2026-12-31T00:00:00Z',
      folder_id: undefined,
      parent_id: undefined,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid item_type', () => {
    const result = createItemSchema.safeParse({ title: 'x', item_type: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('accepts item_type "unclassified"', () => {
    expect(createItemSchema.safeParse({ title: 'x', item_type: 'unclassified' }).success).toBe(
      true,
    );
  });

  it('accepts item_type "code"', () => {
    expect(createItemSchema.safeParse({ title: 'x', item_type: 'code' }).success).toBe(true);
  });

  it('accepts item_type "knowledge"', () => {
    expect(createItemSchema.safeParse({ title: 'x', item_type: 'knowledge' }).success).toBe(true);
  });

  it('rejects empty string as item_type', () => {
    expect(createItemSchema.safeParse({ title: 'x', item_type: '' }).success).toBe(false);
  });
});

describe('updateItemSchema', () => {
  it('accepts an empty object (all optional)', () => {
    const result = updateItemSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts status "active"', () => {
    expect(updateItemSchema.safeParse({ status: 'active' }).success).toBe(true);
  });

  it('accepts status "completed"', () => {
    expect(updateItemSchema.safeParse({ status: 'completed' }).success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = updateItemSchema.safeParse({ status: 'archived' });
    expect(result.success).toBe(false);
  });

  it('rejects empty string status', () => {
    expect(updateItemSchema.safeParse({ status: '' }).success).toBe(false);
  });

  it('accepts a date-only due_date from <input type="date">', () => {
    // Regression: the UI date picker yields "YYYY-MM-DD"; a datetime-only schema
    // would 400, silently breaking the whole due-date feature.
    expect(updateItemSchema.safeParse({ due_date: '2026-12-31' }).success).toBe(true);
  });

  it('accepts a full ISO datetime due_date with UTC offset', () => {
    expect(updateItemSchema.safeParse({ due_date: '2026-12-31T00:00:00Z' }).success).toBe(true);
  });

  it('accepts a full ISO datetime due_date with a non-UTC offset', () => {
    // Ensures offset: true is required (not offset: false which would reject +05:30).
    expect(updateItemSchema.safeParse({ due_date: '2026-12-31T00:00:00+05:30' }).success).toBe(
      true,
    );
  });

  it('accepts null to clear nullable fields (due_date, notes, folder_id)', () => {
    expect(
      updateItemSchema.safeParse({ due_date: null, notes: null, folder_id: null }).success,
    ).toBe(true);
  });

  it('rejects a non-date due_date string', () => {
    expect(updateItemSchema.safeParse({ due_date: 'not-a-date' }).success).toBe(false);
  });

  it('accepts a valid recurrence rule and accepts null to clear it', () => {
    expect(
      updateItemSchema.safeParse({
        recurrence: { freq: 'daily', interval: 1, end: { type: 'never' } },
      }).success,
    ).toBe(true);
    expect(updateItemSchema.safeParse({ recurrence: null }).success).toBe(true);
  });

  it('rejects an invalid recurrence rule', () => {
    expect(
      updateItemSchema.safeParse({ recurrence: { freq: 'fortnightly', interval: 1 } }).success,
    ).toBe(false);
  });

  it('accepts each valid priority level and null to clear it', () => {
    expect(updateItemSchema.safeParse({ priority: 'high' }).success).toBe(true);
    expect(updateItemSchema.safeParse({ priority: 'medium' }).success).toBe(true);
    expect(updateItemSchema.safeParse({ priority: 'low' }).success).toBe(true);
    expect(updateItemSchema.safeParse({ priority: null }).success).toBe(true);
  });

  it('rejects an unknown priority level', () => {
    expect(updateItemSchema.safeParse({ priority: 'urgent' }).success).toBe(false);
  });
});

describe('recurrenceSchema', () => {
  it('accepts each frequency with a valid end', () => {
    expect(
      recurrenceSchema.safeParse({ freq: 'daily', interval: 1, end: { type: 'never' } }).success,
    ).toBe(true);
    expect(
      recurrenceSchema.safeParse({
        freq: 'weekly',
        interval: 2,
        byweekday: [1, 3, 5],
        end: { type: 'never' },
      }).success,
    ).toBe(true);
    expect(
      recurrenceSchema.safeParse({
        freq: 'monthly',
        interval: 1,
        monthly: { kind: 'positional', setpos: -1, weekday: 5 },
        end: { type: 'never' },
      }).success,
    ).toBe(true);
    expect(
      recurrenceSchema.safeParse({ freq: 'yearly', interval: 1, end: { type: 'never' } }).success,
    ).toBe(true);
  });

  it('accepts the on_date and after end conditions', () => {
    expect(
      recurrenceSchema.safeParse({
        freq: 'daily',
        interval: 1,
        end: { type: 'on_date', until: '2026-08-01' },
      }).success,
    ).toBe(true);
    expect(
      recurrenceSchema.safeParse({ freq: 'daily', interval: 1, end: { type: 'after', count: 5 } })
        .success,
    ).toBe(true);
  });

  it('rejects an interval below 1', () => {
    expect(
      recurrenceSchema.safeParse({ freq: 'daily', interval: 0, end: { type: 'never' } }).success,
    ).toBe(false);
  });

  it('rejects an after count below 1', () => {
    expect(
      recurrenceSchema.safeParse({ freq: 'daily', interval: 1, end: { type: 'after', count: 0 } })
        .success,
    ).toBe(false);
  });

  it('rejects an empty byweekday array', () => {
    expect(
      recurrenceSchema.safeParse({
        freq: 'weekly',
        interval: 1,
        byweekday: [],
        end: { type: 'never' },
      }).success,
    ).toBe(false);
  });

  it('rejects byweekday on a non-weekly rule', () => {
    expect(
      recurrenceSchema.safeParse({
        freq: 'daily',
        interval: 1,
        byweekday: [1],
        end: { type: 'never' },
      }).success,
    ).toBe(false);
  });

  it('rejects a weekly rule with no byweekday', () => {
    expect(
      recurrenceSchema.safeParse({ freq: 'weekly', interval: 1, end: { type: 'never' } }).success,
    ).toBe(false);
  });

  it('rejects monthly metadata on a non-monthly rule', () => {
    expect(
      recurrenceSchema.safeParse({
        freq: 'daily',
        interval: 1,
        monthly: { kind: 'day_of_month' },
        end: { type: 'never' },
      }).success,
    ).toBe(false);
  });

  it('rejects a monthly rule with no mode', () => {
    expect(
      recurrenceSchema.safeParse({ freq: 'monthly', interval: 1, end: { type: 'never' } }).success,
    ).toBe(false);
  });

  it('rejects an out-of-range weekday', () => {
    expect(
      recurrenceSchema.safeParse({
        freq: 'weekly',
        interval: 1,
        byweekday: [7],
        end: { type: 'never' },
      }).success,
    ).toBe(false);
  });
});

describe('createFolderSchema', () => {
  it('requires name', () => {
    expect(createFolderSchema.safeParse({}).success).toBe(false);
  });

  it('rejects empty string name', () => {
    expect(createFolderSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('accepts valid name', () => {
    expect(createFolderSchema.safeParse({ name: 'Work' }).success).toBe(true);
  });
});

describe('updateFolderSchema', () => {
  it('requires name', () => {
    expect(updateFolderSchema.safeParse({}).success).toBe(false);
  });
});

describe('listItemsQuerySchema', () => {
  it('parses inbox=true as boolean true', () => {
    const result = listItemsQuerySchema.safeParse({ inbox: 'true' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.inbox).toBe(true);
  });

  it('parses inbox=false as boolean false', () => {
    const result = listItemsQuerySchema.safeParse({ inbox: 'false' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.inbox).toBe(false);
  });

  it('rejects inbox with an invalid value', () => {
    const result = listItemsQuerySchema.safeParse({ inbox: 'yes' });
    expect(result.success).toBe(false);
  });

  it('defaults with no params', () => {
    const result = listItemsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts status "active"', () => {
    expect(listItemsQuerySchema.safeParse({ status: 'active' }).success).toBe(true);
  });

  it('accepts status "completed"', () => {
    expect(listItemsQuerySchema.safeParse({ status: 'completed' }).success).toBe(true);
  });

  it('accepts status "all"', () => {
    expect(listItemsQuerySchema.safeParse({ status: 'all' }).success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = listItemsQuerySchema.safeParse({ status: 'archived' });
    expect(result.success).toBe(false);
  });

  it('rejects empty string status', () => {
    expect(listItemsQuerySchema.safeParse({ status: '' }).success).toBe(false);
  });
});

describe('createProjectSchema', () => {
  const base = { name: 'Alfred', github_url: 'https://github.com/o/r' };

  it('accepts a 3-char key: uppercase letter then two upper-alnum', () => {
    expect(createProjectSchema.safeParse({ ...base, key: 'AL1' }).success).toBe(true);
  });

  it('rejects a key not anchored at the start (must begin with the uppercase letter)', () => {
    // Without the ^ anchor, "1ABC" would match "ABC" mid-string and wrongly pass.
    expect(createProjectSchema.safeParse({ ...base, key: '1ABC' }).success).toBe(false);
  });

  it('rejects a key longer than 3 chars (must be anchored at the end)', () => {
    // Without the $ anchor, "ABCD" would match the "ABC" prefix and wrongly pass.
    expect(createProjectSchema.safeParse({ ...base, key: 'ABCD' }).success).toBe(false);
  });

  it('surfaces the explicit key-format message on a bad key', () => {
    const result = createProjectSchema.safeParse({ ...base, key: 'ab' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('exactly 3 characters'))).toBe(
        true,
      );
    }
  });
});

describe('updateEpicSchema', () => {
  it('accepts archived_at as an ISO datetime with a non-UTC offset (offset must be allowed)', () => {
    // offset:true is required — offset:false (or {}) would reject the +05:30 timestamp.
    expect(updateEpicSchema.safeParse({ archived_at: '2026-06-20T00:00:00+05:30' }).success).toBe(
      true,
    );
  });

  it('rejects an empty patch body (the refine requires at least one field)', () => {
    const result = updateEpicSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('At least one of'))).toBe(true);
    }
  });
});

describe('updateCodeSchema factory_state enum', () => {
  it.each([
    'needs_refinement',
    'in_refinement',
    'ready_for_dev',
    'in_development',
    'ready_for_review',
    'done',
    'blocked',
    'abandoned',
  ])('accepts the factory state %s', (state) => {
    expect(updateCodeSchema.safeParse({ factory_state: state }).success).toBe(true);
  });

  it('rejects an empty-string factory state', () => {
    expect(updateCodeSchema.safeParse({ factory_state: '' }).success).toBe(false);
  });
});

describe('updateCodeSchema optional fields + epic move', () => {
  const epicId = '123e4567-e89b-42d3-a456-426614174000';

  it('accepts a factory_state-only body', () => {
    expect(updateCodeSchema.safeParse({ factory_state: 'in_refinement' }).success).toBe(true);
  });

  it('accepts an epic_id-only body (factory_state is now optional)', () => {
    expect(updateCodeSchema.safeParse({ epic_id: epicId }).success).toBe(true);
  });

  it('accepts both factory_state and epic_id together', () => {
    expect(updateCodeSchema.safeParse({ factory_state: 'done', epic_id: epicId }).success).toBe(
      true,
    );
  });

  it('rejects a non-uuid epic_id', () => {
    expect(updateCodeSchema.safeParse({ epic_id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects an empty patch body (the refine requires factory_state or epic_id)', () => {
    expect(updateCodeSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a blocked_reason-only body (a companion never travels alone)', () => {
    expect(updateCodeSchema.safeParse({ blocked_reason: 'why' }).success).toBe(false);
  });
});

describe('reorderCodeSchema (the Backlog swap)', () => {
  it('accepts two distinct refs', () => {
    expect(reorderCodeSchema.safeParse({ a: 'ALF-1', b: 'ALF-2' }).success).toBe(true);
  });

  it('rejects swapping a story with itself', () => {
    expect(reorderCodeSchema.safeParse({ a: 'ALF-1', b: 'ALF-1' }).success).toBe(false);
  });

  it('rejects an empty ref', () => {
    expect(reorderCodeSchema.safeParse({ a: '', b: 'ALF-2' }).success).toBe(false);
  });

  it('rejects a missing ref', () => {
    expect(reorderCodeSchema.safeParse({ a: 'ALF-1' }).success).toBe(false);
  });
});

describe('moveCodeSchema (the Backlog jump to top/bottom)', () => {
  it('accepts a ref with to_top true or false', () => {
    expect(moveCodeSchema.safeParse({ ref: 'ALF-1', to_top: true }).success).toBe(true);
    expect(moveCodeSchema.safeParse({ ref: 'ALF-1', to_top: false }).success).toBe(true);
  });

  it('rejects an empty ref', () => {
    expect(moveCodeSchema.safeParse({ ref: '', to_top: true }).success).toBe(false);
  });

  it('rejects a missing to_top', () => {
    expect(moveCodeSchema.safeParse({ ref: 'ALF-1' }).success).toBe(false);
  });

  it('rejects a non-boolean to_top', () => {
    expect(moveCodeSchema.safeParse({ ref: 'ALF-1', to_top: 'top' }).success).toBe(false);
  });
});
