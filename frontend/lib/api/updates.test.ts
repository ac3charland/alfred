import { toUpdatePayload } from './updates';

interface Fields {
  title?: string;
  notes?: string | null;
  status?: 'active' | 'completed';
}

describe('toUpdatePayload', () => {
  it('copies only the fields that are defined', () => {
    const result = toUpdatePayload<Fields>({ title: 'New', status: 'completed' }, [
      'title',
      'notes',
      'status',
    ]);
    expect(result).toStrictEqual({ title: 'New', status: 'completed' });
  });

  it('omits a field that is absent (undefined) — no key in the payload', () => {
    const result = toUpdatePayload<Fields>({ title: 'Only title' }, ['title', 'notes', 'status']);
    expect(Object.keys(result)).toStrictEqual(['title']);
  });

  it('KEEPS a field whose value is null (a present null clears the column)', () => {
    const result = toUpdatePayload<Fields>({ notes: null }, ['title', 'notes', 'status']);
    expect(result).toStrictEqual({ notes: null });
    expect(Object.keys(result)).toContain('notes');
  });

  it('only considers the requested field names (ignores extra keys on the data)', () => {
    const data = { title: 'New', extra: 'ignored' } as unknown as Fields;
    const result = toUpdatePayload<Fields>(data, ['title', 'notes']);
    expect(result).toStrictEqual({ title: 'New' });
  });

  it('returns an empty object when no requested field is defined', () => {
    const result = toUpdatePayload<Fields>({}, ['title', 'notes', 'status']);
    expect(result).toStrictEqual({});
  });
});
