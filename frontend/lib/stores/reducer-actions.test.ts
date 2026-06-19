import { type SimpleAction, insertAt, simpleReducer } from './reducer-actions';

interface Row {
  id: string;
  value: string;
}

const A: Row = { id: 'a', value: 'A' };
const B: Row = { id: 'b', value: 'B' };
const C: Row = { id: 'c', value: 'C' };

describe('simpleReducer', () => {
  it('insert appends a row', () => {
    expect(simpleReducer([A], { type: 'insert', item: B }, 'row')).toStrictEqual([A, B]);
  });

  it('replace swaps a single row by id, and is a no-op for an absent id', () => {
    const renamed = { ...A, value: 'A2' };
    expect(simpleReducer([A], { type: 'replace', id: 'a', item: renamed }, 'row')).toStrictEqual([
      renamed,
    ]);
    expect(simpleReducer([A], { type: 'replace', id: 'gone', item: renamed }, 'row')).toStrictEqual(
      [A],
    );
  });

  it('patch merges into every id in the set (race rule: absent ids skipped)', () => {
    const result = simpleReducer(
      [A, B],
      { type: 'patch', ids: ['a', 'b'], patch: { value: 'x' } },
      'row',
    );
    expect(result.map((r) => r.value)).toStrictEqual(['x', 'x']);
    expect(
      simpleReducer([A], { type: 'patch', ids: ['gone'], patch: { value: 'x' } }, 'row'),
    ).toStrictEqual([A]);
  });

  it('upsert replaces present rows and appends missing ones', () => {
    const A2 = { ...A, value: 'A2' };
    expect(simpleReducer([A], { type: 'upsert', items: [A2, C] }, 'row')).toStrictEqual([A2, C]);
  });

  it('remove drops every id in the set', () => {
    expect(simpleReducer([A, B], { type: 'remove', ids: ['a'] }, 'row')).toStrictEqual([B]);
  });

  it('throws via assertNever for an unknown action type, naming the context', () => {
    expect(() =>
      simpleReducer([A], { type: 'unknown' } as unknown as SimpleAction<Row>, 'row action'),
    ).toThrow('Unhandled row action');
  });
});

describe('insertAt', () => {
  it('inserts at the given index, preserving items after it', () => {
    expect(insertAt([B], A, 0)).toStrictEqual([A, B]);
    expect(insertAt([A, C], B, 1)).toStrictEqual([A, B, C]);
    expect(insertAt([A, B], C, 2)).toStrictEqual([A, B, C]);
  });

  it('clamps negative indices to 0', () => {
    expect(insertAt([A, B], C, -1)).toStrictEqual([C, A, B]);
  });

  it('clamps out-of-bounds indices to the array length', () => {
    expect(insertAt([A, B], C, 99)).toStrictEqual([A, B, C]);
  });
});
