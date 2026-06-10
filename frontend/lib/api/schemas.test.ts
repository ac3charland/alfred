import {
  createFolderSchema,
  createItemSchema,
  listItemsQuerySchema,
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
});

describe('updateItemSchema', () => {
  it('accepts an empty object (all optional)', () => {
    const result = updateItemSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = updateItemSchema.safeParse({ status: 'archived' });
    expect(result.success).toBe(false);
  });

  it('accepts a date-only due_date from <input type="date">', () => {
    // Regression: the UI date picker yields "YYYY-MM-DD"; a datetime-only schema
    // would 400, silently breaking the whole due-date feature.
    expect(updateItemSchema.safeParse({ due_date: '2026-12-31' }).success).toBe(true);
  });

  it('accepts a full ISO datetime due_date', () => {
    expect(updateItemSchema.safeParse({ due_date: '2026-12-31T00:00:00Z' }).success).toBe(true);
  });

  it('accepts null to clear nullable fields (due_date, notes, folder_id)', () => {
    expect(
      updateItemSchema.safeParse({ due_date: null, notes: null, folder_id: null }).success,
    ).toBe(true);
  });

  it('rejects a non-date due_date string', () => {
    expect(updateItemSchema.safeParse({ due_date: 'not-a-date' }).success).toBe(false);
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

  it('defaults with no params', () => {
    const result = listItemsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = listItemsQuerySchema.safeParse({ status: 'archived' });
    expect(result.success).toBe(false);
  });
});
